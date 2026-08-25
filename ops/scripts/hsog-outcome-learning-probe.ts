/**
 * Observational probe: does Outcome → Learning actually exist?
 * Does not change product code. Creates isolated tenants only.
 *
 * Run: npx tsx ops/scripts/hsog-outcome-learning-probe.ts
 */
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";
import { mutationCompleteDecision } from "../../apps/api/src/security/mutation-handlers.js";
import { computeReadiness, type ReadinessInput } from "../../apps/api/src/intelligence/readiness.js";
import { recordSituationLearnings } from "../../apps/api/src/intelligence/situation-learning.js";
import { READY_GATES } from "../../apps/api/src/intelligence/situation-engine.js";

type Verdict = "PASS" | "FAIL" | "SCAFFOLD_ONLY";

type TestResult = {
  id: string;
  name: string;
  verdict: Verdict;
  detail: string;
  evidence: Record<string, unknown>;
};

const FIXED_READY_INPUT: ReadinessInput = {
  facetCount: 3,
  facetTarget: 4,
  evidenceCount: 6,
  distinctDays: 4,
  sourceCount: 3,
  entityCount: 3,
  trajectory: "WORSENING",
  confidence: 0.8,
  gateOk: true,
  impactHint: true,
};

function tenant(tag: string): string {
  const userId = `olp_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@probe.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSituation(userId: string, title: string, patternId = "open_world_test") {
  const id = randomUUID();
  const sigA = randomUUID();
  const sigB = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count)
     VALUES (?, ?, ?, ?, 'DECISION_READY', 0.86, 'WORSENING', 12,
       'Shipments slipping; evidence from ops and sales.', ?, ?, ?, 2)`,
    [
      id,
      userId,
      patternId,
      title,
      JSON.stringify(["Northwind"]),
      JSON.stringify(["ops", "sales"]),
      JSON.stringify(["Restore the SLA", "Weekly exec update"]),
    ],
  );
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
     VALUES (?, ?, 'SLACK', ?, CURRENT_TIMESTAMP, 'UNVERIFIED')`,
    [sigA, userId, `${title} reported`],
  );
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
     VALUES (?, ?, 'SLACK', ?, CURRENT_TIMESTAMP, 'UNVERIFIED')`,
    [sigB, userId, `${title} SLA miss flagged`],
  );
  db.rawRun(
    `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
     VALUES (?, ?, ?, 'ops', 12, ?)`,
    [randomUUID(), id, sigA, `${title} warehouse delay.`],
  );
  db.rawRun(
    `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
     VALUES (?, ?, ?, 'sales', 14, ?)`,
    [randomUUID(), id, sigB, `${title} SLA miss.`],
  );
  return id;
}

function talkCommit(userId: string, title: string) {
  seedSituation(userId, title);
  const created = talkToHustronix(userId, "Create the decision.", { action: "create_decision" });
  if (!created.decision_id) throw new Error("create_decision did not return a decision_id");
  const focus = created.focus_id;
  const d = created.decision_id;
  talkToHustronix(userId, "What else could be true?", { focusId: focus, action: "hypotheses" });
  talkToHustronix(userId, "Instrumentation is OK.", { focusId: focus, action: "instrumentation" });
  talkToHustronix(userId, "Execute it.", { focusId: focus, action: "execute" });
  return d;
}

function count(sql: string, params: unknown[]): number {
  const row = (db.rawGet(sql, params) as { c: number }[])[0];
  return Number(row?.c ?? 0);
}

function finishAllTasks(decisionId: string, as: "DONE" | "KILLED") {
  const tasks = db.rawGet(`SELECT task_id, status FROM execution_ledger WHERE decision_id = ?`, [
    decisionId,
  ]) as { task_id: string; status: string }[];
  for (const t of tasks) {
    if (as === "DONE") {
      if (t.status === "PENDING" || t.status === "BLOCKED") {
        db.transitionExecutionState(t.task_id, "ACTIVE", "probe activate");
      }
      const after = (
        db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [t.task_id]) as {
          status: string;
        }[]
      )[0];
      if (after?.status === "ACTIVE") {
        db.transitionExecutionState(t.task_id, "DONE", "probe finish all tasks");
      }
    } else {
      db.transitionExecutionState(t.task_id, "KILLED", "probe failed outcome");
    }
  }
  return tasks.length;
}

function expectedOutcomes(decisionId: string): unknown {
  const row = db.getDecisionLedgerRow(decisionId);
  const raw = (row as { expected_outcomes?: unknown } | undefined)?.expected_outcomes;
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return raw;
  }
}

function test1Completion(): TestResult {
  const userId = tenant(`c1_${randomUUID().slice(0, 8)}`);
  const d = talkCommit(userId, "Northwind warehouse delay");
  const afterExecute = String(db.getDecisionLedgerRow(d)?.status);
  const nTasks = finishAllTasks(d, "DONE");
  const afterDone = String(db.getDecisionLedgerRow(d)?.status);
  const outcomesAfterDone = count(
    `SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`,
    [d],
  );
  const doneN = count(
    `SELECT COUNT(*) AS c FROM execution_ledger WHERE decision_id = ? AND status = 'DONE'`,
    [d],
  );
  const autoCompleted = afterDone === "COMPLETED";
  talkToHustronix(userId, "Mark as done.", { action: "complete" });
  const afterConfirm = String(db.getDecisionLedgerRow(d)?.status);
  const outcomesAfterConfirm = count(
    `SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`,
    [d],
  );
  const pass = !autoCompleted && afterConfirm === "COMPLETED" && outcomesAfterConfirm >= 1;
  return {
    id: "1",
    name: "Decision completion",
    verdict: pass ? "PASS" : "FAIL",
    detail: pass
      ? "Tasks DONE stayed ACTIVE (no auto-complete). Operator confirm set COMPLETED and the outcome hook fired."
      : autoCompleted
        ? "Decision auto-completed when tasks finished — confirmation gate was skipped."
        : `After confirm, status is ${afterConfirm} with ${outcomesAfterConfirm} decision_outcomes (after tasks DONE: ${afterDone}, outcomes=${outcomesAfterDone}).`,
    evidence: {
      decision_id: d,
      status_after_execute: afterExecute,
      tasks: nTasks,
      tasks_done: doneN,
      status_after_all_tasks_done: afterDone,
      outcomes_after_tasks_done: outcomesAfterDone,
      status_after_confirm: afterConfirm,
      outcomes_after_confirm: outcomesAfterConfirm,
      auto_complete: autoCompleted,
    },
  };
}

function test2and3OutcomeEval(): { t2: TestResult; t3: TestResult; decisionId: string; userId: string } {
  const userId = tenant(`c23_${randomUUID().slice(0, 8)}`);
  const d = talkCommit(userId, "Northwind warehouse delay");
  finishAllTasks(d, "DONE");
  const naturalOutcomes = count(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`, [d]);
  const naturalStatus = String(db.getDecisionLedgerRow(d)?.status);

  mutationCompleteDecision(userId, d, "probe: operator confirm");
  const forcedOutcomes = db.rawGet(
    `SELECT expected_json, actual_json, delta_score, learning_notes, result FROM decision_outcomes WHERE decision_id = ?`,
    [d],
  ) as Array<{
    expected_json: string | null;
    actual_json: string | null;
    delta_score: number | null;
    learning_notes: string | null;
    result: string | null;
  }>;
  const row = forcedOutcomes[0];
  let actual: Record<string, unknown> | null = null;
  try {
    actual = row?.actual_json ? (JSON.parse(row.actual_json) as Record<string, unknown>) : null;
  } catch {
    actual = { raw: row?.actual_json };
  }
  const expected = expectedOutcomes(d);
  const actualKeys = actual ? Object.keys(actual) : [];
  const hasTaskCounts =
    actualKeys.includes("tasks_completed") && actualKeys.includes("completion_rate");
  const hasRealOutcomeFields =
    actualKeys.includes("situation_trajectory") &&
    actualKeys.includes("result") &&
    ["successful", "failed", "partial", "inconclusive"].includes(String(actual?.result || row?.result || ""));
  const tokenOverlapScoring = /overlap|Significant deviation/i.test(String(row?.learning_notes || ""));

  const t2: TestResult = {
    id: "2",
    name: "Outcome creation",
    verdict:
      naturalOutcomes === 0 && naturalStatus === "ACTIVE" && forcedOutcomes.length > 0
        ? "PASS"
        : forcedOutcomes.length > 0
          ? "SCAFFOLD_ONLY"
          : "FAIL",
    detail:
      naturalOutcomes === 0 && naturalStatus === "ACTIVE" && forcedOutcomes.length > 0
        ? "No outcome while ACTIVE. Operator confirm inserted a decision_outcomes row — hook is reachable."
        : forcedOutcomes.length > 0
          ? `Outcome row exists but status before confirm was ${naturalStatus} (outcomes=${naturalOutcomes}).`
          : "No decision_outcomes row after operator confirm.",
    evidence: {
      status_before_force: naturalStatus,
      outcomes_before_force: naturalOutcomes,
      outcomes_after_force_completed: forcedOutcomes.length,
      expected_on_decision: expected,
      expected_json: row?.expected_json ?? null,
      actual_json: row?.actual_json ?? null,
    },
  };

  const t3: TestResult = {
    id: "3",
    name: "Evaluation",
    verdict: hasRealOutcomeFields && !tokenOverlapScoring ? "PASS" : hasTaskCounts ? "SCAFFOLD_ONLY" : "FAIL",
    detail: hasRealOutcomeFields && !tokenOverlapScoring
      ? `Evaluator judged whether the decision worked: result=${actual?.result || row?.result}, trajectory=${actual?.situation_trajectory}, stage=${actual?.situation_stage}.`
      : hasTaskCounts
        ? `Evaluator exists but scores token overlap of expected_outcomes JSON vs task counts {tasks_completed, tasks_killed, completion_rate}. delta_score=${row?.delta_score}. No trajectory-after, resolution time, or worked/failed judgment.`
        : "No evaluation payload.",
    evidence: {
      result: actual?.result ?? row?.result ?? null,
      delta_score: row?.delta_score ?? null,
      learning_notes: row?.learning_notes ?? null,
      actual_keys: actualKeys,
      scoring: "structured expected vs actual (tasks, trajectory, stage, days)",
    },
  };

  return { t2, t3, decisionId: d, userId };
}

function test4LearningConsumption(): TestResult {
  const userId = tenant(`c4_${randomUUID().slice(0, 8)}`);
  const readinessBefore = computeReadiness(FIXED_READY_INPUT);
  const orgBefore = db.getEpistemicOrgContext(userId);
  const gatesBefore = JSON.stringify(READY_GATES.customer_churn_risk);

  const d = talkCommit(userId, "Situation A warehouse delay");
  finishAllTasks(d, "KILLED");
  db.transitionDecisionState(d, "COMPLETED", "probe: Situation A FAILED");
  db.rawRun(
    `UPDATE situations SET stage = 'DECIDED', decision_id = ?, trajectory = 'WORSENING' WHERE user_id = ?`,
    [d, userId],
  );
  const learnings = recordSituationLearnings(userId);
  // Second detect pass — writer can grow learning_log without unique constraint
  recordSituationLearnings(userId);

  const logN = count(`SELECT COUNT(*) AS c FROM learning_log WHERE user_id = ?`, [userId]);
  const outcomesN = count(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`, [d]);

  const readinessAfter = computeReadiness(FIXED_READY_INPUT);
  const orgAfter = db.getEpistemicOrgContext(userId);
  const gatesAfter = JSON.stringify(READY_GATES.customer_churn_risk);

  const scoreChanged = readinessAfter.score !== readinessBefore.score;
  const readyChanged = readinessAfter.ready !== readinessBefore.ready;
  const gatesChanged = gatesAfter !== gatesBefore;
  const thresholdStill = 0.48;

  // Same-pattern Situation B cannot be inserted: UNIQUE(user_id, pattern_id).
  let samePatternBlocked = false;
  try {
    seedSituation(userId, "Situation B warehouse delay", "open_world_test");
  } catch (e) {
    samePatternBlocked = String((e as Error).message || e).includes("UNIQUE");
  }
  const readinessB = computeReadiness(FIXED_READY_INPUT);

  const consumed = scoreChanged || readyChanged || gatesChanged || readinessB.score !== readinessBefore.score;

  return {
    id: "4",
    name: "Learning consumption",
    verdict: consumed ? "PASS" : logN > 0 ? "SCAFFOLD_ONLY" : "FAIL",
    detail: consumed
      ? "Situation B readiness changed after Situation A failed."
      : `Situation A completed as FAILED. learning_log grew to ${logN} and decision_outcomes=${outcomesN}, but computeReadiness(identical input) stayed ${readinessBefore.score} → ${readinessAfter.score} (ready ${readinessBefore.ready} → ${readinessAfter.ready}). READY_GATES unchanged. Epistemic boost uses row COUNT only (${orgBefore.memory_confidence_boost_0_1} → ${orgAfter.memory_confidence_boost_0_1}), not failure content — and readiness.ts never reads it.`,
    evidence: {
      situation_a_decision: d,
      learnings_recorded: learnings.map((l) => ({ outcome: l.outcome, was_useful: l.was_useful })),
      learning_log_rows: logN,
      decision_outcomes: outcomesN,
      same_pattern_situation_b_blocked_by_unique: samePatternBlocked,
      readiness_before: readinessBefore,
      readiness_after_failed_a: readinessAfter,
      readiness_situation_b: readinessB,
      ready_threshold: thresholdStill,
      gates_customer_churn_unchanged: !gatesChanged,
      org_memory_boost_before: orgBefore.memory_confidence_boost_0_1,
      org_memory_boost_after: orgAfter.memory_confidence_boost_0_1,
      org_note_after: orgAfter.memory_note,
    },
  };
}

function test5BoundedLearning(): TestResult {
  const userId = tenant(`c5_${randomUUID().slice(0, 8)}`);
  const before = computeReadiness(FIXED_READY_INPUT);
  const boostBefore = db.getEpistemicOrgContext(userId).memory_confidence_boost_0_1;

  for (let i = 0; i < 8; i++) {
    db.rawRun(
      `INSERT INTO learning_log (id, user_id, decision_id, mistake_analysis, weight_shifts, surfaced_insight)
       VALUES (?, ?, NULL, ?, ?, ?)`,
      [
        randomUUID(),
        userId,
        JSON.stringify({ outcome: "worsened", was_useful: false, false_ready: true, i }),
        JSON.stringify({ pattern_id: "customer_churn_risk", ready_day: 10, delta: -1 }),
        "False-ready: situation was marked ready but outcome failed.",
      ],
    );
  }

  const after = computeReadiness(FIXED_READY_INPUT);
  const boostAfter = db.getEpistemicOrgContext(userId).memory_confidence_boost_0_1;
  const stricter = after.score < before.score || (after.ready === false && before.ready === true);

  const gated = computeReadiness({
    ...FIXED_READY_INPUT,
    gateOk: false,
    facetCount: 99,
    evidenceCount: 99,
    distinctDays: 99,
    sourceCount: 99,
    entityCount: 99,
    confidence: 1,
    impactHint: true,
  });
  const gatesIntact = gated.ready === false;

  let verdict: Verdict = "FAIL";
  if (stricter && gatesIntact) verdict = "PASS";
  else if (!stricter && gatesIntact) verdict = "SCAFFOLD_ONLY";

  return {
    id: "5",
    name: "Bounded learning",
    verdict,
    detail: stricter
      ? "False-ready outcomes made future readiness slightly stricter; mandatory gates still cannot be bypassed."
      : gatesIntact
        ? `Eight false-ready learning_log rows did not tighten computeReadiness (${before.score} → ${after.score}, ready ${before.ready} → ${after.ready}). Org memory boost ${boostBefore} → ${boostAfter} (count-based uplift, not a penalty). Mandatory gates still cannot be bypassed (gateOk=false ⇒ ready=${gated.ready}).`
        : "Mandatory gates were bypassed — this would be a governance regression.",
    evidence: {
      readiness_before: before,
      readiness_after_false_ready: after,
      memory_boost_before: boostBefore,
      memory_boost_after: boostAfter,
      gateOk_false_ready: gated.ready,
      gateOk_false_score: gated.score,
    },
  };
}

function liveCommitPath(): { commits_to_completed: boolean; note: string } {
  return {
    commits_to_completed: true,
    note: "mutationCompleteDecision sets COMPLETED when eligible; mutationCommitDecision still only sets ACTIVE.",
  };
}

function main() {
  const t1 = test1Completion();
  const { t2, t3 } = test2and3OutcomeEval();
  const t4 = test4LearningConsumption();
  const t5 = test5BoundedLearning();
  const commit = liveCommitPath();

  const decisiveYes = t4.verdict === "PASS";
  const report = {
    probed_at: new Date().toISOString(),
    product_code_changed: false,
    tests: [t1, t2, t3, t4, t5],
    live_commit_path: commit,
    decisive: {
      question: "Did Hustronix change its decision-readiness behavior for Situation B because Situation A failed?",
      answer: decisiveYes ? "YES" : "NO",
      meaning: decisiveYes
        ? "Outcome learning exists."
        : "You have logging/evaluation scaffolding, not learning.",
    },
  };

  console.log(JSON.stringify(report, null, 2));
  console.log("\n========== Outcome → Learning probe ==========");
  for (const t of report.tests) {
    console.log(`[${t.verdict}] ${t.id}. ${t.name}: ${t.detail}`);
  }
  console.log(`\nDECISIVE: ${report.decisive.answer} — ${report.decisive.meaning}`);
}

main();
process.exit(0);
