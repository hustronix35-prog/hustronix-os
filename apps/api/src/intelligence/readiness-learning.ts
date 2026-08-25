/**
 * Bounded outcome → readiness priors.
 * Consumes decision_outcomes only. Does not rewrite READY_GATES.
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { SITUATION_PATTERNS } from "./situation-patterns.js";
import { upsertLearningLog } from "../evaluation/learning-log.js";

export const MIN_LEARNING_SAMPLES = 5;
export const MAX_MIN_EVIDENCE_DELTA = 2;
export const MAX_MIN_DISTINCT_DAYS_DELTA = 2;
export const BASE_SCORE_FLOOR = 0.48;
export const MIN_SCORE_FLOOR = 0.45;
export const MAX_ABS_SCORE_FLOOR_DELTA = 0.03;

const KNOWN_PATTERNS = new Set(SITUATION_PATTERNS.map((p) => p.id));

export type ReadinessPrior = {
  user_id: string;
  pattern_id: string;
  min_evidence_delta: number;
  min_distinct_days_delta: number;
  score_floor_delta: number;
  sample_count: number;
  successful_count: number;
  failed_count: number;
  partial_count: number;
  inconclusive_count: number;
  explanation: string;
};

export function emptyPrior(userId: string, patternId: string): ReadinessPrior {
  return {
    user_id: userId,
    pattern_id: learningPatternId(patternId),
    min_evidence_delta: 0,
    min_distinct_days_delta: 0,
    score_floor_delta: 0,
    sample_count: 0,
    successful_count: 0,
    failed_count: 0,
    partial_count: 0,
    inconclusive_count: 0,
    explanation: "No evaluated outcomes for this pattern yet.",
  };
}

/** Catalog patterns keep their id; everything else (including openworld:…) maps to open_world. */
export function learningPatternId(patternId: string | null | undefined): string {
  const id = String(patternId || "").trim();
  if (!id) return "open_world";
  if (id === "open_world" || id.startsWith("open_world") || id.startsWith("openworld:")) return "open_world";
  if (KNOWN_PATTERNS.has(id)) return id;
  return "open_world";
}

export function boundedGateDeltas(
  prior?: Pick<ReadinessPrior, "min_evidence_delta" | "min_distinct_days_delta"> | null,
): { minEvidenceDelta: number; minDistinctDaysDelta: number } {
  return {
    minEvidenceDelta: Math.max(0, Math.min(MAX_MIN_EVIDENCE_DELTA, Number(prior?.min_evidence_delta ?? 0))),
    minDistinctDaysDelta: Math.max(
      0,
      Math.min(MAX_MIN_DISTINCT_DAYS_DELTA, Number(prior?.min_distinct_days_delta ?? 0)),
    ),
  };
}

export function effectiveScoreFloor(prior: ReadinessPrior | null | undefined): number {
  const raw = Number(prior?.score_floor_delta ?? 0);
  const bounded = Math.max(-MAX_ABS_SCORE_FLOOR_DELTA, Math.min(MAX_ABS_SCORE_FLOOR_DELTA, raw));
  return Math.max(MIN_SCORE_FLOOR, BASE_SCORE_FLOOR + bounded);
}

export function getReadinessPrior(userId: string, patternId: string): ReadinessPrior {
  const pid = learningPatternId(patternId);
  const row = (
    db.rawGet(`SELECT * FROM readiness_priors WHERE user_id = ? AND pattern_id = ? LIMIT 1`, [
      userId,
      pid,
    ]) as Array<Record<string, unknown>>
  )[0];
  if (!row) return emptyPrior(userId, pid);
  return {
    user_id: userId,
    pattern_id: pid,
    min_evidence_delta: Number(row.min_evidence_delta || 0),
    min_distinct_days_delta: Number(row.min_distinct_days_delta || 0),
    score_floor_delta: Number(row.score_floor_delta || 0),
    sample_count: Number(row.sample_count || 0),
    successful_count: Number(row.successful_count || 0),
    failed_count: Number(row.failed_count || 0),
    partial_count: Number(row.partial_count || 0),
    inconclusive_count: Number(row.inconclusive_count || 0),
    explanation: String(row.explanation || ""),
  };
}

export function explainReadinessPrior(prior: ReadinessPrior, baseScore?: number): Record<string, unknown> {
  const floor = effectiveScoreFloor(prior);
  return {
    base_score: baseScore ?? null,
    learned_adjustment: prior.score_floor_delta,
    effective_floor: floor,
    min_evidence_delta: prior.min_evidence_delta,
    min_distinct_days_delta: prior.min_distinct_days_delta,
    pattern_id: prior.pattern_id,
    sample_count: prior.sample_count,
    successful: prior.successful_count,
    failed: prior.failed_count,
    partial: prior.partial_count,
    inconclusive: prior.inconclusive_count,
    explanation: prior.explanation,
  };
}

function deriveDeltas(successful: number, failed: number): {
  min_evidence_delta: number;
  min_distinct_days_delta: number;
  score_floor_delta: number;
  explanation: string;
} {
  const eligible = successful + failed;
  if (eligible < MIN_LEARNING_SAMPLES) {
    return {
      min_evidence_delta: 0,
      min_distinct_days_delta: 0,
      score_floor_delta: 0,
      explanation: `Only ${eligible} successful/failed outcome${eligible === 1 ? "" : "s"} for this pattern; ${MIN_LEARNING_SAMPLES} required before readiness changes.`,
    };
  }
  const failRate = failed / eligible;
  const successRate = successful / eligible;

  let min_evidence_delta = 0;
  let min_distinct_days_delta = 0;
  let score_floor_delta = 0;
  let explanation = "Historical outcomes for this pattern are mixed; no readiness adjustment.";

  if (failRate >= 0.6) {
    min_evidence_delta = failRate >= 0.9 && eligible >= 10 ? 2 : 1;
    if (failRate >= 0.9 && eligible >= 10) min_distinct_days_delta = 1;
    min_evidence_delta = Math.min(MAX_MIN_EVIDENCE_DELTA, min_evidence_delta);
    min_distinct_days_delta = Math.min(MAX_MIN_DISTINCT_DAYS_DELTA, min_distinct_days_delta);
    explanation =
      min_evidence_delta === 1
        ? "This situation requires one additional evidence point because previous decisions for this pattern were frequently evaluated as unsuccessful."
        : "This situation requires additional evidence and persistence because previous decisions for this pattern were repeatedly unsuccessful.";
  } else if (successRate >= 0.8) {
    score_floor_delta = -0.01;
    explanation =
      "Previous decisions for this pattern were usually successful, so the readiness score floor is slightly easier — gates still apply.";
  }

  return { min_evidence_delta, min_distinct_days_delta, score_floor_delta, explanation };
}

function persistPrior(prior: ReadinessPrior): void {
  const existing = (
    db.rawGet(`SELECT id FROM readiness_priors WHERE user_id = ? AND pattern_id = ? LIMIT 1`, [
      prior.user_id,
      prior.pattern_id,
    ]) as { id: string }[]
  )[0];
  if (existing) {
    db.rawRun(
      `UPDATE readiness_priors SET
         min_evidence_delta = ?, min_distinct_days_delta = ?, score_floor_delta = ?,
         sample_count = ?, successful_count = ?, failed_count = ?, partial_count = ?, inconclusive_count = ?,
         explanation = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        prior.min_evidence_delta,
        prior.min_distinct_days_delta,
        prior.score_floor_delta,
        prior.sample_count,
        prior.successful_count,
        prior.failed_count,
        prior.partial_count,
        prior.inconclusive_count,
        prior.explanation,
        existing.id,
      ],
    );
    return;
  }
  db.rawRun(
    `INSERT INTO readiness_priors (
      id, user_id, pattern_id, min_evidence_delta, min_distinct_days_delta, score_floor_delta,
      sample_count, successful_count, failed_count, partial_count, inconclusive_count, explanation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      prior.user_id,
      prior.pattern_id,
      prior.min_evidence_delta,
      prior.min_distinct_days_delta,
      prior.score_floor_delta,
      prior.sample_count,
      prior.successful_count,
      prior.failed_count,
      prior.partial_count,
      prior.inconclusive_count,
      prior.explanation,
    ],
  );
}

/**
 * Consume one evaluated decision_outcome into the pattern prior. Idempotent on decision_id.
 */
export function updateFromOutcome(decisionId: string): ReadinessPrior | null {
  const outcome = (
    db.rawGet(
      `SELECT decision_id, tenant_id, result, learning_applied, pattern_id FROM decision_outcomes WHERE decision_id = ? LIMIT 1`,
      [decisionId],
    ) as Array<{
      decision_id: string;
      tenant_id: string;
      result: string | null;
      learning_applied: number | null;
      pattern_id: string | null;
    }>
  )[0];
  if (!outcome) return null;

  const decision = db.getDecisionLedgerRow(decisionId);
  const sit = (
    db.rawGet(`SELECT user_id, pattern_id FROM situations WHERE decision_id = ? LIMIT 1`, [decisionId]) as {
      user_id: string;
      pattern_id: string;
    }[]
  )[0];
  const userId = String(sit?.user_id || decision?.user_id || outcome.tenant_id || "");
  if (!userId) return null;

  const patternId = learningPatternId(outcome.pattern_id || sit?.pattern_id);

  if (!outcome.pattern_id && !sit?.pattern_id) {
    db.rawRun(`UPDATE decision_outcomes SET learning_applied = 1 WHERE decision_id = ?`, [decisionId]);
    return emptyPrior(userId, "open_world");
  }

  if (Number(outcome.learning_applied || 0) === 1) {
    return getReadinessPrior(userId, patternId);
  }
  const result = String(outcome.result || "inconclusive").toLowerCase();
  const prior = getReadinessPrior(userId, patternId);
  prior.sample_count += 1;
  if (result === "successful") prior.successful_count += 1;
  else if (result === "failed") prior.failed_count += 1;
  else if (result === "partial") prior.partial_count += 1;
  else prior.inconclusive_count += 1;

  const derived = deriveDeltas(prior.successful_count, prior.failed_count);
  prior.min_evidence_delta = derived.min_evidence_delta;
  prior.min_distinct_days_delta = derived.min_distinct_days_delta;
  prior.score_floor_delta = derived.score_floor_delta;
  prior.explanation = derived.explanation;

  persistPrior(prior);
  db.rawRun(`UPDATE decision_outcomes SET learning_applied = 1 WHERE decision_id = ?`, [decisionId]);
  upsertLearningLog({
    userId,
    kind: "readiness_learning",
    keyId: decisionId,
    decisionId,
    insight: prior.explanation,
    analysis: {
      pattern_id: patternId,
      result,
      sample_count: prior.sample_count,
      failed_count: prior.failed_count,
      successful_count: prior.successful_count,
    },
    weights: {
      min_evidence_delta: prior.min_evidence_delta,
      score_floor_delta: prior.score_floor_delta,
    },
  });
  return prior;
}
