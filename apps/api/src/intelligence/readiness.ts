/**
 * Multi-factor decision-readiness score.
 * Keywords/facets propose; readiness decides.
 * Optional bounded prior from decision_outcomes — never bypasses gateOk.
 */
import {
  BASE_SCORE_FLOOR,
  effectiveScoreFloor,
  explainReadinessPrior,
  type ReadinessPrior,
} from "./readiness-learning.js";

export type ReadinessInput = {
  facetCount: number;
  facetTarget: number;
  evidenceCount: number;
  distinctDays: number;
  sourceCount: number;
  entityCount: number;
  trajectory: "IMPROVING" | "STABLE" | "WORSENING";
  confidence: number;
  gateOk: boolean;
  impactHint?: boolean;
  /** Bounded prior from readiness-learning. Does not replace gateOk. */
  prior?: ReadinessPrior | null;
};

export type ReadinessResult = {
  score: number;
  ready: boolean;
  parts: Record<string, number>;
  learning?: Record<string, unknown>;
};

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const facetCoverage = Math.min(1, input.facetCount / Math.max(input.facetTarget, 1));
  const evidenceStrength = Math.min(1, input.evidenceCount / 8);
  const persistence = Math.min(1, input.distinctDays / 4);
  const sourceDiversity = Math.min(1, input.sourceCount / 3);
  const entityRichness = Math.min(1, input.entityCount / 3);
  const trajectory =
    input.trajectory === "WORSENING" ? 1 : input.trajectory === "STABLE" ? 0.55 : 0.25;
  const impact = input.impactHint ? 1 : 0.5;

  const parts = {
    facetCoverage,
    evidenceStrength,
    persistence,
    sourceDiversity,
    entityRichness,
    trajectory,
    impact,
    confidence: input.confidence,
  };

  const score =
    0.22 * facetCoverage +
    0.18 * evidenceStrength +
    0.14 * persistence +
    0.12 * sourceDiversity +
    0.12 * entityRichness +
    0.12 * trajectory +
    0.05 * impact +
    0.05 * input.confidence;

  const floor = input.prior ? effectiveScoreFloor(input.prior) : BASE_SCORE_FLOOR;
  // Readiness score calibrates; pattern gates still required (no bypass)
  const ready = input.gateOk && score >= floor;

  const result: ReadinessResult = { score: Math.round(score * 1000) / 1000, ready, parts };
  if (input.prior) {
    result.learning = explainReadinessPrior(input.prior, result.score);
  }
  return result;
}
