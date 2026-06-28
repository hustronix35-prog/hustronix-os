import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { applyEvidence } from "../beliefs/belief-engine.js";
import { computeDynamicConfidence } from "../state/confidence.js";
import { resolveTenantContext } from "../security/tenant-context.js";
import type { EpistemicState } from "../security/epistemics.js";
import { requireEpistemicSupport } from "../security/epistemics.js";
import { attachEpistemicDerivation, type EpistemicOrgContext } from "../epistemic-engine.js";

export interface OutcomeEvaluation {
  decisionId: string;
  deltaScore: number;
  expected: unknown;
  actual: unknown;
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

function scoreOutcome(expected: unknown, actual: unknown): number {
  const expStr = JSON.stringify(expected ?? {});
  const actStr = JSON.stringify(actual ?? {});
  if (expStr === actStr) return 1;
  const overlap = expStr.split(/[^a-z0-9]+/i).filter((t) => t.length > 3 && actStr.includes(t));
  return Math.min(1, overlap.length / 8);
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
 * Compare expected vs actual outcomes when a decision reaches COMPLETED or REVERSED.
 */
export function evaluateDecisionOutcome(decisionId: string): OutcomeEvaluation | null {
  const row = db.getDecisionLedgerRow(decisionId);
  if (!row) return null;

  const tenantId = String(row.user_id || "system");
  const expected = parseJsonSafe(row.expected_outcomes);

  const tasks = db.rawGet(
    `SELECT status, weight, owner FROM execution_ledger WHERE decision_id = ?`,
    [decisionId],
  ) as { status: string; weight: number; owner: string }[];

  const done = tasks.filter((t) => t.status === "DONE").length;
  const killed = tasks.filter((t) => t.status === "KILLED").length;
  const actual = {
    tasks_completed: done,
    tasks_killed: killed,
    completion_rate: tasks.length ? done / tasks.length : 0,
  };

  const deltaScore = scoreOutcome(expected, actual);
  const learningNotes =
    deltaScore >= 0.75
      ? "Outcome aligned with stated expectations."
      : deltaScore >= 0.45
        ? "Partial alignment — review validation requirements for next commit."
        : "Significant deviation — update beliefs and institutional priors.";

  const outcomeId = uuidv4();
  db.rawRun(
    `INSERT INTO decision_outcomes (id, tenant_id, decision_id, expected_json, actual_json, delta_score, learning_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      outcomeId,
      tenantId,
      decisionId,
      JSON.stringify(expected),
      JSON.stringify(actual),
      deltaScore,
      learningNotes,
    ],
  );

  db.rawRun(
    `INSERT INTO learning_log (id, user_id, decision_id, mistake_analysis, surfaced_insight)
     VALUES (?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      tenantId,
      decisionId,
      deltaScore < 0.5 ? learningNotes : null,
      learningNotes,
    ],
  );

  const beliefs = db.rawGet(
    `SELECT id FROM beliefs WHERE tenant_id = ? AND source_decision_id = ?`,
    [tenantId, decisionId],
  ) as { id: string }[];

  for (const b of beliefs) {
    applyEvidence(b.id, {
      evidenceType: "decision",
      evidenceId: decisionId,
      relationship: deltaScore >= 0.5 ? "SUPPORTS" : "CONTRADICTS",
      sourceQuality: deltaScore,
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
    ["DECISION_OUTCOME_EVALUATED", `delta=${deltaScore.toFixed(2)}`, decisionId],
  );

  return { decisionId, deltaScore, expected, actual, learningNotes };
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
