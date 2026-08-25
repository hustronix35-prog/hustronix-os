/**
 * Emergent situations — discover organizational problems without a pre-taught
 * scenario ID / playbook. Clusters signals by primary entity + theme buckets.
 *
 * Keywords only propose theme facets; entities bind the cluster.
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { extractEntities } from "./entity-resolver.js";
import { indexSignalEntities, linkEntitiesToSituation } from "./situation-graph.js";
import { mutationCreateDraftDecision } from "../security/mutation-handlers.js";

export type ThemeFacet = {
  id: string;
  keywords: string[];
};

/** Generic organizational themes — not HSOG scenario ids. */
export const EMERGENT_THEMES: Record<string, ThemeFacet[]> = {
  delivery_risk: [
    { id: "schedule", keywords: ["deadline", "slip", "delay", "timeline", "launch date"] },
    { id: "blocker", keywords: ["blocked", "blocker", "cannot ship", "holding"] },
    { id: "quality", keywords: ["regression", "bug", "qa fail", "broken"] },
  ],
  vendor_risk: [
    { id: "vendor", keywords: ["vendor", "supplier", "invoice", "procurement"] },
    { id: "payment", keywords: ["payment delayed", "unpaid", "past due", "ap hold"] },
    { id: "service", keywords: ["sla breach", "vendor outage", "contract"] },
  ],
  compliance_gap: [
    { id: "control", keywords: ["soc2", "iso", "control gap", "compliance"] },
    { id: "evidence", keywords: ["missing evidence", "audit packet", "attestation"] },
    { id: "policy", keywords: ["policy exception", "policy violation", "retention"] },
  ],
  budget_pressure: [
    { id: "spend", keywords: ["over budget", "burn rate", "spend", "cost overrun"] },
    { id: "forecast", keywords: ["reforecast", "budget miss", "opex"] },
    { id: "approval", keywords: ["spend approval", "cfo hold", "budget freeze"] },
  ],
  privacy_request: [
    { id: "request", keywords: ["dsar", "data subject", "privacy request", "delete my data"] },
    { id: "residency", keywords: ["data residency", "region lock", "eu only"] },
    { id: "legal", keywords: ["legal hold", "counsel", "gdpr"] },
  ],
  customer_health: [
    { id: "support", keywords: ["support ticket", "escalation", "customer complaint"] },
    { id: "health", keywords: ["health score", "nps drop", "churn risk"] },
    { id: "commercial", keywords: ["renewal", "discount request", "competitor"] },
  ],
};

function textHas(content: string, kw: string): boolean {
  const lower = content.toLowerCase();
  const k = kw.toLowerCase();
  if (k.includes(" ") || k.length >= 6) return lower.includes(k);
  return new RegExp(
    `(?:^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`,
    "i",
  ).test(content);
}

function themeFacets(themeId: string, content: string): string[] {
  const facets = EMERGENT_THEMES[themeId] || [];
  return facets.filter((f) => f.keywords.some((k) => textHas(content, k))).map((f) => f.id);
}

function improving(content: string): boolean {
  return /resolved|restored|fixed|closed|mitigated|on track|cleared|paid|approved/i.test(content);
}

function worsening(content: string): boolean {
  return /blocked|delay|risk|fail|breach|overdue|escalat|drop|slip|gap/i.test(content);
}

export type EmergentDetectResult = {
  clusters: number;
  situations_opened: number;
  decisions_created: number;
  resolved: number;
};

/**
 * Scan signals, form emergent situations keyed by (theme + primary entity).
 */
export function runEmergentSituationEngine(
  userId: string,
  opts?: { simDay?: number },
): EmergentDetectResult {
  const simDay = opts?.simDay ?? null;
  const signals = db.rawGet(
    `SELECT id, content, owner, source FROM external_signals
     WHERE user_id = ? AND state IN ('UNVERIFIED','GRACE','LINKED')
     ORDER BY COALESCE(received_at, detected_at) ASC LIMIT 400`,
    [userId],
  ) as { id: string; content: string; owner: string; source: string | null }[];

  const out: EmergentDetectResult = {
    clusters: 0,
    situations_opened: 0,
    decisions_created: 0,
    resolved: 0,
  };
  if (!signals.length) return out;

  for (const s of signals) indexSignalEntities(userId, s.id, s.content || "", simDay);

  type Bucket = {
    theme: string;
    entityKey: string;
    entityLabel: string;
    signals: typeof signals;
    facets: Set<string>;
    days: Set<number>;
    sources: Set<string>;
    text: string[];
  };
  const buckets = new Map<string, Bucket>();

  for (const s of signals) {
    const ents = extractEntities(s.content || "").filter(
      (e) => e.type === "customer" || e.type === "product" || e.type === "project",
    );
    if (!ents.length) continue;
    for (const [themeId] of Object.entries(EMERGENT_THEMES)) {
      const facets = themeFacets(themeId, s.content || "");
      if (!facets.length) continue;
      for (const ent of ents) {
        const key = `${themeId}::${ent.key}`;
        let b = buckets.get(key);
        if (!b) {
          b = {
            theme: themeId,
            entityKey: ent.key,
            entityLabel: ent.label,
            signals: [],
            facets: new Set(),
            days: new Set(),
            sources: new Set(),
            text: [],
          };
          buckets.set(key, b);
        }
        if (!b.signals.some((x) => x.id === s.id)) b.signals.push(s);
        for (const f of facets) b.facets.add(f);
        if (simDay != null) b.days.add(simDay);
        if (s.source) b.sources.add(String(s.source).toLowerCase());
        b.text.push(s.content || "");
      }
    }
  }

  out.clusters = buckets.size;

  for (const [key, b] of buckets) {
    if (b.facets.size < 2 || b.signals.length < 2) continue;

    const patternId = `emergent:${key}`;
    const title = `${b.entityLabel}: ${b.theme.replace(/_/g, " ")}`;
    const blob = b.text.join(" ");
    let trajectory: "IMPROVING" | "STABLE" | "WORSENING" = "STABLE";
    if (worsening(blob) && !improving(blob)) trajectory = "WORSENING";
    else if (improving(blob) && !worsening(blob)) trajectory = "IMPROVING";
    else if (improving(blob) && worsening(blob)) {
      // later improving wins if last snippets improve
      const last = b.text.slice(-2).join(" ");
      trajectory = improving(last) ? "IMPROVING" : "WORSENING";
    }

    const confidence = Math.min(
      0.92,
      0.35 + b.facets.size * 0.12 + Math.min(b.signals.length, 6) * 0.05 + (b.sources.size >= 2 ? 0.08 : 0),
    );

    let sit = (
      db.rawGet(`SELECT * FROM situations WHERE user_id = ? AND pattern_id = ?`, [
        userId,
        patternId,
      ]) as Array<Record<string, unknown>>
    )[0];

    if (!sit) {
      const id = uuidv4();
      db.rawRun(
        `INSERT INTO situations (
          id, user_id, pattern_id, title, stage, confidence, trajectory,
          first_observed_day, last_updated_day, awareness_day, evidence_count,
          potential_impact, recommended_actions_json, teams_json, people_json,
          facets_json, entities_json, explanation
        ) VALUES (?, ?, ?, ?, 'AWARENESS', ?, 'STABLE', ?, ?, ?, 0, ?, ?, '[]', '[]', ?, ?, ?)`,
        [
          id,
          userId,
          patternId,
          title,
          confidence,
          simDay,
          simDay,
          simDay,
          `Emergent impact around ${b.entityLabel}`,
          JSON.stringify([`Investigate ${title}`, "Assign owner and gather evidence"]),
          JSON.stringify([...b.facets]),
          JSON.stringify([`${b.entityLabel} (customer/product)`]),
          `Emergent awareness: ${title}`,
        ],
      );
      sit = (
        db.rawGet(`SELECT * FROM situations WHERE id = ?`, [id]) as Array<Record<string, unknown>>
      )[0];
      out.situations_opened += 1;
    }

    const sitId = String(sit!.id);
    for (const s of b.signals) {
      const existing = (
        db.rawGet(`SELECT id FROM situation_evidence WHERE situation_id = ? AND signal_id = ?`, [
          sitId,
          s.id,
        ]) as { id: string }[]
      )[0];
      if (existing) continue;
      const facets = themeFacets(b.theme, s.content || "");
      db.rawRun(
        `INSERT INTO situation_evidence
          (id, situation_id, signal_id, facet, weight, sim_day, snippet, attach_reason)
         VALUES (?, ?, ?, ?, 1.0, ?, ?, 'emergent')`,
        [
          uuidv4(),
          sitId,
          s.id,
          facets.join(",") || b.theme,
          simDay,
          (s.content || "").slice(0, 240),
        ],
      );
      linkEntitiesToSituation(userId, sitId, extractEntities(s.content || ""), simDay);
    }

    const evidenceCount = (
      db.rawGet(`SELECT COUNT(1) AS n FROM situation_evidence WHERE situation_id = ?`, [sitId]) as {
        n: number;
      }[]
    )[0]?.n || 0;

    let stage = "AWARENESS";
    if (trajectory === "IMPROVING" && evidenceCount >= 2 && /resolved|fixed|paid|cleared/i.test(blob)) {
      stage = "RESOLVED";
      out.resolved += 1;
    } else if (b.facets.size >= 3 && evidenceCount >= 3 && trajectory !== "IMPROVING") {
      stage = "DECISION_READY";
    } else if (b.facets.size >= 2 && evidenceCount >= 3) {
      stage = "ELEVATED";
    } else if (evidenceCount >= 2) {
      stage = "FORMING";
    }

    const prevDecision = sit!.decision_id as string | null;
    const confOut =
      trajectory === "IMPROVING" ? Math.max(0.2, confidence - 0.25) : confidence;
    if (stage === "RESOLVED") {
      // never mint a new decision once resolved
    }
    db.rawRun(
      `UPDATE situations SET stage = ?, confidence = ?, trajectory = ?, evidence_count = ?,
        facets_json = ?, last_updated_day = COALESCE(?, last_updated_day),
        forming_day = CASE WHEN ? IN ('FORMING','ELEVATED','DECISION_READY') THEN COALESCE(forming_day, ?) ELSE forming_day END,
        elevated_day = CASE WHEN ? IN ('ELEVATED','DECISION_READY') THEN COALESCE(elevated_day, ?) ELSE elevated_day END,
        decision_ready_day = CASE WHEN ? = 'DECISION_READY' THEN COALESCE(decision_ready_day, ?) ELSE decision_ready_day END,
        explanation = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        stage,
        confOut,
        trajectory,
        evidenceCount,
        JSON.stringify([...b.facets]),
        simDay,
        stage,
        simDay,
        stage,
        simDay,
        stage,
        simDay,
        `${stage}: ${title}. Facets=${[...b.facets].join(",")}. Evidence=${evidenceCount}. Trajectory=${trajectory}.`,
        sitId,
      ],
    );

    if (stage === "DECISION_READY" && !prevDecision && trajectory !== "IMPROVING") {
      const draft = mutationCreateDraftDecision(userId, {
        vow: `Address emergent situation: ${title}`,
        expected_outcomes: [{ metric: title, target: "Stabilize with linked evidence" }],
        constraints: ["Do not ignore cross-team impact"],
        materializeTasks: false,
        tasks: [
          {
            type: "ACTION",
            owner: b.signals[0]?.owner || "Unassigned",
            weight: 1,
            success_condition: `Evidence review complete for ${b.entityLabel}`,
          },
        ],
        institutional_reasoning: {
          institutional_version: 3,
          source: "emergent_situation",
          situation_id: patternId,
          situation_object_id: sitId,
          title,
          stage,
          confidence,
          trajectory,
          facets: [...b.facets],
        },
        reversal_conditions: "Improving evidence or explicit resolve",
      });
      db.rawRun(`UPDATE situations SET decision_id = ?, stage = 'DECIDED' WHERE id = ?`, [
        draft.id,
        sitId,
      ]);
      out.decisions_created += 1;
    }
  }

  return out;
}
