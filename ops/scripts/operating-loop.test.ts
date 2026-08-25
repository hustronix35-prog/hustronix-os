/**
 * Operating loop: reverse, hours capacity, idempotent learning, dep direction, impact match.
 * Run: npx tsx --test ops/scripts/operating-loop.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import {
  mutationCompleteDecision,
  mutationCreateDraftDecision,
  mutationReverseDecision,
} from "../../apps/api/src/security/mutation-handlers.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";
import { recordSituationLearnings } from "../../apps/api/src/intelligence/situation-learning.js";
import { buildOrgIntelligence } from "../../apps/api/src/org/intelligence.js";
import { applySituationFollowthrough } from "../../apps/api/src/evaluation/situation-followthrough.js";

function tenant(tag: string): string {
  const userId = `oloop_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSituation(userId: string, title: string, extras?: { people?: string[]; teams?: string[] }) {
  const id = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, people_json, teams_json, recommended_actions_json, evidence_count)
     VALUES (?, ?, ?, ?, 'DECISION_READY', 0.86, 'WORSENING', 12,
       'Shipments slipping; evidence from ops and sales.', ?, ?, ?, ?, ?, 2)`,
    [
      id,
      userId,
      `open_world_test_${id.slice(0, 8)}`,
      title,
      JSON.stringify(["Northwind"]),
      JSON.stringify(["ops", "sales"]),
      JSON.stringify(extras?.people || ["Priya"]),
      JSON.stringify(extras?.teams || ["Customer Success", "Engineering", "Security"]),
      JSON.stringify(["Restore the SLA"]),
    ],
  );
  return id;
}

function talkCommit(userId: string, title = "Northwind warehouse delay") {
  seedSituation(userId, title);
  const created = talkToHustronix(userId, "Create the decision.", { action: "create_decision" });
  talkToHustronix(userId, "What else could be true?", { focusId: created.focus_id, action: "hypotheses" });
  talkToHustronix(userId, "Instrumentation is OK.", { focusId: created.focus_id, action: "instrumentation" });
  talkToHustronix(userId, "Execute it.", { focusId: created.focus_id, action: "execute" });
  return { decisionId: created.decision_id!, focusId: created.focus_id, situationId: created.focus_id };
}

describe("operating loop — reverse + followthrough", () => {
  it("ACTIVE → REVERSED and situation leaves DECIDED", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId, focusId, situationId } = talkCommit(userId);
    assert.equal(String(db.getDecisionLedgerRow(decisionId)?.status), "ACTIVE");
    const turn = talkToHustronix(userId, "It didn't work. Reverse this decision.", {
      focusId,
      action: "reverse",
    });
    assert.match(turn.answer, /REVERSED/i);
    assert.equal(String(db.getDecisionLedgerRow(decisionId)?.status), "REVERSED");
    const sit = (
      db.rawGet(`SELECT stage FROM situations WHERE id = ?`, [situationId]) as { stage: string }[]
    )[0];
    assert.ok(sit.stage === "DECISION_READY" || sit.stage === "ELEVATED");
    assert.throws(() => mutationReverseDecision(userId, decisionId, "again"), /already REVERSED/i);
  });

  it("COMPLETED while worsening does not resolve the situation", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { decisionId, situationId } = talkCommit(userId);
    const tasks = db.rawGet(`SELECT task_id, status FROM execution_ledger WHERE decision_id = ?`, [
      decisionId,
    ]) as { task_id: string; status: string }[];
    for (const t of tasks) {
      if (t.status !== "ACTIVE") db.transitionExecutionState(t.task_id, "ACTIVE", "test", true);
      const after = (
        db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [t.task_id]) as { status: string }[]
      )[0];
      if (after?.status === "ACTIVE") db.transitionExecutionState(t.task_id, "DONE", "test", true);
    }
    mutationCompleteDecision(userId, decisionId, "done");
    const sit = (
      db.rawGet(`SELECT stage, trajectory FROM situations WHERE id = ?`, [situationId]) as {
        stage: string;
        trajectory: string;
      }[]
    )[0];
    assert.equal(sit.trajectory, "WORSENING");
    assert.notEqual(sit.stage, "RESOLVED");
    const follow = applySituationFollowthrough(decisionId, "COMPLETED");
    assert.equal(follow.nextStage, "DECIDED");
  });
});

describe("operating loop — hours capacity", () => {
  it("40h − 32h − 16h BLOCKED with overload message", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const owner = `Priya${userId.slice(-6)}`;
    db.upsertTeamRosterByEmail(userId, {
      name: owner,
      email: `${owner.toLowerCase()}@hustronix.io`,
      role: "CS",
      team: "customer success",
      capacity: "40h / week",
      slackId: owner,
    });
    const cap = db.getOwnerCapacity(owner, userId);
    assert.equal(cap.roster_hours, 40);
    assert.equal(cap.capacity, 5);

    const existing = mutationCreateDraftDecision(userId, {
      vow: `Existing load ${userId}`,
      tasks: [1, 2, 3, 4].map((n) => ({
        owner,
        type: "ACTION",
        weight: 1,
        success_condition: `Existing ${n}`,
        estimated_duration_hours: 8,
      })),
    });
    db.transitionDecisionState(existing.id, "ACTIVE", "test");
    const existingTasks = db.rawGet(`SELECT task_id FROM execution_ledger WHERE decision_id = ?`, [
      existing.id,
    ]) as { task_id: string }[];
    for (const t of existingTasks) {
      db.rawRun(`UPDATE execution_ledger SET estimated_duration_hours = 8 WHERE task_id = ?`, [t.task_id]);
      const r = db.transitionExecutionState(t.task_id, "ACTIVE", "seed load", true);
      assert.equal(r.status, "ACTIVE", JSON.stringify(r));
    }
    assert.equal(db.getOwnerActiveHours(owner, userId), 32);

    const next = mutationCreateDraftDecision(userId, {
      vow: `New 16h ${userId}`,
      tasks: [{ owner, type: "ACTION", weight: 1, success_condition: "New work", estimated_duration_hours: 16 }],
    });
    db.transitionDecisionState(next.id, "ACTIVE", "test");
    const neu = (
      db.rawGet(`SELECT task_id FROM execution_ledger WHERE decision_id = ?`, [next.id]) as { task_id: string }[]
    )[0];
    db.rawRun(`UPDATE execution_ledger SET estimated_duration_hours = 16 WHERE task_id = ?`, [neu.task_id]);
    const blocked = db.transitionExecutionState(neu.task_id, "ACTIVE", "new work", true);
    assert.equal(blocked.status, "BLOCKED");
    assert.ok((blocked.reasons || []).includes("capacity_exceeded"));
    assert.match(String(blocked.message || ""), /overloaded by 8/i);
  });
});

describe("operating loop — learning_log quality", () => {
  it("detect-style situation_decide writes once per situation", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const sitId = seedSituation(userId, "Acme renewal risk");
    db.rawRun(`UPDATE situations SET stage = 'DECIDED' WHERE id = ?`, [sitId]);
    recordSituationLearnings(userId);
    recordSituationLearnings(userId);
    recordSituationLearnings(userId);
    const n = (
      db.rawGet(
        `SELECT COUNT(*) AS c FROM learning_log WHERE user_id = ? AND kind = 'situation_decide'`,
        [userId],
      ) as { c: number }[]
    )[0];
    assert.equal(Number(n.c), 1);
  });
});

describe("operating loop — dependency direction", () => {
  it("ledger sync is from=waiter to=blocker", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    db.insertTeamRosterMember(userId, {
      name: "Eng Waiter",
      email: `eng.${userId}@hustronix.test`,
      role: "Engineer",
      team: "Engineering",
      capacity: "40h / week",
    });
    db.insertTeamRosterMember(userId, {
      name: "Sec Blocker",
      email: `sec.${userId}@hustronix.test`,
      role: "Security",
      team: "Security",
      capacity: "40h / week",
    });
    const decisionId = db.saveDecisionEvent(userId, {
      vow: `Audit ${userId}`,
      tasks: [
        { owner: "Sec Blocker", type: "ACTION", weight: 1, success_condition: "Security approval" },
        { owner: "Eng Waiter", type: "ACTION", weight: 1, success_condition: "Ship after approval" },
      ],
    });
    const tasks = db.rawGet(`SELECT task_id, owner FROM execution_ledger WHERE decision_id = ?`, [
      decisionId,
    ]) as { task_id: string; owner: string }[];
    const blocker = tasks.find((t) => t.owner === "Sec Blocker")!;
    const waiter = tasks.find((t) => t.owner === "Eng Waiter")!;
    db.rawRun(`UPDATE execution_ledger SET dependencies = ? WHERE task_id = ?`, [
      JSON.stringify([blocker.task_id]),
      waiter.task_id,
    ]);
    const org = buildOrgIntelligence(userId);
    const edge = org.dependencies.find((d) => d.executionId === waiter.task_id);
    assert.ok(edge, "ledger edge missing");
    assert.equal(edge!.fromTeam, "Engineering");
    assert.equal(edge!.toTeam, "Security");
  });
});

describe("operating loop — impact matching", () => {
  it("does not match on title.slice(0,18)", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedSituation(userId, "Northwind warehouse delay ALPHA", {
      teams: ["Sales"],
      people: ["Jordan"],
    });
    seedSituation(userId, "Northwind warehouse delay BRAVO", {
      teams: ["Security"],
      people: ["Leah"],
    });
    const turn = talkToHustronix(userId, "Who is affected by Northwind warehouse delay ALPHA?");
    assert.match(turn.answer, /Sales/i);
    assert.doesNotMatch(turn.answer, /title\.slice/);
    assert.ok(!turn.answer.toLowerCase().includes("leah") || turn.answer.toLowerCase().includes("jordan"));
  });
});
