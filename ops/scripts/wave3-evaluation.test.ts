/**
 * Wave 3 slice 2: decision_outcomes answers whether the decision worked.
 * Run: npx tsx --test ops/scripts/wave3-evaluation.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { mutationCompleteDecision } from "../../apps/api/src/security/mutation-handlers.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";
import { evaluateDecisionOutcome } from "../../apps/api/src/evaluation/outcome-evaluation.js";
import { computeReadiness } from "../../apps/api/src/intelligence/readiness.js";

function tenant(tag: string): string {
  const userId = `w3e_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSituation(userId: string, title = "Northwind warehouse delay") {
  const id = randomUUID();
  const sigA = randomUUID();
  const sigB = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count)
     VALUES (?, ?, 'open_world_test', ?, 'DECISION_READY', 0.86, 'WORSENING', 12,
       'Shipments slipping; evidence from ops and sales.', ?, ?, ?, 2)`,
    [
      id,
      userId,
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

function talkCommit(userId: string, title?: string) {
  seedSituation(userId, title);
  const created = talkToHustronix(userId, "Create the decision.", { action: "create_decision" });
  const d = created.decision_id!;
  talkToHustronix(userId, "What else could be true?", { focusId: created.focus_id, action: "hypotheses" });
  talkToHustronix(userId, "Instrumentation is OK.", { focusId: created.focus_id, action: "instrumentation" });
  talkToHustronix(userId, "Execute it.", { focusId: created.focus_id, action: "execute" });
  return { decisionId: d, focusId: created.focus_id, situationId: created.focus_id };
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
}

function outcomeRow(decisionId: string) {
  return (
    db.rawGet(
      `SELECT result, delta_score, actual_json, expected_json, learning_notes FROM decision_outcomes WHERE decision_id = ?`,
      [decisionId],
    ) as Array<{
      result: string | null;
      delta_score: number | null;
      actual_json: string | null;
      expected_json: string | null;
      learning_notes: string | null;
    }>
  )[0];
}

describe("Wave 3 slice 2 evaluation", () => {
  it("COMPLETED with worsening situation is failed, not token-overlap", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId } = talkCommit(userId);
    finishAllTasks(decisionId);
    mutationCompleteDecision(userId, decisionId, "confirm");
    const row = outcomeRow(decisionId);
    assert.ok(row);
    const actual = JSON.parse(String(row.actual_json));
    assert.equal(row.result, "failed");
    assert.equal(actual.result, "failed");
    assert.equal(actual.situation_trajectory, "WORSENING");
    assert.equal(actual.completion_rate, 1);
    assert.equal(typeof actual.days_to_complete, "number");
    assert.match(String(row.learning_notes), /failed/i);
    assert.doesNotMatch(String(row.learning_notes), /Significant deviation/i);
    const sit = (
      db.rawGet(`SELECT stage FROM situations WHERE decision_id = ?`, [decisionId]) as { stage: string }[]
    )[0];
    assert.notEqual(sit?.stage, "RESOLVED");
  });

  it("COMPLETED with improving situation is successful", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId } = talkCommit(userId, "Northwind recovery");
    finishAllTasks(decisionId);
    db.rawRun(`UPDATE situations SET trajectory = 'IMPROVING' WHERE decision_id = ?`, [decisionId]);
    mutationCompleteDecision(userId, decisionId, "confirm");
    const row = outcomeRow(decisionId);
    assert.equal(row?.result, "successful");
    const actual = JSON.parse(String(row?.actual_json));
    assert.equal(actual.situation_trajectory, "IMPROVING");
    assert.equal(row?.delta_score, 1);
  });

  it("upserts a single decision_outcomes row; readiness unchanged", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId } = talkCommit(userId);
    finishAllTasks(decisionId);
    const before = computeReadiness({
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
    });
    mutationCompleteDecision(userId, decisionId, "confirm");
    evaluateDecisionOutcome(decisionId);
    const n = (
      db.rawGet(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`, [decisionId]) as {
        c: number;
      }[]
    )[0];
    assert.equal(Number(n.c), 1);
    const after = computeReadiness({
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
    });
    assert.equal(after.score, before.score);
    assert.equal(after.ready, before.ready);
  });
});
