/**
 * Generalization + Chat E2E evaluators for unseen corpora.
 */
import { db } from "../../database.js";
import { findSituationsForQuestion } from "../../intelligence/situation-chat.js";
import type { UnseenCorpus, UnseenScenarioTruth } from "./unseenCorpus.js";

export type UnseenScenarioResult = {
  id: string;
  title: string;
  discovered: boolean;
  theme_ok: boolean;
  entity_ok: boolean;
  awareness_day: number | null;
  ready_day: number | null;
  stage: string | null;
  trajectory: string | null;
  resolved: boolean;
  lead_vs_declaration: number | null;
  evidence_count: number;
};

export type UnseenEvalReport = {
  scenarios_total: number;
  scenarios_discovered: number;
  discovery_rate: number;
  avg_lead: number | null;
  deescalations_ok: number;
  deescalations_total: number;
  rows: UnseenScenarioResult[];
  markdown: string;
};

function findSituationForScenario(
  userId: string,
  s: UnseenScenarioTruth,
): {
  pattern_id: string;
  stage: string;
  trajectory: string;
  awareness_day: number | null;
  decision_ready_day: number | null;
  evidence_count: number;
  entities_json: string | null;
  facets_json: string | null;
} | null {
  const rows = db.rawGet(
    `SELECT pattern_id, stage, trajectory, awareness_day, decision_ready_day, evidence_count,
            entities_json, facets_json, title
     FROM situations WHERE user_id = ?`,
    [userId],
  ) as Array<{
    pattern_id: string;
    stage: string;
    trajectory: string;
    awareness_day: number | null;
    decision_ready_day: number | null;
    evidence_count: number;
    entities_json: string | null;
    facets_json: string | null;
    title: string;
  }>;

  const ent = s.expected_entity.toLowerCase();
  const theme = s.expected_theme.toLowerCase();
  const hit =
    rows.find(
      (r) =>
        r.pattern_id.includes(`emergent:${theme}`) &&
        (r.pattern_id.toLowerCase().includes(ent.replace(/\s+/g, "_")) ||
          (r.entities_json || "").toLowerCase().includes(ent) ||
          r.title.toLowerCase().includes(ent)),
    ) ||
    rows.find(
      (r) =>
        r.pattern_id.startsWith("emergent:") &&
        ((r.entities_json || "").toLowerCase().includes(ent) ||
          r.title.toLowerCase().includes(ent)),
    );
  return hit || null;
}

export function evaluateUnseenGeneralization(
  userId: string,
  corpus: UnseenCorpus,
): UnseenEvalReport {
  const rows: UnseenScenarioResult[] = corpus.scenarios.map((s) => {
    const sit = findSituationForScenario(userId, s);
    const entities = (() => {
      try {
        return sit?.entities_json ? JSON.parse(sit.entities_json) : [];
      } catch {
        return [];
      }
    })() as string[];
    const entity_ok = entities.some((e) =>
      String(e).toLowerCase().includes(s.expected_entity.toLowerCase()),
    ) || (sit?.title || "").toLowerCase().includes(s.expected_entity.toLowerCase());
    const theme_ok = !!(sit && sit.pattern_id.includes(s.expected_theme));
    const ready = sit?.decision_ready_day ?? null;
    const resolved =
      sit?.stage === "RESOLVED" ||
      (sit?.trajectory === "IMPROVING" && !!s.resolve_day);
    return {
      id: s.id,
      title: s.title,
      discovered: !!sit,
      theme_ok,
      entity_ok,
      awareness_day: sit?.awareness_day ?? null,
      ready_day: ready,
      stage: sit?.stage ?? null,
      trajectory: sit?.trajectory ?? null,
      resolved: !!resolved,
      lead_vs_declaration:
        ready != null && s.declaration_day != null ? s.declaration_day - ready : null,
      evidence_count: sit?.evidence_count ?? 0,
    };
  });

  const discovered = rows.filter((r) => r.discovered).length;
  const leads = rows.filter((r) => r.lead_vs_declaration != null).map((r) => r.lead_vs_declaration!);
  const avg_lead = leads.length
    ? Math.round((leads.reduce((a, b) => a + b, 0) / leads.length) * 10) / 10
    : null;
  const withResolve = corpus.scenarios.filter((s) => s.resolve_day != null);
  const deescalations_ok = withResolve.filter((s) => {
    const r = rows.find((x) => x.id === s.id);
    return r && (r.resolved || r.trajectory === "IMPROVING" || r.stage === "RESOLVED");
  }).length;

  const markdown = [
    "HUSTRONIX UNSEEN / GENERALIZATION TEST",
    "────────────────────────────────────",
    "No HSOG scenario IDs, playbooks, or taught pattern keys in ingest.",
    "",
    `| Scenario | Discovered | Theme | Entity | Aware | Ready | Decl | Lead | Stage | Resolved |`,
    `|---|:---:|:---:|:---:|---:|---:|---:|---:|---|:---:|`,
    ...rows.map((r) => {
      const s = corpus.scenarios.find((x) => x.id === r.id)!;
      const lead =
        r.lead_vs_declaration == null
          ? "—"
          : r.lead_vs_declaration > 0
            ? `+${r.lead_vs_declaration}d`
            : `${r.lead_vs_declaration}d`;
      return `| ${r.title} | ${r.discovered ? "✓" : "✗"} | ${r.theme_ok ? "✓" : "✗"} | ${r.entity_ok ? "✓" : "✗"} | ${r.awareness_day ?? "—"} | ${r.ready_day ?? "—"} | ${s.declaration_day} | ${lead} | ${r.stage ?? "—"} | ${r.resolved ? "✓" : "—"} |`;
    }),
    "",
    `Discovery rate: ${discovered}/${rows.length} (${Math.round((discovered / Math.max(rows.length, 1)) * 100)}%)`,
    avg_lead != null ? `Average lead (ready vs declaration): ${avg_lead > 0 ? "+" : ""}${avg_lead} days` : "Average lead: n/a",
    `De-escalation: ${deescalations_ok}/${withResolve.length} resolve stories improved/resolved`,
  ].join("\n");

  return {
    scenarios_total: rows.length,
    scenarios_discovered: discovered,
    discovery_rate: Math.round((discovered / Math.max(rows.length, 1)) * 1000) / 1000,
    avg_lead,
    deescalations_ok,
    deescalations_total: withResolve.length,
    rows,
    markdown,
  };
}

export type ChatTurnExpect = {
  question: string;
  must_include?: string[];
  grounded?: boolean;
};

export type ChatE2EResult = {
  turns: Array<{
    question: string;
    grounded: boolean;
    answer_preview: string;
    passed: boolean;
    missing: string[];
  }>;
  passed: number;
  total: number;
  markdown: string;
};

/** Chat must answer from Situation objects — not free hallucination. */
export function evaluateChatE2E(userId: string, turns: ChatTurnExpect[]): ChatE2EResult {
  const out = turns.map((t) => {
    const cards = findSituationsForQuestion(userId, t.question);
    const answer = cards[0]?.answer || "";
    const grounded = cards.length > 0 && answer.length > 40;
    const missing: string[] = [];
    for (const needle of t.must_include || []) {
      if (!answer.toLowerCase().includes(needle.toLowerCase())) missing.push(needle);
    }
    const expectGrounded = t.grounded !== false;
    const passed = (!expectGrounded || grounded) && missing.length === 0;
    return {
      question: t.question,
      grounded,
      answer_preview: answer.slice(0, 220).replace(/\n/g, " "),
      passed,
      missing,
    };
  });
  const passed = out.filter((x) => x.passed).length;
  const markdown = [
    "HUSTRONIX CHAT E2E (Situation-grounded)",
    "────────────────────────────────────",
    ...out.map(
      (t) =>
        `${t.passed ? "✓" : "✗"} Q: ${t.question}\n   grounded=${t.grounded} missing=[${t.missing.join(", ")}]\n   → ${t.answer_preview || "(empty)"}`,
    ),
    "",
    `Passed ${passed}/${out.length}`,
  ].join("\n");
  return { turns: out, passed, total: out.length, markdown };
}

export const DEFAULT_CHAT_TURNS: ChatTurnExpect[] = [
  { question: "What is happening with HelixBio?", must_include: ["HelixBio"], grounded: true },
  { question: "Why is PayOrbit a risk?", must_include: ["PayOrbit"], grounded: true },
  { question: "What evidence do we have on Northwind?", must_include: ["Northwind"], grounded: true },
  { question: "Who is affected by LatticeOps?", grounded: true },
  { question: "What should we do about HelixBio privacy?", must_include: ["HelixBio"], grounded: true },
];
