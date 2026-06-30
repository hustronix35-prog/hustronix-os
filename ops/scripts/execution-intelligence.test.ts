/**
 * Execution Intelligence Engine V1 tests.
 * Run: npm run test:execution-intelligence (from apps/api)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { evidenceWeight } from "../../apps/api/src/execution-intelligence/decay.js";
import { recordEvidence } from "../../apps/api/src/execution-intelligence/evidence-collector.js";
import { replayBeliefsForTenant } from "../../apps/api/src/execution-intelligence/replay.js";
import {
  listBeliefsForEntity,
  computeDerivedCapacity,
} from "../../apps/api/src/execution-intelligence/derived-views.js";
import {
  predictTaskSuccess,
  listPredictions,
} from "../../apps/api/src/execution-intelligence/shadow-predictor.js";
import { resolvePrediction } from "../../apps/api/src/execution-intelligence/feedback.js";
import { FEATURE_VERSION } from "../../apps/api/src/execution-intelligence/config.js";
import { getFeaturesForEvidence } from "../../apps/api/src/execution-intelligence/feature-extractor.js";

function ensureTenant(seed: string): string {
  const userId = `test_eie_${seed}`;
  if (!db.getUser(userId)) {
    db.createUser(userId, userId, hashPassword(`test-${userId}`));
  }
  return userId;
}

describe("EIE — evidence idempotency", () => {
  it("deduplicates on idempotency_key", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    const key = `test:${uuidv4()}`;
    const input = {
      tenantId,
      eventType: "task.completed" as const,
      subjectEntityType: "person" as const,
      subjectEntityId: "alice",
      sourceEntityType: "task" as const,
      sourceEntityId: "task-1",
      payload: { on_time: true, duration_ratio: 0.9, active_load: 1 },
      idempotencyKey: key,
    };
    const a = recordEvidence(input);
    const b = recordEvidence(input);
    assert.ok(a);
    assert.ok(b);
    assert.equal(a!.id, b!.id);
    const count = db.rawGet(
      `SELECT COUNT(*) AS c FROM execution_evidence WHERE tenant_id = ? AND idempotency_key = ?`,
      [tenantId, key],
    )[0] as { c: number };
    assert.equal(count.c, 1);
  });
});

describe("EIE — feature version pinning", () => {
  it("stores feature_version v1 on extraction", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    const ev = recordEvidence({
      tenantId,
      eventType: "task.completed",
      subjectEntityType: "person",
      subjectEntityId: "bob",
      sourceEntityType: "task",
      sourceEntityId: uuidv4(),
      payload: { on_time: true, duration_ratio: 1, active_load: 0.5 },
      idempotencyKey: `feat:${uuidv4()}`,
    });
    assert.ok(ev);
    const features = getFeaturesForEvidence(ev!.id);
    assert.ok(features.length >= 1);
    assert.equal(features[0]!.featureVersion, FEATURE_VERSION);
  });
});

describe("EIE — belief replay", () => {
  it("produces identical posteriors after replay", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    recordEvidence({
      tenantId,
      eventType: "task.completed",
      subjectEntityType: "person",
      subjectEntityId: "carol",
      payload: { on_time: true, duration_ratio: 0.8, active_load: 1 },
      idempotencyKey: `replay-a:${uuidv4()}`,
    });
    recordEvidence({
      tenantId,
      eventType: "task.killed",
      subjectEntityType: "person",
      subjectEntityId: "carol",
      payload: { attribution: "owner_fault", active_load: 2 },
      idempotencyKey: `replay-b:${uuidv4()}`,
    });
    const before = listBeliefsForEntity(tenantId, "person", "carol");
    replayBeliefsForTenant(tenantId);
    const after = listBeliefsForEntity(tenantId, "person", "carol");
    assert.equal(before.length, after.length);
    for (const b of before) {
      const a = after.find((x) => x.beliefKey === b.beliefKey);
      assert.ok(a, `missing ${b.beliefKey}`);
      assert.ok(Math.abs(b.mean - a!.mean) < 0.0001, `${b.beliefKey} mean drift`);
      assert.equal(b.nObs, a!.nObs);
    }
  });
});

describe("EIE — time decay", () => {
  it("reduces weight for old evidence", () => {
    const fresh = evidenceWeight(new Date().toISOString());
    const stale = evidenceWeight(new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString());
    assert.ok(fresh > stale);
  });
});

describe("EIE — calibration feedback loop", () => {
  it("emits prediction.calibration_error evidence on resolve", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    const pred = predictTaskSuccess(tenantId, "dave");
    resolvePrediction(pred.id, 0.2);
    const cal = db.rawGet(
      `SELECT COUNT(*) AS c FROM execution_evidence
       WHERE tenant_id = ? AND event_type = 'prediction.calibration_error'`,
      [tenantId],
    )[0] as { c: number };
    assert.ok(cal.c >= 1);
  });
});

describe("EIE — derived capacity", () => {
  it("changes with load-performance beliefs without affecting getOwnerCapacity", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    const owner = "eve";
    const legacyBefore = db.getOwnerCapacity(owner).capacity;
    recordEvidence({
      tenantId,
      eventType: "task.completed",
      subjectEntityType: "person",
      subjectEntityId: owner,
      payload: { on_time: true, duration_ratio: 0.9, active_load: 0.5, load_bucket: "0-1" },
      idempotencyKey: `cap:${uuidv4()}`,
    });
    const beliefs = listBeliefsForEntity(tenantId, "person", owner);
    const derived = computeDerivedCapacity(beliefs);
    assert.ok(derived.derivedCapacity > 0);
    const legacyAfter = db.getOwnerCapacity(owner).capacity;
    assert.equal(legacyBefore, legacyAfter);
  });
});

describe("EIE — attribution external_blocker", () => {
  it("skips reliability penalty", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    const owner = "frank";
    recordEvidence({
      tenantId,
      eventType: "task.killed",
      subjectEntityType: "person",
      subjectEntityId: owner,
      payload: { attribution: "external_blocker", active_load: 1 },
      idempotencyKey: `ext:${uuidv4()}`,
    });
    const rel = listBeliefsForEntity(tenantId, "person", owner).find((b) => b.beliefKey === "reliability");
    assert.ok(!rel || rel.nObs === 0 || rel.mean >= 0.45);
  });
});

describe("EIE — API belief shape", () => {
  it("returns uncertainty on every belief field", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    recordEvidence({
      tenantId,
      eventType: "task.completed",
      subjectEntityType: "person",
      subjectEntityId: "grace",
      payload: { on_time: true, duration_ratio: 1, active_load: 1 },
      idempotencyKey: `api:${uuidv4()}`,
    });
    const beliefs = listBeliefsForEntity(tenantId, "person", "grace");
    assert.ok(beliefs.length > 0);
    for (const b of beliefs) {
      assert.ok(typeof b.confidence === "number");
      assert.ok(b.confidence >= 0 && b.confidence <= 1);
      assert.ok(typeof b.variance === "number");
      assert.ok(b.nObs >= 1);
    }
  });
});

describe("EIE — predictions", () => {
  it("include non-empty explanation", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    predictTaskSuccess(tenantId, "henry");
    const preds = listPredictions(tenantId, "person", "henry", 5);
    assert.ok(preds.length >= 1);
    assert.ok(preds[0]!.explanation.length >= 1);
    assert.ok(preds[0]!.algorithmVersion.length > 0);
  });

  it("supports model version comparison query", () => {
    const tenantId = ensureTenant(uuidv4().slice(0, 8));
    predictTaskSuccess(tenantId, "iris");
    const rows = db.rawGet(
      `SELECT algorithm_version, COUNT(*) AS c FROM execution_predictions
       WHERE tenant_id = ? GROUP BY algorithm_version`,
      [tenantId],
    ) as { algorithm_version: string; c: number }[];
    assert.ok(rows.some((r) => r.c >= 1));
  });
});

describe("EIE — auditor INSERT OR IGNORE", () => {
  it("owner_reputation row exists before shadow kill update path", () => {
    const owner = `shadow_${uuidv4().slice(0, 6)}`;
    db.rawRun(`DELETE FROM owner_reputation WHERE owner = ?`, [owner]);
    db.rawRun("INSERT OR IGNORE INTO owner_reputation (owner) VALUES (?)", [owner]);
    db.rawRun(
      `UPDATE owner_reputation SET failed_executions = failed_executions + 1,
       reputation_modifier = MAX(0.2, reputation_modifier - 0.1) WHERE owner = ?`,
      [owner],
    );
    const rep = db.rawGet(`SELECT * FROM owner_reputation WHERE owner = ?`, [owner])[0] as {
      failed_executions: number;
    };
    assert.ok(rep);
    assert.equal(rep.failed_executions, 1);
  });
});
