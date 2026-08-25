/**
 * Open-world situations: cluster by extracted entity + polarity.
 * No theme lexicon, no HSOG pattern IDs, no playbooks.
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { extractOpenWorldEntities } from "./entity-resolver.js";
import { indexSignalEntities, linkEntitiesToSituation } from "./situation-graph.js";
import { mutationCreateDraftDecision } from "../security/mutation-handlers.js";
import { boundedGateDeltas, getReadinessPrior } from "./readiness-learning.js";

function improving(content: string): boolean {
  return /resolved|restored|fixed|reopened|reinstated|cleared|all clear|false alarm|walked back|no longer|stood down/i.test(
    content,
  );
}

/** Generic polarity — not a theme catalog. */
function worsening(content: string): boolean {
  return /concern|worried|risk|fail|blocked|overdue|escalat|cannot|unauthori[sz]ed|rumour|rumor|cancelled|pulled|urgent|serious|stop.?ship/i.test(
    content,
  );
}

function polarity(content: string): "up" | "down" | "mixed" | "none" {
  const w = worsening(content);
  const i = improving(content);
  if (w && i) return "mixed";
  if (w) return "down";
  if (i) return "up";
  return "none";
}

export type OpenWorldDetectResult = {
  clusters: number;
  situations_opened: number;
  decisions_created: number;
  resolved: number;
};

export function runOpenWorldSituationEngine(
  userId: string,
  opts?: { simDay?: number },
): OpenWorldDetectResult {
  const simDay = opts?.simDay ?? null;
  const signals = db.rawGet(
    `SELECT id, content, owner, source FROM external_signals
     WHERE user_id = ? AND state IN ('UNVERIFIED','GRACE','LINKED')
     ORDER BY COALESCE(received_at, detected_at) ASC LIMIT 400`,
    [userId],
  ) as { id: string; content: string; owner: string; source: string | null }[];

  const out: OpenWorldDetectResult = {
    clusters: 0,
    situations_opened: 0,
    decisions_created: 0,
    resolved: 0,
  };
  if (!signals.length) return out;

  for (const s of signals) indexSignalEntities(userId, s.id, s.content || "", simDay);

  type Bucket = {
    entityKey: string;
    entityLabel: string;
    signals: typeof signals;
    sources: Set<string>;
    text: string[];
  };
  const buckets = new Map<string, Bucket>();

  for (const s of signals) {
    const ents = extractOpenWorldEntities(s.content || "").filter(
      (e) => e.type === "product" || e.type === "customer",
    );
    if (!ents.length) continue;
    for (const ent of ents) {
      let b = buckets.get(ent.key);
      if (!b) {
        b = {
          entityKey: ent.key,
          entityLabel: ent.label,
          signals: [],
          sources: new Set(),
          text: [],
        };
        buckets.set(ent.key, b);
      }
      if (!b.signals.some((x) => x.id === s.id)) b.signals.push(s);
      if (s.source) b.sources.add(String(s.source).toLowerCase());
      b.text.push(s.content || "");
    }
  }

  out.clusters = buckets.size;

  for (const [key, b] of buckets) {
    const polar = b.text.map((t) => polarity(t));
    const down = polar.filter((p) => p === "down").length;
    const up = polar.filter((p) => p === "up").length;
    const mixed = polar.filter((p) => p === "mixed").length;
    if (b.signals.length < 2 || down + mixed < 1) continue;

    const last = b.text[b.text.length - 1] || "";
    const lastPol = polarity(last);
    const lastUp = lastPol === "up" || improving(last) && lastPol !== "down";
    let trajectory: "IMPROVING" | "STABLE" | "WORSENING" = "STABLE";
    if (lastUp) trajectory = "IMPROVING";
    else if (down + mixed > up) trajectory = "WORSENING";
    else if (up > down) trajectory = "IMPROVING";

    const patternId = `openworld:${key}`;
    const title = `${b.entityLabel}: emerging situation`;
    const evidenceN = b.signals.length;
    const sourceN = b.sources.size;
    const confidence = Math.min(
      0.9,
      0.32 + Math.min(evidenceN, 6) * 0.08 + (sourceN >= 2 ? 0.12 : 0) + (down >= 2 ? 0.1 : 0),
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
          `Open-world cluster around ${b.entityLabel}`,
          JSON.stringify([`Investigate ${b.entityLabel}`, "Confirm evidence and owners"]),
          JSON.stringify(["entity", "polarity"]),
          JSON.stringify([`${b.entityLabel} (entity)`]),
          `Awareness: repeating signals about ${b.entityLabel}.`,
        ],
      );
      sit = (db.rawGet(`SELECT * FROM situations WHERE id = ?`, [id]) as Array<Record<string, unknown>>)[0];
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
      db.rawRun(
        `INSERT INTO situation_evidence
          (id, situation_id, signal_id, facet, weight, sim_day, snippet, attach_reason)
         VALUES (?, ?, ?, ?, 1.0, ?, ?, 'openworld')`,
        [
          uuidv4(),
          sitId,
          s.id,
          polarity(s.content || ""),
          simDay,
          (s.content || "").slice(0, 240),
        ],
      );
      linkEntitiesToSituation(userId, sitId, extractOpenWorldEntities(s.content || ""), simDay);
    }

    const evidenceCount = (
      db.rawGet(`SELECT COUNT(1) AS n FROM situation_evidence WHERE situation_id = ?`, [sitId]) as {
        n: number;
      }[]
    )[0]?.n || 0;

    const conflict = mixed >= 1 || (down >= 1 && up >= 1);
    const prior = getReadinessPrior(userId, "open_world");
    const minReadyEvidence = 3 + boundedGateDeltas(prior).minEvidenceDelta;
    let stage = "AWARENESS";
    if (trajectory === "IMPROVING" && lastUp && evidenceCount >= 2) {
      stage = "RESOLVED";
      out.resolved += 1;
    } else if (
      !conflict &&
      trajectory === "WORSENING" &&
      evidenceCount >= minReadyEvidence &&
      sourceN >= 2 &&
      down >= 2
    ) {
      stage = "DECISION_READY";
    } else if (evidenceCount >= 3 || (evidenceCount >= 2 && sourceN >= 2 && down >= 2)) {
      stage = "ELEVATED";
    } else if (evidenceCount >= 2) {
      stage = "FORMING";
    }

    const prevDecision = sit!.decision_id as string | null;
    db.rawRun(
      `UPDATE situations SET stage = ?, confidence = ?, trajectory = ?, evidence_count = ?,
        last_updated_day = COALESCE(?, last_updated_day),
        sources_json = ?,
        forming_day = CASE WHEN ? IN ('FORMING','ELEVATED','DECISION_READY','DECIDED') THEN COALESCE(forming_day, ?) ELSE forming_day END,
        elevated_day = CASE WHEN ? IN ('ELEVATED','DECISION_READY','DECIDED') THEN COALESCE(elevated_day, ?) ELSE elevated_day END,
        decision_ready_day = CASE WHEN ? IN ('DECISION_READY','DECIDED') THEN COALESCE(decision_ready_day, ?) ELSE decision_ready_day END,
        explanation = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        stage,
        trajectory === "IMPROVING" ? Math.max(0.2, confidence - 0.25) : confidence,
        trajectory,
        evidenceCount,
        simDay,
        JSON.stringify([...b.sources]),
        stage,
        simDay,
        stage,
        simDay,
        stage,
        simDay,
        `${stage}: ${title}. Evidence=${evidenceCount} sources=${sourceN} trajectory=${trajectory}.${
          prior.min_evidence_delta
            ? ` ${prior.explanation}`
            : ""
        }`,
        sitId,
      ],
    );

    if (stage === "DECISION_READY" && !prevDecision && trajectory !== "IMPROVING") {
      const draft = mutationCreateDraftDecision(userId, {
        vow: `Investigate and contain the emerging ${b.entityLabel} situation.`,
        expected_outcomes: [{ metric: b.entityLabel, target: "Stabilize with linked evidence" }],
        constraints: ["Do not ignore conflicting later evidence"],
        materializeTasks: false,
        tasks: [
          {
            type: "ACTION",
            owner: b.signals[0]?.owner || "Unassigned",
            weight: 1,
            success_condition: `Evidence review for ${b.entityLabel}`,
          },
        ],
        institutional_reasoning: {
          institutional_version: 3,
          source: "open_world",
          situation_id: patternId,
          situation_object_id: sitId,
          title,
          stage,
          confidence,
          trajectory,
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
