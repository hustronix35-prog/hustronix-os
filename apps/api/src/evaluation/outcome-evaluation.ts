import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { applyEvidence } from "../beliefs/belief-engine.js";
import { resolveTenantContext } from "../security/tenant-context.js";
import type { EpistemicState } from "../security/epistemics.js";
import { requireEpistemicSupport } from "../security/epistemics.js";
import { attachEpistemicDerivation, type EpistemicOrgContext } from "../epistemic-engine.js";
import { emitDecisionOutcomeEvidence } from "../execution-intelligence/index.js";
import { expectedOutcomeForSituation, type ExpectedOutcome } from "./expected-outcome.js";
import { learningPatternId, updateFromOutcome } from "../intelligence/readiness-learning.js";
import { upsertLearningLog } from "./learning-log.js";

export type OutcomeResult = "successful" | "failed" | "partial" | "inconclusive";

export interface OutcomeEvaluation {
  decisionId: string;
  result: OutcomeResult;
  deltaScore: number | null;
  expected: ExpectedOutcome;
  actual: Record<string, unknown>;
  learningNotes: string;
}

function parseJsonSafe(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return raw;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function coerceExpected(raw: unknown, fallbackTitle: string): ExpectedOutcome {
  const base = expectedOutcomeForSituation({ title: fallbackTitle });
  const first = Array.isArray(raw) ? raw[0] : raw;
  const obj = asRecord(first);
  if (!obj) return base;
  const success = asRecord(obj.success);
  const windowDays =
    Number(obj.time_window_days ?? obj.window_days ?? base.window_days) || base.window_days;
  const conditionsRaw = obj.success_conditions;
  const success_conditions = Array.isArray(conditionsRaw)
    ? conditionsRaw.map(String)
    : base.success_conditions;
  const trajRaw = String(obj.trajectory || base.trajectory || "IMPROVING").toUpperCase();
  const trajectory: ExpectedOutcome["trajectory"] =
    trajRaw === "WORSENING" || trajRaw === "STABLE" ? trajRaw : "IMPROVING";
  return {
    statement: String(obj.statement || obj.target || base.statement),
    metric: String(obj.metric || fallbackTitle),
    target: String(obj.target || base.target),
    trajectory,
    window_days: windowDays,
    time_window_days: windowDays,
    success_conditions,
    success: {
      all_tasks_done: success?.all_tasks_done !== false,
      max_killed: Number(success?.max_killed ?? 0),
      fail_if_worsening: success?.fail_if_worsening !== false,
      succeed_if_improving_or_resolved: success?.succeed_if_improving_or_resolved !== false,
    },
  };
}

function daysBetween(fromIso: unknown, toIso: unknown): number | null {
  const a = Date.parse(String(fromIso || ""));
  const b = Date.parse(String(toIso || "")) || Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function judgeOutcome(params: {
  decisionStatus: string;
  expected: ExpectedOutcome;
  completionRate: number;
  killed: number;
  trajectory: string | null;
  stage: string | null;
  linkedSituation: boolean;
  daysToComplete: number | null;
}): { result: OutcomeResult; deltaScore: number | null; notes: string } {
  const { expected, completionRate, killed, trajectory, stage, linkedSituation, daysToComplete } = params;
  if (params.decisionStatus === "REVERSED") {
    return {
      result: "failed",
      deltaScore: 0,
      notes: "Decision was REVERSED. Result: failed.",
    };
  }

  const executionClean = completionRate >= 1 && killed <= expected.success.max_killed;
  const parts: string[] = [
    `Expected: ${expected.target}.`,
    `Actual: ${linkedSituation ? `trajectory ${trajectory || "unknown"}, stage ${stage || "unknown"}` : "no linked situation"}; tasks completion_rate=${completionRate}${killed ? `, killed=${killed}` : ""}${daysToComplete != null ? `, ${daysToComplete} day(s)` : ""}.`,
  ];

  if (!linkedSituation) {
    parts.push("Result: inconclusive — execution finished but there is no linked situation to judge whether it worked.");
    return { result: "inconclusive", deltaScore: null, notes: parts.join(" ") };
  }

  if (!executionClean) {
    parts.push("Result: failed — governed tasks did not complete cleanly.");
    return { result: "failed", deltaScore: 0, notes: parts.join(" ") };
  }

  if (expected.success.fail_if_worsening && trajectory === "WORSENING") {
    parts.push("Result: failed — situation still worsening after execution.");
    return { result: "failed", deltaScore: 0, notes: parts.join(" ") };
  }

  const improved = stage === "RESOLVED" || trajectory === "IMPROVING";
  if (expected.success.succeed_if_improving_or_resolved && improved) {
    const late =
      daysToComplete != null && daysToComplete > expected.window_days
        ? ` Outside the ${expected.window_days}-day window (${daysToComplete}d).`
        : "";
    if (late) {
      parts.push(`Result: partial — situation improved, but${late}`);
      return { result: "partial", deltaScore: 0.5, notes: parts.join(" ") };
    }
    parts.push("Result: successful — situation improved or resolved.");
    return { result: "successful", deltaScore: 1, notes: parts.join(" ") };
  }

  parts.push("Result: partial — work finished, but the situation is not clearly improved.");
  return { result: "partial", deltaScore: 0.5, notes: parts.join(" ") };
}

function buildOrgContext(tenantId: string): EpistemicOrgContext {
  const completed = db.rawGet(
    `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status IN ('COMPLETED','REVERSED')`,
    [tenantId],
  ).at(0) as { c: number };
  const learning = db.rawGet(
    `SELECT COUNT(*) AS c FROM learning_log WHERE user_id = ?`,
    [tenantId],
  ).at(0) as { c: number };
  return {
    completed_decisions: completed?.c ?? 0,
    learning_log_entries: learning?.c ?? 0,
    memory_confidence_boost_0_1: Math.min(0.08, (learning?.c ?? 0) * 0.01),
    memory_note: "outcome-evaluation",
  };
}

/**
 * Compare expected vs actual when a decision reaches COMPLETED or REVERSED.
 * Records whether the decision worked — not merely that tasks finished.
 * Does not retune readiness and does not mutate the situation.
 */
export function evaluateDecisionOutcome(decisionId: string): OutcomeEvaluation | null {
  const row = db.getDecisionLedgerRow(decisionId);
  if (!row) return null;

  const tenantId = String(row.user_id || "system");
  const decisionStatus = String(row.status || "");
  const expected = coerceExpected(parseJsonSafe(row.expected_outcomes), String(row.vow || "decision"));

  const tasks = db.rawGet(
    `SELECT status, weight, owner FROM execution_ledger WHERE decision_id = ?`,
    [decisionId],
  ) as { status: string; weight: number; owner: string }[];

  const done = tasks.filter((t) => t.status === "DONE").length;
  const killed = tasks.filter((t) => t.status === "KILLED").length;
  const completionRate = tasks.length ? done / tasks.length : 0;

  const sit = (
    db.rawGet(
      `SELECT id, stage, trajectory, title, pattern_id FROM situations WHERE decision_id = ? LIMIT 1`,
      [decisionId],
    ) as { id: string; stage: string; trajectory: string; title: string; pattern_id: string }[]
  )[0];
  const outcomePatternId = sit?.pattern_id ? learningPatternId(sit.pattern_id) : null;

  const daysToComplete = daysBetween(row.created_at, row.last_update);
  const judged = judgeOutcome({
    decisionStatus,
    expected,
    completionRate,
    killed,
    trajectory: sit?.trajectory ?? null,
    stage: sit?.stage ?? null,
    linkedSituation: Boolean(sit),
    daysToComplete,
  });

  const actual: Record<string, unknown> = {
    trajectory: sit?.trajectory ?? null,
    situation_trajectory: sit?.trajectory ?? null,
    completion_rate: completionRate,
    days_to_complete: daysToComplete,
    tasks_completed: done,
    tasks_killed: killed,
    situation_id: sit?.id ?? null,
    situation_stage: sit?.stage ?? null,
    result: judged.result,
  };

  const existing = (
    db.rawGet(`SELECT id FROM decision_outcomes WHERE decision_id = ? LIMIT 1`, [decisionId]) as {
      id: string;
    }[]
  )[0];
  const outcomeId = existing?.id || uuidv4();
  if (existing) {
    db.rawRun(
      `UPDATE decision_outcomes
       SET expected_json = ?, actual_json = ?, delta_score = ?, learning_notes = ?, result = ?, pattern_id = COALESCE(pattern_id, ?), evaluated_at = CURRENT_TIMESTAMP
       WHERE decision_id = ?`,
      [
        JSON.stringify(expected),
        JSON.stringify(actual),
        judged.deltaScore,
        judged.notes,
        judged.result,
        outcomePatternId,
        decisionId,
      ],
    );
  } else {
    db.rawRun(
      `INSERT INTO decision_outcomes (id, tenant_id, decision_id, expected_json, actual_json, delta_score, learning_notes, result, pattern_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        outcomeId,
        tenantId,
        decisionId,
        JSON.stringify(expected),
        JSON.stringify(actual),
        judged.deltaScore,
        judged.notes,
        judged.result,
        outcomePatternId,
      ],
    );
  }

  const beliefs = db.rawGet(
    `SELECT id FROM beliefs WHERE tenant_id = ? AND source_decision_id = ?`,
    [tenantId, decisionId],
  ) as { id: string }[];

  for (const b of beliefs) {
    const score = judged.deltaScore ?? 0;
    applyEvidence(b.id, {
      evidenceType: "decision",
      evidenceId: decisionId,
      relationship: judged.result === "successful" ? "SUPPORTS" : "CONTRADICTS",
      sourceQuality: score,
    });
  }

  if (row.decision_reasoning) {
    try {
      const memo = JSON.parse(String(row.decision_reasoning));
      const org = buildOrgContext(tenantId);
      attachEpistemicDerivation(memo, org);
    } catch {
      /* ignore */
    }
  }

  db.rawRun(
    `INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`,
    ["DECISION_OUTCOME_EVALUATED", `result=${judged.result} delta=${judged.deltaScore ?? "n/a"}`, decisionId],
  );

  const primaryOwner =
    (
      db.rawGet(
        `SELECT owner FROM execution_ledger WHERE decision_id = ? ORDER BY weight DESC LIMIT 1`,
        [decisionId],
      ) as { owner: string }[]
    )[0]?.owner || tenantId;
  emitDecisionOutcomeEvidence({
    tenantId,
    decisionId,
    owner: primaryOwner,
    deltaScore: judged.deltaScore ?? 0,
  });

  upsertLearningLog({
    userId: tenantId,
    kind: "decision_outcome",
    keyId: decisionId,
    decisionId,
    insight: judged.notes,
    analysis: { result: judged.result, expected, actual },
    weights: { pattern_id: outcomePatternId },
  });

  updateFromOutcome(decisionId);

  return {
    decisionId,
    result: judged.result,
    deltaScore: judged.deltaScore,
    expected,
    actual,
    learningNotes: judged.notes,
  };
}

export function getLatestDecisionOutcome(decisionId: string): {
  result: string | null;
  delta_score: number | null;
  learning_notes: string | null;
  actual_json: string | null;
  expected_json: string | null;
} | null {
  return (
    (
      db.rawGet(
        `SELECT result, delta_score, learning_notes, actual_json, expected_json
         FROM decision_outcomes WHERE decision_id = ? ORDER BY evaluated_at DESC LIMIT 1`,
        [decisionId],
      ) as Array<{
        result: string | null;
        delta_score: number | null;
        learning_notes: string | null;
        actual_json: string | null;
        expected_json: string | null;
      }>
    )[0] ?? null
  );
}

/** Gate high-risk commits with epistemic support requirements. */
export function assertEpistemicSupportForCommit(userId: string, decisionId: string): void {
  const row = db.getDecisionLedgerRow(decisionId);
  if (!row?.decision_reasoning) return;

  let memo: Record<string, unknown> & {
    decision_confidence_0_1?: number;
    confidence_0_1?: number;
    reversibility_0_1?: number;
    recommended_actions?: { risk?: string }[];
    epistemic_derivation?: { computed_confidence_0_1?: number; truth_state?: string };
  };
  try {
    memo = JSON.parse(String(row.decision_reasoning));
  } catch {
    return;
  }

  const highRisk = (memo.recommended_actions ?? []).some((a) => a.risk === "HIGH");
  const irreversible = (memo.reversibility_0_1 ?? 1) < 0.35;
  if (!highRisk && !irreversible) return;

  const org = buildOrgContext(resolveTenantContext(userId).orgId);
  attachEpistemicDerivation(memo as any, org);
  const derived = memo.epistemic_derivation;
  const rawConf = derived?.computed_confidence_0_1;
  const confidence =
    typeof rawConf === "number" && Number.isFinite(rawConf)
      ? rawConf
      : Number((row as { confidence?: number }).confidence ?? 0.5);

  const epistemic: EpistemicState = {
    truthState: (derived?.truth_state as EpistemicState["truthState"]) ?? "supported",
    confidence,
    uncertainty: 1 - confidence,
  };

  requireEpistemicSupport(epistemic, {
    maxUncertainty: irreversible ? 0.2 : 0.35,
    minConfidence: highRisk ? 0.72 : 0.55,
    irreversible,
  });
}

export function onDecisionTerminalState(decisionId: string, newState: string): void {
  if (newState === "COMPLETED" || newState === "REVERSED") {
    evaluateDecisionOutcome(decisionId);
  }
}
