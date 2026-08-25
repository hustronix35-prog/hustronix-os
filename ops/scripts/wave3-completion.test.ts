/**
 * Wave 3 slice 1: COMPLETED is a governed confirm, not auto from task DONE.
 * Run: npx tsx --test ops/scripts/wave3-completion.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { mutationCompleteDecision } from "../../apps/api/src/security/mutation-handlers.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { getDecisionCompletionEligibility } from "../../apps/api/src/evaluation/completion-eligibility.js";

function tenant(tag: string): string {
  const userId = `w3c_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSituation(userId: string) {
  const id = randomUUID();
  const sigA = randomUUID();
  const sigB = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count)
     VALUES (?, ?, 'open_world_test', 'Northwind warehouse delay', 'DECISION_READY', 0.86, 'WORSENING', 12,
       'Shipments slipping; evidence from ops and sales.', ?, ?, ?, 2)`,
    [
      id,
      userId,
      JSON.stringify(["Northwind"]),
      JSON.stringify(["ops", "sales"]),
      JSON.stringify(["Restore the SLA", "Weekly exec update"]),
    ],
  );
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
     VALUES (?, ?, 'SLACK', 'Northwind warehouse delay reported', CURRENT_TIMESTAMP, 'UNVERIFIED')`,
    [sigA, userId],
  );
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
     VALUES (?, ?, 'SLACK', 'Northwind SLA miss flagged', CURRENT_TIMESTAMP, 'UNVERIFIED')`,
    [sigB, userId],
  );
  db.rawRun(
    `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
     VALUES (?, ?, ?, 'ops', 12, 'Warehouse delay on Northwind outbound.')`,
    [randomUUID(), id, sigA],
  );
  db.rawRun(
    `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
     VALUES (?, ?, ?, 'sales', 14, 'Account team flags Northwind SLA miss.')`,
    [randomUUID(), id, sigB],
  );
  return id;
}

function talkCommit(userId: string) {
  seedSituation(userId);
  const created = talkToHustronix(userId, "Create the decision.", { action: "create_decision" });
  const d = created.decision_id!;
  talkToHustronix(userId, "What else could be true?", { focusId: created.focus_id, action: "hypotheses" });
  talkToHustronix(userId, "Instrumentation is OK.", { focusId: created.focus_id, action: "instrumentation" });
  talkToHustronix(userId, "Execute it.", { focusId: created.focus_id, action: "execute" });
  return { decisionId: d, focusId: created.focus_id };
}

function finishAllTasks(decisionId: string) {
  const tasks = db.rawGet(`SELECT task_id, status FROM execution_ledger WHERE decision_id = ?`, [
    decisionId,
  ]) as { task_id: string; status: string }[];
  for (const t of tasks) {
    if (t.status === "PENDING" || t.status === "BLOCKED") {
      db.transitionExecutionState(t.task_id, "ACTIVE", "test activate");
    }
    const after = (
      db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [t.task_id]) as { status: string }[]
    )[0];
    if (after?.status === "ACTIVE") {
      db.transitionExecutionState(t.task_id, "DONE", "test finish");
    }
  }
  return tasks.length;
}

function outcomeCount(decisionId: string): number {
  const row = (
    db.rawGet(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`, [decisionId]) as {
      c: number;
    }[]
  )[0];
  return Number(row?.c ?? 0);
}

describe("Wave 3 slice 1 completion", () => {
  it("tasks DONE stay ACTIVE; complete chip appears; no outcomes yet", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId, focusId } = talkCommit(userId);
    assert.equal(String(db.getDecisionLedgerRow(decisionId)?.status), "ACTIVE");
    finishAllTasks(decisionId);
    assert.equal(String(db.getDecisionLedgerRow(decisionId)?.status), "ACTIVE");
    assert.equal(outcomeCount(decisionId), 0);
    assert.equal(getDecisionCompletionEligibility(decisionId).eligible, true);
    const turn = talkToHustronix(userId, "What's the status?", { focusId });
    assert.ok(turn.actions.some((a) => a.kind === "complete"));
    assert.ok(!turn.actions.some((a) => a.kind === "execute"));
  });

  it("complete before all tasks DONE throws; status stays ACTIVE", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId } = talkCommit(userId);
    assert.throws(() => mutationCompleteDecision(userId, decisionId, "too early"), /Not eligible|still open/i);
    assert.equal(String(db.getDecisionLedgerRow(decisionId)?.status), "ACTIVE");
    assert.equal(outcomeCount(decisionId), 0);
  });

  it("Talk confirm → COMPLETED and outcome hook fires", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId, focusId } = talkCommit(userId);
    finishAllTasks(decisionId);
    const turn = talkToHustronix(userId, "Mark as done.", { focusId, action: "complete" });
    assert.match(turn.answer, /COMPLETED/i);
    assert.equal(String(db.getDecisionLedgerRow(decisionId)?.status), "COMPLETED");
    assert.ok(outcomeCount(decisionId) >= 1);
  });

  it("second complete throws; detect does not flip status", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId } = talkCommit(userId);
    finishAllTasks(decisionId);
    mutationCompleteDecision(userId, decisionId, "first complete");
    assert.throws(() => mutationCompleteDecision(userId, decisionId, "second"), /already COMPLETED/i);
    assert.equal(String(db.getDecisionLedgerRow(decisionId)?.status), "COMPLETED");

    const userId2 = tenant(randomUUID().slice(0, 8));
    const second = talkCommit(userId2);
    finishAllTasks(second.decisionId);
    runSituationDetection(userId2);
    assert.equal(String(db.getDecisionLedgerRow(second.decisionId)?.status), "ACTIVE");
    assert.equal(outcomeCount(second.decisionId), 0);
  });
});
