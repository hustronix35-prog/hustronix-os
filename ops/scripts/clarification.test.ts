/**
 * Clarification exception-channel tests.
 * Run: npm run test:clarification (from apps/api) or npm -w @hustronix/api run test:clarification
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import {
  answerClarification,
  buildClarificationCopy,
  detectClarificationNeed,
  dismissClarification,
  extractClaimsHeuristic,
  listClarifications,
  openClarificationIfNeeded,
  scanClarifications,
  validateClaims,
} from "../../apps/api/src/clarification/index.js";

function ensureTenant(seed: string): string {
  /** Keep first 12 chars unique — org slug is `org-${userId.slice(0, 12)}`. */
  const userId = `cfy${seed}`;
  if (!db.getUser(userId)) {
    db.createUser(userId, userId, hashPassword(`test-${userId}`));
  }
  return userId;
}

function seedBlockedTask(userId: string, owner = "Priya") {
  const vow = `Clarify payment integration ${uuidv4().slice(0, 8)}`;
  const decisionId = db.saveDecisionEvent(userId, {
    vow,
    expected_outcomes: [{ metric: "Launch", target: "Aug 18" }],
    tasks: [
      {
        owner,
        type: "ACTION",
        weight: 1,
        success_condition: "Launch payment integration",
      },
    ],
  });
  const exec = db.rawGet(
    `SELECT task_id FROM execution_ledger WHERE decision_id = ? LIMIT 1`,
    [decisionId],
  )[0] as { task_id: string };
  db.transitionExecutionState(exec.task_id, "BLOCKED", "API dependency unresolved", true);
  db.rawRun(
    `UPDATE execution_ledger SET blocked_reasons = ?, last_update = CURRENT_TIMESTAMP WHERE task_id = ?`,
    [JSON.stringify(["dependency_incomplete:api"]), exec.task_id],
  );
  return { decisionId, taskId: exec.task_id };
}

describe("clarification — question copy includes a reason", () => {
  it("does not nag with a bare status ask", () => {
    const task = {
      task_id: "t1",
      decision_id: "d1",
      owner: "Priya",
      status: "BLOCKED",
      blocked_reasons: JSON.stringify(["dependency_incomplete:api"]),
      success_condition: "Launch payment integration",
      dependencies: "[]",
      last_update: new Date().toISOString(),
      started_at: null,
      estimated_duration_hours: null,
      user_id: "u1",
      vow: "Ship payments",
    };
    const need = detectClarificationNeed(task);
    assert.ok(need);
    assert.equal(need!.trigger, "BLOCKED");
    assert.equal(need!.questionType, "DEPENDENCY");
    const copy = buildClarificationCopy(task, need!);
    assert.match(copy.reason, /blocked/i);
    assert.match(copy.question, /dependency/i);
    assert.doesNotMatch(copy.question, /^what(?:'s| is) the status/i);
    assert.match(copy.question, /ledger/i);
  });
});

describe("clarification — heuristic extraction", () => {
  it("splits ETA + dependency from a messy owner reply", () => {
    const claims = extractClaimsHeuristic("Probably Friday, but I'm waiting for design.");
    const kinds = claims.map((c) => c.kind).sort();
    assert.ok(kinds.includes("eta"), `expected eta, got ${JSON.stringify(claims)}`);
    assert.ok(kinds.includes("dependency"), `expected dependency, got ${JSON.stringify(claims)}`);
    const dep = claims.find((c) => c.kind === "dependency");
    assert.ok(dep && dep.kind === "dependency");
    assert.match(dep.note, /design/i);
  });
});

describe("clarification — open / one-open / fingerprint", () => {
  it("opens once per blocked task and does not reopen the same exception", async () => {
    const userId = ensureTenant(uuidv4().slice(0, 8));
    const { taskId } = seedBlockedTask(userId);

    const first = openClarificationIfNeeded(taskId);
    assert.ok(first?.created);
    assert.equal(first!.row.status, "OPEN");
    assert.equal(first!.row.trigger, "BLOCKED");

    const second = openClarificationIfNeeded(taskId);
    assert.ok(second);
    assert.equal(second!.created, false);
    assert.equal(second!.row.id, first!.row.id);

    const scan = scanClarifications();
    assert.ok(scan.scanned >= 1);

    const open = listClarifications(userId, "OPEN");
    assert.equal(open.filter((r) => r.task_id === taskId).length, 1);

    await answerClarification(userId, first!.row.id, "Probably Friday, but I'm waiting for design.");
    const after = openClarificationIfNeeded(taskId);
    assert.equal(after, null, "same fingerprint must not re-open after commit");
  });
});

describe("clarification — answer commits ledger evidence, not chat truth", () => {
  it("extracts claims, writes a linked signal, and may set duration — never auto-KILL", async () => {
    const userId = ensureTenant(uuidv4().slice(0, 8));
    const { taskId } = seedBlockedTask(userId, "Helen");
    const opened = openClarificationIfNeeded(taskId);
    assert.ok(opened?.created);

    const result = await answerClarification(
      userId,
      opened!.row.id,
      "No, API team says Aug 17. Still waiting for design.",
    );
    assert.equal(result.clarification.status, "COMMITTED");
    assert.ok(result.claims.some((c) => c.kind === "eta"));
    assert.ok(result.claims.some((c) => c.kind === "dependency"));
    assert.ok(result.committed.some((m) => m.type === "ingest_signal"));
    assert.ok(!result.committed.some((m) => m.type === "transition" && (m as { newState: string }).newState === "KILLED"));

    const signals = db.rawGet(
      `SELECT id, state, linked_execution_id, content FROM external_signals
       WHERE user_id = ? AND source_subtype = 'clarification.answer'`,
      [userId],
    ) as { id: string; state: string; linked_execution_id: string; content: string }[];
    assert.ok(signals.length >= 1);
    assert.equal(signals[0]!.state, "LINKED");
    assert.equal(signals[0]!.linked_execution_id, taskId);

    const task = db.rawGet(
      `SELECT status, estimated_duration_hours FROM execution_ledger WHERE task_id = ?`,
      [taskId],
    )[0] as { status: string; estimated_duration_hours: number | null };
    assert.equal(task.status, "BLOCKED");
    if (result.committed.some((m) => m.type === "set_duration_hours")) {
      assert.ok(Number(task.estimated_duration_hours) >= 1);
    }

    const audit = db.rawGet(
      `SELECT action FROM audit_log WHERE affected_entity_id = ? AND action = 'CLARIFICATION_COMMITTED'`,
      [opened!.row.id],
    );
    assert.equal(audit.length, 1);
  });
});

describe("clarification — dismiss leaves ledger unchanged", () => {
  it("closes the request without a signal", () => {
    const userId = ensureTenant(uuidv4().slice(0, 8));
    const { taskId } = seedBlockedTask(userId, "Noor");
    const opened = openClarificationIfNeeded(taskId);
    assert.ok(opened?.created);
    const dismissed = dismissClarification(userId, opened!.row.id);
    assert.equal(dismissed.status, "DISMISSED");
    const signals = db.rawGet(
      `SELECT id FROM external_signals WHERE user_id = ? AND content LIKE ?`,
      [userId, `%${opened!.row.id}%`],
    );
    assert.equal(signals.length, 0);
  });
});

describe("clarification — unknown owner claim is rejected", () => {
  it("does not invent an owner mutation", () => {
    const userId = ensureTenant(uuidv4().slice(0, 8));
    const { taskId } = seedBlockedTask(userId, "Priya");
    const task = {
      task_id: taskId,
      decision_id: "x",
      owner: "Priya",
      status: "BLOCKED",
      blocked_reasons: "[]",
      success_condition: "Launch payment integration",
      dependencies: "[]",
      last_update: new Date().toISOString(),
      started_at: null,
      estimated_duration_hours: null,
      user_id: userId,
      vow: "Ship",
    };
    const { allowed, rejected } = validateClaims(
      [{ kind: "owner", owner: "TotallyUnknownPerson" }],
      task,
      "OWNERSHIP",
    );
    assert.equal(allowed.length, 0);
    assert.equal(rejected[0]?.reason, "unknown_owner");
  });
});
