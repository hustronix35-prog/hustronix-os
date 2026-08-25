/**
 * Wave 3 slice 3: bounded readiness learning from decision_outcomes.
 * Run: npm run test:wave3-learning
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { computeReadiness } from "../../apps/api/src/intelligence/readiness.js";
import {
  BASE_SCORE_FLOOR,
  effectiveScoreFloor,
  emptyPrior,
  explainReadinessPrior,
  getReadinessPrior,
  learningPatternId,
  MAX_MIN_DISTINCT_DAYS_DELTA,
  MAX_MIN_EVIDENCE_DELTA,
  MIN_SCORE_FLOOR,
  updateFromOutcome,
  type ReadinessPrior,
} from "../../apps/api/src/intelligence/readiness-learning.js";
import { gatesAllowReady, READY_GATES } from "../../apps/api/src/intelligence/situation-engine.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";

const CHURN = "customer_churn_risk";
const SECURITY = "security_incident";
const CHURN_FACETS = new Set(["health", "support"]);

function tenant(tag: string): string {
  const userId = `w3l_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function insertOutcome(
  userId: string,
  patternId: string,
  result: string,
  decisionId = randomUUID(),
): string {
  db.rawRun(
    `INSERT INTO decision_outcomes
      (id, tenant_id, decision_id, result, pattern_id, learning_applied, expected_json, actual_json)
     VALUES (?, ?, ?, ?, ?, 0, '{}', '{}')`,
    [randomUUID(), userId, decisionId, result, patternId],
  );
  return decisionId;
}

function consume(userId: string, patternId: string, result: string, decisionId?: string): ReadinessPrior | null {
  const did = insertOutcome(userId, patternId, result, decisionId);
  return updateFromOutcome(did);
}

function readyInput(overrides: Partial<Parameters<typeof computeReadiness>[0]> = {}) {
  return computeReadiness({
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
    ...overrides,
  });
}

describe("Wave 3 slice 3 bounded readiness learning", () => {
  it("1 — four failed outcomes do not change the prior", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    for (let i = 0; i < 4; i++) consume(userId, CHURN, "failed");
    const prior = getReadinessPrior(userId, CHURN);
    assert.equal(prior.failed_count, 4);
    assert.equal(prior.min_evidence_delta, 0);
    assert.equal(prior.min_distinct_days_delta, 0);
    assert.equal(prior.score_floor_delta, 0);
    assert.equal(
      gatesAllowReady(CHURN, CHURN_FACETS, READY_GATES[CHURN].minEvidence, READY_GATES[CHURN].minDistinctDays, prior),
      true,
    );
    const before = readyInput();
    const after = readyInput({ prior });
    assert.equal(after.ready, before.ready);
    assert.equal(effectiveScoreFloor(prior), BASE_SCORE_FLOOR);
  });

  it("2 — five failed outcomes tighten future readiness for that pattern", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    for (let i = 0; i < 5; i++) consume(userId, CHURN, "failed");
    const prior = getReadinessPrior(userId, CHURN);
    assert.equal(prior.failed_count, 5);
    assert.equal(prior.min_evidence_delta, 1);
    assert.match(prior.explanation, /additional evidence/i);
    const baseEv = READY_GATES[CHURN].minEvidence;
    const days = READY_GATES[CHURN].minDistinctDays;
    assert.equal(gatesAllowReady(CHURN, CHURN_FACETS, baseEv, days), true);
    assert.equal(gatesAllowReady(CHURN, CHURN_FACETS, baseEv, days, prior), false);
    assert.equal(gatesAllowReady(CHURN, CHURN_FACETS, baseEv + 1, days, prior), true);
    const explained = explainReadinessPrior(prior, 0.5);
    assert.equal(explained.pattern_id, CHURN);
    assert.equal(explained.failed, 5);
    assert.equal(explained.min_evidence_delta, 1);
  });

  it("3 — learning on pattern A does not change pattern B or open_world", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    for (let i = 0; i < 5; i++) consume(userId, CHURN, "failed");
    const a = getReadinessPrior(userId, CHURN);
    const b = getReadinessPrior(userId, SECURITY);
    const ow = getReadinessPrior(userId, "open_world");
    assert.equal(a.min_evidence_delta, 1);
    assert.equal(b.min_evidence_delta, 0);
    assert.equal(b.sample_count, 0);
    assert.equal(ow.min_evidence_delta, 0);
    assert.equal(ow.sample_count, 0);
    assert.equal(
      gatesAllowReady(SECURITY, new Set(["access", "audit"]), READY_GATES[SECURITY].minEvidence, 2, b),
      true,
    );
  });

  it("4 — five successful outcomes produce a tiny score-floor improvement above 0.45", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    for (let i = 0; i < 5; i++) consume(userId, SECURITY, "successful");
    const prior = getReadinessPrior(userId, SECURITY);
    assert.equal(prior.successful_count, 5);
    assert.equal(prior.score_floor_delta, -0.01);
    const floor = effectiveScoreFloor(prior);
    assert.ok(floor >= MIN_SCORE_FLOOR);
    assert.ok(floor < BASE_SCORE_FLOOR);
    assert.equal(floor, 0.47);
    assert.equal(prior.min_evidence_delta, 0);
    const r = readyInput({ prior, gateOk: true });
    assert.equal(r.ready, true);
    assert.equal(r.learning?.effective_floor, 0.47);
  });

  it("5 — a favorable prior cannot bypass gateOk = false", () => {
    const prior = emptyPrior("n/a", SECURITY);
    prior.sample_count = 5;
    prior.successful_count = 5;
    prior.score_floor_delta = -0.01;
    const r = readyInput({ prior, gateOk: false });
    assert.equal(r.ready, false);
    assert.ok((r.score as number) >= effectiveScoreFloor(prior));
  });

  it("6 — extreme failure history stays inside hard caps", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    for (let i = 0; i < 20; i++) consume(userId, CHURN, "failed");
    const prior = getReadinessPrior(userId, CHURN);
    assert.ok(prior.min_evidence_delta <= MAX_MIN_EVIDENCE_DELTA);
    assert.ok(prior.min_distinct_days_delta <= MAX_MIN_DISTINCT_DAYS_DELTA);
    assert.equal(prior.min_evidence_delta, 2);
    assert.equal(prior.min_distinct_days_delta, 1);
    assert.ok(effectiveScoreFloor(prior) >= MIN_SCORE_FLOOR);
  });

  it("7 — the same decision_outcome contributes once", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const decisionId = randomUUID();
    insertOutcome(userId, CHURN, "failed", decisionId);
    const first = updateFromOutcome(decisionId);
    const second = updateFromOutcome(decisionId);
    const third = updateFromOutcome(decisionId);
    assert.equal(first?.failed_count, 1);
    assert.equal(second?.failed_count, 1);
    assert.equal(third?.failed_count, 1);
    assert.equal(getReadinessPrior(userId, CHURN).sample_count, 1);
    const flag = (
      db.rawGet(`SELECT learning_applied FROM decision_outcomes WHERE decision_id = ?`, [decisionId]) as {
        learning_applied: number;
      }[]
    )[0];
    assert.equal(Number(flag.learning_applied), 1);
  });

  it("8 — partial and inconclusive outcomes do not adjust readiness", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    for (let i = 0; i < 8; i++) consume(userId, CHURN, "partial");
    for (let i = 0; i < 8; i++) consume(userId, CHURN, "inconclusive");
    const prior = getReadinessPrior(userId, CHURN);
    assert.equal(prior.partial_count, 8);
    assert.equal(prior.inconclusive_count, 8);
    assert.equal(prior.successful_count, 0);
    assert.equal(prior.failed_count, 0);
    assert.equal(prior.min_evidence_delta, 0);
    assert.equal(prior.score_floor_delta, 0);
    assert.equal(
      gatesAllowReady(CHURN, CHURN_FACETS, READY_GATES[CHURN].minEvidence, READY_GATES[CHURN].minDistinctDays, prior),
      true,
    );
  });

  it("9 — detection cycles do not amplify an already consumed outcome", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    for (let i = 0; i < 5; i++) consume(userId, CHURN, "failed");
    const before = getReadinessPrior(userId, CHURN);
    for (let i = 0; i < 10; i++) runSituationDetection(userId);
    const after = getReadinessPrior(userId, CHURN);
    assert.equal(after.sample_count, before.sample_count);
    assert.equal(after.failed_count, before.failed_count);
    assert.equal(after.min_evidence_delta, before.min_evidence_delta);
  });

  it("10 — open-world outcomes learn as open_world, not an entity-specific rule", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const entityPattern = "openworld:acme-corp";
    assert.equal(learningPatternId(entityPattern), "open_world");
    assert.equal(learningPatternId("open_world_test"), "open_world");
    for (let i = 0; i < 5; i++) consume(userId, entityPattern, "failed");
    const ow = getReadinessPrior(userId, "open_world");
    const labeled = getReadinessPrior(userId, entityPattern);
    assert.equal(ow.pattern_id, "open_world");
    assert.equal(labeled.pattern_id, "open_world");
    assert.equal(ow.failed_count, 5);
    assert.equal(ow.min_evidence_delta, 1);
    const rows = db.rawGet(`SELECT pattern_id FROM readiness_priors WHERE user_id = ?`, [userId]) as {
      pattern_id: string;
    }[];
    assert.deepEqual(
      rows.map((r) => r.pattern_id),
      ["open_world"],
    );
    assert.ok(!rows.some((r) => /acme/i.test(r.pattern_id)));
  });
});
