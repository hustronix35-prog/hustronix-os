/**
 * Core OS enforcement: multi-ACTIVE conflict classes, roster capacity, mutation gateway.
 * Run: npx tsx --test ops/scripts/os-enforcement.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import {
  mutationCommitDecision,
  mutationCreateDraftDecision,
  mutationTransitionExecution,
} from "../../apps/api/src/security/mutation-handlers.js";
import { ingestMeeting } from "../../apps/api/src/intelligence/meetingIngestion.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { buildEvidenceAccuracy } from "../../apps/api/src/intelligence/evidenceAccuracy.js";
import { auditor } from "../../apps/api/src/auditor.js";

function tenant(tag: string): string {
  const userId = `osenf_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

describe("OS multi-ACTIVE conflict classes", () => {
  it("allows orthogonal ACTIVE vows", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const a = mutationCreateDraftDecision(userId, {
      vow: `Hold Nexus GA until evidence gate is green ${userId}`,
      constraints: ["Do not ship without retrieval-trace coverage"],
      tasks: [{ owner: "Imani", type: "ACTION", weight: 1, success_condition: "Launch checklist green" }],
    });
    const b = mutationCreateDraftDecision(userId, {
      vow: `Enforce hiring freeze with GRC+SRE exceptions only ${userId}`,
      constraints: ["No unapproved backfills"],
      tasks: [{ owner: "Leah", type: "ACTION", weight: 1, success_condition: "Freeze policy published" }],
    });
    mutationCommitDecision(userId, a.id, "orthogonal a");
    mutationCommitDecision(userId, b.id, "orthogonal b");
    const n = (
      db.rawGet(`SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`, [userId]) as {
        c: number;
      }[]
    )[0];
    assert.equal(Number(n.c), 2);
  });

  it("blocks when NO-lists overlap", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const a = mutationCreateDraftDecision(userId, {
      vow: `Save Acme without silent discount ${userId}`,
      constraints: ["Do not discount without CFO review"],
      tasks: [{ owner: "Jordan", type: "ACTION", weight: 1, success_condition: "Acme save plan" }],
    });
    const b = mutationCreateDraftDecision(userId, {
      vow: `Restate Q3 forecast from current risk ${userId}`,
      constraints: ["Do not discount without CFO review", "Do not surprise CEO on coverage"],
      tasks: [{ owner: "Marcus", type: "ACTION", weight: 1, success_condition: "Forecast restated" }],
    });
    mutationCommitDecision(userId, a.id, "first");
    assert.throws(
      () => mutationCommitDecision(userId, b.id, "overlap"),
      /CONFLICT:.*shared NO-list/i,
    );
  });
});

describe("OS roster capacity", () => {
  it("uses weekly hours / 8 as load budget", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const owner = `Cap${userId.slice(-8)}`;
    db.upsertTeamRosterByEmail(userId, {
      name: owner,
      email: `${owner.toLowerCase()}@hustronix.io`,
      role: "PM",
      team: "product",
      capacity: "40h / week",
      slackId: owner,
    });
    const cap = db.getOwnerCapacity(owner, userId);
    assert.equal(cap.roster_hours, 40);
    assert.equal(cap.capacity, 5);
  });
});

describe("OS meeting ingest", () => {
  it("writes one transcript signal, items in meta", async () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const r = await ingestMeeting({
      userId,
      transcript:
        "We will move the launch by Friday. Alice will own the customer note by next week. We cannot proceed without cited evidence. The work is blocked by incomplete legal review. Priya and Elena disagree on launch pressure.",
      title: "ops review",
      attendees: ["Alice"],
    });
    assert.equal(r.signalIds.length, 1);
    assert.ok(r.items.length >= 1);
    const row = (
      db.rawGet(`SELECT source, source_subtype, ingest_meta FROM external_signals WHERE id = ?`, [r.signalIds[0]]) as {
        source: string;
        source_subtype: string;
        ingest_meta: string;
      }[]
    )[0];
    assert.equal(row.source, "MEETING");
    assert.equal(row.source_subtype, "meeting.transcript");
    const meta = JSON.parse(row.ingest_meta || "{}") as { extracted_count?: number };
    assert.ok((meta.extracted_count || 0) >= 1);
  });
});

describe("OS corpus shadow-work", () => {
  it("holds HSOG evidence past grace instead of killing", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const r = ingestExternal({
      provider: "slack",
      subtype: "slack.message",
      userId,
      content: "Corpus evidence must stay on the ledger",
      owner: "slack:corpus",
      externalId: `hsog:${userId}-corpus-1`,
      detectedAt: "2026-02-01T12:00:00.000Z",
      meta: {
        integration_runtime: "hsog-provider",
        hsog_scenario_id: "product_launch_slip",
        artifact_type: "slack_message",
      },
    });
    db.rawRun(
      `UPDATE external_signals
       SET state = 'UNVERIFIED',
           received_at = datetime('now', '-1 day'),
           grace_expires_at = datetime('now', '-1 hour')
       WHERE id = ?`,
      [r.signalId],
    );
    auditor.onWrite({ type: "signal", signalId: r.signalId });
    const row = (
      db.rawGet(`SELECT state FROM external_signals WHERE id = ?`, [r.signalId]) as { state: string }[]
    )[0];
    assert.equal(row.state, "GRACE");
  });
});

describe("OS duplicate ACTIVE vow", () => {
  it("rejects a second ACTIVE decision with the same vow", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const vow = `Hold SEV1 until evidence register is complete ${userId}`;
    const a = mutationCreateDraftDecision(userId, {
      vow,
      expected_outcomes: [{ metric: "a", target: "1" }],
      constraints: ["Do not claim no-exfil without packet"],
      tasks: [{ owner: "Omar", type: "ACTION", weight: 1, success_condition: "SEV1 closed" }],
    });
    mutationCommitDecision(userId, a.id, "first");
    const b = mutationCreateDraftDecision(userId, {
      vow,
      expected_outcomes: [{ metric: "b", target: "2" }],
      constraints: ["Do not claim no-exfil without packet"],
      tasks: [{ owner: "Noor", type: "ACTION", weight: 1, success_condition: "Evidence register updated" }],
    });
    assert.notEqual(a.id, b.id);
    assert.throws(() => mutationCommitDecision(userId, b.id, "second"), /already ACTIVE|Duplicate|CONFLICT/i);
  });
});

describe("OS evidence accuracy", () => {
  it("reports source mix, runtime, and how it was tested", async () => {
    const userId = tenant(randomUUID().slice(0, 8));
    ingestExternal({
      provider: "jira",
      subtype: "jira.issue_updated",
      userId,
      content: "FLOW-12 retrieval gate still red",
      owner: "jira:renata",
      externalId: `jira-${userId}-1`,
      meta: { integration_runtime: "jira-cloud", artifact_type: "jira_issue" },
    });
    ingestExternal({
      provider: "slack",
      subtype: "slack.message",
      userId,
      content: "Renata flagged architecture risk before launch review",
      owner: "slack:U1",
      externalId: `slack-${userId}-1`,
      meta: { integration_runtime: "slack-events", artifact_type: "slack_message" },
    });
    const report = await buildEvidenceAccuracy(userId);
    assert.equal(report.signals_total, 2);
    assert.deepEqual(
      report.provenance.by_source.map((r) => r.source).sort(),
      ["JIRA", "SLACK"],
    );
    assert.ok(report.provenance.by_runtime.some((r) => r.runtime === "jira-cloud"));
    assert.equal(report.accuracy, null);
    assert.match(report.tested.method, /HSOG/i);
    assert.ok(report.tested.channels.includes("Jira"));
    assert.ok(report.tested.channels.includes("Slack Events"));
    assert.match(report.tested.note, /Accuracy appears after HSOG/i);
  });
});

describe("OS mutation gateway", () => {
  it("transition_execution tenant-checks like HTTP", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const other = tenant(randomUUID().slice(0, 8));
    const owner = `Gw${userId.slice(-8)}`;
    db.upsertTeamRosterByEmail(userId, {
      name: owner,
      email: `${owner.toLowerCase()}@hustronix.io`,
      role: "Eng",
      team: "platform",
      capacity: "40h / week",
      slackId: owner,
    });
    const d = mutationCreateDraftDecision(userId, {
      vow: `Gateway vow ${userId}`,
      constraints: ["Do not skip review"],
      tasks: [{ owner, type: "ACTION", weight: 1, success_condition: "P1 closed" }],
    });
    mutationCommitDecision(userId, d.id, "go");
    const task = (
      db.rawGet(`SELECT task_id FROM execution_ledger WHERE decision_id = ?`, [d.id]) as { task_id: string }[]
    )[0];
    assert.throws(() => mutationTransitionExecution(other, { taskId: task.task_id, newState: "ACTIVE" }), /Forbidden/i);
    const ok = mutationTransitionExecution(userId, {
      taskId: task.task_id,
      newState: "ACTIVE",
      reason: "owner start",
    });
    assert.equal(ok.status, "ACTIVE");
  });
});
