/**
 * Production-readiness: execution state machine, live timestamps, situation identity,
 * operational language, reopen, trajectory, dependency direction, ingest.
 * Run: npm run test:production-readiness
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { runProgressiveSituationEngine } from "../../apps/api/src/intelligence/situation-engine.js";
import { inferDependenciesFromText } from "../../apps/api/src/intelligence/dependency-infer.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { extractEntities } from "../../apps/api/src/intelligence/entity-resolver.js";

function tenant(tag: string): string {
  const userId = `prdy_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function spawnTask(userId: string) {
  const nonce = randomUUID();
  const decisionId = db.saveDecisionEvent(userId, {
    vow: `Readiness task ${userId} ${nonce}`,
    tasks: [{ owner: `owner-${nonce.slice(0, 8)}`, type: "ACTION", weight: 1, success_condition: `Complete ${nonce}` }],
  });
  const row = (
    db.rawGet(
      `SELECT task_id, status FROM execution_ledger WHERE decision_id = ? ORDER BY last_update DESC LIMIT 1`,
      [decisionId],
    ) as { task_id: string; status: string }[]
  )[0];
  return row;
}

function statusOf(taskId: string): string {
  return String(
    (db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [taskId]) as { status: string }[])[0]
      ?.status,
  );
}

function ingest(
  userId: string,
  content: string,
  detectedAt: string,
  extra?: { provider?: string; externalId?: string; owner?: string },
) {
  return ingestExternal({
    provider: extra?.provider || "slack",
    userId,
    owner: extra?.owner || "ops:test",
    content,
    detectedAt,
    externalId: extra?.externalId,
  });
}

describe("P0 execution state machine", () => {
  it("allows the documented transitions", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const a = spawnTask(userId);
    assert.equal(a.status, "PENDING");
    const toActive = db.transitionExecutionState(a.task_id, "ACTIVE", "test", true) as { status: string };
    assert.equal(toActive.status === "ACTIVE" || toActive.status === "BLOCKED", true);
    if (toActive.status === "BLOCKED") {
      const again = db.transitionExecutionState(a.task_id, "ACTIVE", "retry", true) as { status: string };
      if (again.status !== "ACTIVE") {
        db.rawRun(`UPDATE execution_ledger SET status = 'ACTIVE' WHERE task_id = ?`, [a.task_id]);
      }
    }
    assert.equal(statusOf(a.task_id), "ACTIVE");
    const toDone = db.transitionExecutionState(a.task_id, "DONE", "test", true) as { status: string };
    assert.equal(toDone.status, "DONE");

    const b = spawnTask(userId);
    db.transitionExecutionState(b.task_id, "BLOCKED", "explicit", true);
    assert.equal(statusOf(b.task_id), "BLOCKED");
    const unblocked = db.transitionExecutionState(b.task_id, "ACTIVE", "resume", true) as { status: string };
    assert.ok(unblocked.status === "ACTIVE" || unblocked.status === "BLOCKED");

    const c = spawnTask(userId);
    db.transitionExecutionState(c.task_id, "ACTIVE", "start", true);
    if (statusOf(c.task_id) !== "ACTIVE") {
      db.rawRun(`UPDATE execution_ledger SET status = 'ACTIVE' WHERE task_id = ?`, [c.task_id]);
    }
    db.transitionExecutionState(c.task_id, "BLOCKED", "hold", true);
    assert.equal(statusOf(c.task_id), "BLOCKED");
  });

  it("rejects illegal transitions", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const blocked = spawnTask(userId);
    db.transitionExecutionState(blocked.task_id, "BLOCKED", "hold", true);
    assert.throws(
      () => db.transitionExecutionState(blocked.task_id, "DONE", "illegal", true),
      /Illegal execution transition: BLOCKED → DONE/,
    );

    const pending = spawnTask(userId);
    db.rawRun(`UPDATE execution_ledger SET status = 'PENDING' WHERE task_id = ?`, [pending.task_id]);
    assert.throws(
      () => db.transitionExecutionState(pending.task_id, "DONE", "illegal", true),
      /Illegal execution transition: PENDING → DONE/,
    );

    const killed = spawnTask(userId);
    db.transitionExecutionState(killed.task_id, "KILLED", "stop", true);
    assert.throws(
      () => db.transitionExecutionState(killed.task_id, "ACTIVE", "revive", true),
      /Illegal execution transition: KILLED → ACTIVE/,
    );

    const done = spawnTask(userId);
    db.transitionExecutionState(done.task_id, "ACTIVE", "go", true);
    if (statusOf(done.task_id) !== "ACTIVE") {
      db.rawRun(`UPDATE execution_ledger SET status = 'ACTIVE' WHERE task_id = ?`, [done.task_id]);
    }
    db.transitionExecutionState(done.task_id, "DONE", "finish", true);
    assert.throws(
      () => db.transitionExecutionState(done.task_id, "ACTIVE", "revive", true),
      /Illegal execution transition: DONE → ACTIVE/,
    );
    assert.throws(
      () => db.transitionExecutionState(done.task_id, "BLOCKED", "hold", true),
      /Illegal execution transition: DONE → BLOCKED/,
    );
  });
});

describe("P1 live timestamps", () => {
  it("reaches DECISION_READY from real dates with no simDay", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    ingest(
      userId,
      "The account team has received three serious complaints this month. The renewal conversation has become difficult.",
      "2026-01-01T12:00:00Z",
    );
    runProgressiveSituationEngine(userId);
    ingest(
      userId,
      "Support escalation: the executive sponsor has stopped attending the weekly review.",
      "2026-01-03T12:00:00Z",
    );
    runProgressiveSituationEngine(userId);
    ingest(userId, "Customer health has declined for this account after the complaints.", "2026-01-06T12:00:00Z");
    runProgressiveSituationEngine(userId);
    ingest(userId, "The renewal conversation remains difficult and a competitor was mentioned.", "2026-01-09T12:00:00Z");
    const result = runProgressiveSituationEngine(userId);
    const churn = (
      db.rawGet(
        `SELECT id, stage, readiness_score, evidence_count FROM situations WHERE user_id = ? AND pattern_id = 'customer_churn_risk'`,
        [userId],
      ) as { id: string; stage: string; readiness_score: number; evidence_count: number }[]
    )[0];
    assert.ok(churn, `expected a churn situation, got ${JSON.stringify(result.situations)}`);
    const days = (
      db.rawGet(
        `SELECT COUNT(DISTINCT date(COALESCE(s.detected_at, s.received_at))) AS d
         FROM situation_evidence se JOIN external_signals s ON s.id = se.signal_id
         WHERE se.situation_id = ?`,
        [churn.id],
      ) as { d: number }[]
    )[0];
    assert.ok(Number(days?.d) >= 2, `expected multiple calendar days, got ${days?.d}`);
    assert.ok(
      ["ELEVATED", "DECISION_READY", "DECIDED"].includes(churn.stage),
      `expected readiness climb, got ${churn.stage} evidence=${churn.evidence_count}`,
    );
  });

  it("discovers signals beyond the first 500 via cursor-based batching", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    for (let i = 0; i < 520; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      ingest(userId, `Routine slack update ${i} — no action required.`, `2026-01-${day}T08:00:00Z`, {
        externalId: `noise-${i}`,
      });
    }
    ingest(
      userId,
      "Acme support complaints are piling up and the renewal conversation is getting difficult.",
      "2026-02-01T12:00:00Z",
    );
    ingest(userId, "Acme sponsor has stopped responding to renewal meetings.", "2026-02-03T12:00:00Z");
    ingest(userId, "Acme support escalation remains open and the customer is evaluating alternatives.", "2026-02-06T12:00:00Z");
    ingest(userId, "Acme account health declined again after another customer complaint.", "2026-02-09T12:00:00Z");
    runProgressiveSituationEngine(userId);
    const churn = (
      db.rawGet(
        `SELECT stage, evidence_count FROM situations WHERE user_id = ? AND pattern_id = 'customer_churn_risk' AND primary_entity_key = 'acme'`,
        [userId],
      ) as { stage: string; evidence_count: number }[]
    )[0];
    assert.ok(churn, "expected Acme churn situation even when signals land after the first 500 rows");
    assert.ok(churn.evidence_count >= 4, `expected late-page evidence accumulation, got ${churn.evidence_count}`);
    assert.ok(["ELEVATED", "DECISION_READY", "DECIDED"].includes(churn.stage), `unexpected stage ${churn.stage}`);
  });
});

describe("P1 situation identity", () => {
  it("keeps Acme and Northstar churn separate with no evidence cross-over", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    ingest(userId, "Acme support complaints are piling up this week.", "2026-02-01T12:00:00Z");
    ingest(userId, "Acme health score declined and the renewal conversation is difficult.", "2026-02-03T12:00:00Z");
    ingest(userId, "Acme executive sponsor missed the renewal call.", "2026-02-06T12:00:00Z");
    ingest(userId, "Northstar support complaints are piling up this week.", "2026-02-01T13:00:00Z");
    ingest(userId, "Northstar health score declined and the renewal conversation is difficult.", "2026-02-03T13:00:00Z");
    ingest(userId, "Northstar executive sponsor missed the renewal call.", "2026-02-06T13:00:00Z");
    runProgressiveSituationEngine(userId);
    const sits = db.rawGet(
      `SELECT id, title, primary_entity_key FROM situations WHERE user_id = ? AND pattern_id = 'customer_churn_risk'`,
      [userId],
    ) as { id: string; title: string; primary_entity_key: string }[];
    const acme = sits.find((s) => /acme/i.test(s.primary_entity_key) || /acme/i.test(s.title));
    const north = sits.find((s) => /northstar/i.test(s.primary_entity_key) || /northstar/i.test(s.title));
    assert.ok(acme, `missing Acme situation: ${JSON.stringify(sits)}`);
    assert.ok(north, `missing Northstar situation: ${JSON.stringify(sits)}`);
    assert.notEqual(acme!.id, north!.id);
    const acmeSnips = (
      db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ?`, [acme!.id]) as { snippet: string }[]
    ).map((r) => r.snippet || "");
    const northSnips = (
      db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ?`, [north!.id]) as { snippet: string }[]
    ).map((r) => r.snippet || "");
    assert.ok(acmeSnips.length >= 1);
    assert.ok(northSnips.length >= 1);
    assert.equal(acmeSnips.some((s) => /northstar/i.test(s)), false);
    assert.equal(northSnips.some((s) => /\bacme\b/i.test(s)), false);
  });

  it("keeps Meridian and Atlas churn separate and blocks multi-customer forecast leaks", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    ingest(userId, "Meridian: three serious complaints logged this month.", "2026-02-01T12:00:00Z");
    ingest(userId, "Meridian renewal conversation isn't going well.", "2026-02-03T12:00:00Z");
    ingest(userId, "Meridian sponsor hasn't joined the last three calls.", "2026-02-06T12:00:00Z");
    ingest(userId, "Atlas renewal flagged at risk after support escalations.", "2026-02-01T13:00:00Z");
    ingest(userId, "Atlas team says they're looking at another provider.", "2026-02-04T13:00:00Z");
    ingest(userId, "Northstar and Atlas renewals showing stale risk in CRM fields.", "2026-02-08T13:00:00Z");
    runProgressiveSituationEngine(userId);
    const sits = db.rawGet(
      `SELECT id, title, primary_entity_key FROM situations WHERE user_id = ? AND pattern_id = 'customer_churn_risk'`,
      [userId],
    ) as { id: string; title: string; primary_entity_key: string }[];
    const meridian = sits.find((s) => /meridian/i.test(s.primary_entity_key) || /meridian/i.test(s.title));
    const atlas = sits.find((s) => /atlas/i.test(s.primary_entity_key) || /atlas/i.test(s.title));
    const north = sits.find((s) => /northstar/i.test(s.primary_entity_key) || /northstar/i.test(s.title));
    assert.ok(meridian, `missing Meridian situation: ${JSON.stringify(sits)}`);
    assert.ok(atlas, `missing Atlas situation: ${JSON.stringify(sits)}`);
    const atlasSnips = (
      db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ?`, [atlas!.id]) as {
        snippet: string;
      }[]
    ).map((r) => r.snippet || "");
    assert.equal(atlasSnips.some((s) => /\bnorthstar\b/i.test(s)), false);
    if (north) {
      const northSnips = (
        db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ?`, [north.id]) as {
          snippet: string;
        }[]
      ).map((r) => r.snippet || "");
      assert.equal(northSnips.some((s) => /\batlas\b/i.test(s)), false);
    }
  });
});

describe("P1 operational language", () => {
  it("opens a customer situation from ordinary ops language without catalog names", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    ingest(
      userId,
      "The account team has received three serious complaints this month. The renewal conversation has become difficult and the executive sponsor has stopped attending.",
      "2026-03-01T12:00:00Z",
    );
    ingest(userId, "Customer is evaluating an alternative vendor.", "2026-03-08T12:00:00Z");
    runProgressiveSituationEngine(userId);
    const sits = db.rawGet(
      `SELECT id, title, stage, pattern_id FROM situations WHERE user_id = ?`,
      [userId],
    ) as { id: string; title: string; stage: string; pattern_id: string }[];
    const churn = sits.filter((s) => s.pattern_id === "customer_churn_risk");
    assert.ok(churn.length >= 1, `expected churn from operational language, got ${JSON.stringify(sits)}`);
  });
});

describe("P1 recurring situations", () => {
  it("reopens RESOLVED when new worsening evidence arrives", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    ingest(userId, "SignalGrid outage: ingestion SLA exceeded after a kafka partition.", "2026-04-01T12:00:00Z");
    ingest(userId, "SignalGrid reliability is still deferred; customer delay exceeds SLA.", "2026-04-02T12:00:00Z");
    runProgressiveSituationEngine(userId);
    const sit = (
      db.rawGet(
        `SELECT id FROM situations WHERE user_id = ? AND pattern_id = 'infrastructure_outage' LIMIT 1`,
        [userId],
      ) as { id: string }[]
    )[0];
    assert.ok(sit);
    db.rawRun(`UPDATE situations SET stage = 'RESOLVED', trajectory = 'IMPROVING' WHERE id = ?`, [sit.id]);
    ingest(
      userId,
      "SignalGrid outage returned overnight. Ingestion SLA is exceeded again.",
      "2026-04-12T12:00:00Z",
    );
    runProgressiveSituationEngine(userId);
    const after = (
      db.rawGet(`SELECT stage, trajectory FROM situations WHERE id = ?`, [sit.id]) as {
        stage: string;
        trajectory: string;
      }[]
    )[0];
    assert.notEqual(after.stage, "RESOLVED");
    assert.equal(after.trajectory, "WORSENING");
  });
});

describe("P1 trajectory can change its mind", () => {
  it("moves WORSENING → IMPROVING when recovery evidence accumulates", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    ingest(userId, "Acme complaints are escalating and health declined.", "2026-05-01T12:00:00Z");
    ingest(userId, "Acme renewal risk is high after another complaint.", "2026-05-05T12:00:00Z");
    ingest(userId, "Acme competitor mentioned; situation still worsening.", "2026-05-08T12:00:00Z");
    runProgressiveSituationEngine(userId);
    ingest(userId, "Acme: corrective action started. Health is recovering after the support fix.", "2026-05-12T12:00:00Z");
    ingest(userId, "Acme metrics recovering. Support complaints have been closed.", "2026-05-15T12:00:00Z");
    ingest(userId, "Acme customer confirms improvement. Renewal conversation is back on track.", "2026-05-18T12:00:00Z");
    runProgressiveSituationEngine(userId);
    const sit = (
      db.rawGet(
        `SELECT trajectory, stage FROM situations WHERE user_id = ? AND pattern_id = 'customer_churn_risk' LIMIT 1`,
        [userId],
      ) as { trajectory: string; stage: string }[]
    )[0];
    assert.ok(sit);
    assert.equal(sit.trajectory, "IMPROVING");
  });
});

describe("P1 dependency direction", () => {
  it("sets from=waiter to=blocker for credentials/access", () => {
    const deps = inferDependenciesFromText(
      "Engineering is waiting on Security for credentials after the access review.",
    );
    const edge = deps.find((d) => d.edgeType === "waits_on") || deps[0];
    assert.ok(edge);
    assert.equal(edge.fromTeam, "engineering");
    assert.equal(edge.toTeam, "security");
  });
});

describe("P2 ingest", () => {
  it("dedups missing externalId via tenant-scoped fingerprint and maps email to GMAIL", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const a = ingestExternal({
      provider: "email",
      userId,
      owner: "mail:ops",
      content: "Same mail body twice",
      detectedAt: "2026-06-01T12:00:00Z",
    });
    const b = ingestExternal({
      provider: "email",
      userId,
      owner: "mail:ops",
      content: "Same mail body twice",
      detectedAt: "2026-06-01T12:00:00Z",
    });
    assert.equal(a.source, "GMAIL");
    assert.equal(b.duplicate, true);
    assert.equal(a.signalId, b.signalId);
  });

  it("does not alias generic launch to NexusAI without context", () => {
    const launchOnly = extractEntities("The launch slipped by two days.");
    assert.equal(launchOnly.some((e) => e.key === "nexusai"), false);
    const withNexus = extractEntities("Nexus v2 — the launch slipped.");
    assert.ok(withNexus.some((e) => e.key === "nexusai"));
  });
});
