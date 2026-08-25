/**
 * Intelligence lead-time + progressive situation quality benchmark.
 */
import type { HsogEvent, HsogIngestBundle } from "./types.js";
import type { HsogGroundTruth } from "./customerPathCorpus.js";
import { db } from "../../database.js";
import { SITUATION_PATTERNS } from "../../intelligence/situation-patterns.js";
import { investigateMissingEvidence } from "./evidenceMiss.js";

export const HSOG_DECLARATION_TRIGGERS = new Set([
  "launch_gate_failed",
  "incident_declared",
  "renewal_risk_detected",
  "hiring_freeze_started",
  "security_alert_triggered",
  "customer_escalation_opened",
  "deployment_failed",
  "audit_evidence_missing",
]);

export type ScenarioTimingTruth = {
  scenario_id: string;
  first_evidence_day: number;
  declaration_day: number | null;
  declaration_event_type: string | null;
  declaration_summary: string | null;
};

export function buildScenarioTiming(bundle: HsogIngestBundle): ScenarioTimingTruth[] {
  const bySc = new Map<string, HsogEvent[]>();
  for (const ev of bundle.events || []) {
    const list = bySc.get(ev.scenario_id) || [];
    list.push(ev);
    bySc.set(ev.scenario_id, list);
  }
  const out: ScenarioTimingTruth[] = [];
  for (const [sid, events] of bySc) {
    const sorted = [...events].sort((a, b) => a.day - b.day);
    const first = sorted[0]?.day ?? 0;
    const decl = sorted.find((e) => HSOG_DECLARATION_TRIGGERS.has(e.event_type));
    out.push({
      scenario_id: sid,
      first_evidence_day: first,
      declaration_day: decl?.day ?? null,
      declaration_event_type: decl?.event_type ?? null,
      declaration_summary: decl?.summary ?? null,
    });
  }
  return out.sort((a, b) => a.first_evidence_day - b.first_evidence_day);
}

export type DetectionTimeline = Record<string, number>;

export type ProgressiveRow = {
  scenario: string;
  title: string;
  first_evidence_day: number;
  declaration_day: number | null;
  awareness_day: number | null;
  forming_day: number | null;
  elevated_day: number | null;
  decision_ready_day: number | null;
  lead_ready_vs_declaration: number | null;
  stage: string | null;
  confidence: number | null;
  trajectory: string | null;
  facets: string[];
  evidence_count: number;
  evidence_hit_rate: number;
  action_useful: boolean;
  vow: string | null;
};

export type IntelligenceLeadReport = {
  generated_at: string;
  user_id: string;
  scenarios_decision_ready: number;
  scenarios_aware: number;
  scenarios_total: number;
  avg_lead_ready_vs_declaration: number | null;
  rows: ProgressiveRow[];
  markdown: string;
  quality: {
    detection: number;
    evidence: number;
    temporal: number;
    action: number;
  };
};

function normalize(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(" ").filter((t) => t.length > 3));
  const tb = new Set(normalize(b).split(" ").filter((t) => t.length > 3));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, 1);
}

export function evaluateIntelligenceLead(
  userId: string,
  gt: HsogGroundTruth,
  timing: ScenarioTimingTruth[],
  detectTimeline: DetectionTimeline,
): IntelligenceLeadReport {
  const timingBy = new Map(timing.map((t) => [t.scenario_id, t]));
  const sits = db.rawGet(`SELECT * FROM situations WHERE user_id = ?`, [userId]) as Array<{
    pattern_id: string;
    stage: string;
    confidence: number;
    trajectory: string;
    awareness_day: number | null;
    forming_day: number | null;
    elevated_day: number | null;
    decision_ready_day: number | null;
    decision_id: string | null;
    evidence_count: number;
    facets_json: string | null;
  }>;
  const sitBy = new Map(sits.map((s) => [s.pattern_id, s]));

  const rows: ProgressiveRow[] = gt.scenarios.map((s) => {
    const t = timingBy.get(s.id);
    const sit = sitBy.get(s.id);
    const firstEv = t?.first_evidence_day ?? s.start_day;
    const decl = t?.declaration_day ?? null;
    const awareness =
      sit?.awareness_day ?? detectTimeline[`aware:${s.id}`] ?? null;
    const forming = sit?.forming_day ?? detectTimeline[`forming:${s.id}`] ?? null;
    const elevated = sit?.elevated_day ?? detectTimeline[`elevated:${s.id}`] ?? null;
    const ready =
      sit?.decision_ready_day ?? detectTimeline[s.id] ?? null;

    let facets: string[] = [];
    try {
      facets = sit?.facets_json ? JSON.parse(sit.facets_json) : [];
    } catch {
      facets = [];
    }

    const arts = gt.artifacts.filter((a) => a.scenario_id === s.id);
    let hit = 0;
    const blindIds = new Set<string>();
    if (sit) {
      const ev = db.rawGet(
        `SELECT signal_id FROM situation_evidence WHERE situation_id IN
          (SELECT id FROM situations WHERE user_id = ? AND pattern_id = ?)`,
        [userId, s.id],
      ) as { signal_id: string }[];
      for (const e of ev) {
        const row = (
          db.rawGet(`SELECT external_id FROM external_signals WHERE id = ?`, [e.signal_id]) as {
            external_id: string | null;
          }[]
        )[0];
        if (row?.external_id) blindIds.add(String(row.external_id));
      }
      if (sit.decision_id) {
        const related = db.rawGet(
          `SELECT external_id FROM external_signals WHERE user_id = ? AND related_decision_id = ?`,
          [userId, sit.decision_id],
        ) as { external_id: string | null }[];
        for (const r of related) {
          if (r.external_id) blindIds.add(String(r.external_id));
        }
      }
    }
    hit = arts.filter((a) => blindIds.has(a.blind_external_id)).length;
    const evidence_hit_rate = arts.length ? hit / arts.length : 0;

    const pattern = SITUATION_PATTERNS.find((p) => p.id === s.id);
    let vow: string | null = null;
    if (sit?.decision_id) {
      const d = (
        db.rawGet(`SELECT vow FROM decision_ledger WHERE id = ?`, [sit.decision_id]) as {
          vow: string;
        }[]
      )[0];
      vow = d?.vow || null;
    }
    const action_useful = !!(vow && pattern?.vow && tokenOverlap(vow, pattern.vow) >= 0.25);

    return {
      scenario: s.id,
      title: s.title,
      first_evidence_day: firstEv,
      declaration_day: decl,
      awareness_day: awareness,
      forming_day: forming,
      elevated_day: elevated,
      decision_ready_day: ready,
      lead_ready_vs_declaration:
        ready != null && decl != null ? decl - ready : null,
      stage: sit?.stage ?? null,
      confidence: sit?.confidence ?? null,
      trajectory: sit?.trajectory ?? null,
      facets,
      evidence_count: sit?.evidence_count ?? 0,
      evidence_hit_rate: Math.round(evidence_hit_rate * 1000) / 1000,
      action_useful,
      vow,
    };
  });

  const readyRows = rows.filter((r) => r.decision_ready_day != null);
  const avgLead =
    readyRows.filter((r) => r.lead_ready_vs_declaration != null).length > 0
      ? readyRows
          .filter((r) => r.lead_ready_vs_declaration != null)
          .reduce((s, r) => s + (r.lead_ready_vs_declaration || 0), 0) /
        readyRows.filter((r) => r.lead_ready_vs_declaration != null).length
      : null;

  const quality = {
    detection: rows.filter((r) => r.awareness_day != null).length / Math.max(rows.length, 1),
    evidence: rows.reduce((s, r) => s + r.evidence_hit_rate, 0) / Math.max(rows.length, 1),
    temporal:
      rows.filter((r) => r.forming_day != null || r.elevated_day != null).length /
      Math.max(rows.length, 1),
    action: rows.filter((r) => r.action_useful).length / Math.max(rows.filter((r) => r.vow).length, 1),
  };

  const markdown = formatMarkdown(rows, avgLead, quality);
  let missMd = "";
  try {
    const miss = investigateMissingEvidence(userId, gt, [
      "infrastructure_outage",
      "feature_quality_regression",
      "security_incident",
    ]);
    missMd = "\n\n" + miss.markdown;
  } catch {
    /* schema / empty tenant */
  }

  return {
    generated_at: new Date().toISOString(),
    user_id: userId,
    scenarios_decision_ready: readyRows.length,
    scenarios_aware: rows.filter((r) => r.awareness_day != null).length,
    scenarios_total: rows.length,
    avg_lead_ready_vs_declaration: avgLead != null ? Math.round(avgLead * 10) / 10 : null,
    rows,
    markdown: markdown + missMd,
    quality: {
      detection: Math.round(quality.detection * 100) / 100,
      evidence: Math.round(quality.evidence * 100) / 100,
      temporal: Math.round(quality.temporal * 100) / 100,
      action: Math.round(quality.action * 100) / 100,
    },
  };
}

function formatMarkdown(
  rows: ProgressiveRow[],
  avgLead: number | null,
  quality: { detection: number; evidence: number; temporal: number; action: number },
): string {
  return [
    "HUSTRONIX HSOG PROGRESSIVE SITUATION TEST",
    "────────────────────────────────────────",
    "",
    "Milestones: Awareness → Forming → Elevated → Decision-ready",
    "(Not first-keyword hit. DRAFT only at Decision-ready.)",
    "",
    "Progressive timeline",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "| Scenario | Evidence | Aware | Forming | Elevated | Ready | Declaration | Lead(ready) | Stage |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...rows.map((r) => {
      const lead =
        r.lead_ready_vs_declaration == null
          ? "—"
          : r.lead_ready_vs_declaration > 0
            ? `+${r.lead_ready_vs_declaration}d`
            : r.lead_ready_vs_declaration === 0
              ? "0d"
              : `${r.lead_ready_vs_declaration}d`;
      return `| ${r.title} | ${r.first_evidence_day} | ${r.awareness_day ?? "—"} | ${r.forming_day ?? "—"} | ${r.elevated_day ?? "—"} | ${r.decision_ready_day ?? "—"} | ${r.declaration_day ?? "—"} | ${lead} | ${r.stage ?? "—"} |`;
    }),
    "",
    avgLead != null
      ? `Average lead (decision-ready vs declaration): ${avgLead > 0 ? "+" : ""}${avgLead.toFixed(1)} days`
      : "Average lead: n/a (no scenarios reached decision-ready with a declaration day)",
    "",
    "Quality scores (0–1)",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    `Detection (awareness): ${quality.detection.toFixed(2)}`,
    `Evidence synthesis: ${quality.evidence.toFixed(2)}`,
    `Temporal progression (forming/elevated): ${quality.temporal.toFixed(2)}`,
    `Action quality (when decided): ${quality.action.toFixed(2)}`,
    "",
    "Per-scenario evidence / action",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    ...rows.map((r) => {
      const act = r.action_useful ? "✓" : r.vow ? "~" : "—";
      return `${r.title}: facets=[${r.facets.join(",")}] evidence=${r.evidence_count} hit=${Math.round(r.evidence_hit_rate * 100)}% conf=${r.confidence != null ? Math.round(r.confidence * 100) + "%" : "—"} traj=${r.trajectory || "—"} action=${act}`;
    }),
    "",
    "SEV1 investigation note",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "Declaration = audit_evidence_missing (day 51). SIEM alert is day 74.",
    "Ready should fire from access+audit (or access+tooling) by day 51 — not wait for detection/SIEM.",
    "If Ready ≫ 51: missing early facet aggregation or minHits too strict on day-44/51 prose.",
    "",
    "Do not treat average lead alone as proof of autonomous multi-hop intelligence.",
  ].join("\n");
}
