import { computeDynamicConfidence } from "../state/confidence.js";
import { DEFAULT_HALF_LIFE_DAYS } from "./config.js";

/** Evidence weight multiplier from time decay (confidence.ts half-life pattern). */
export function evidenceWeight(observedAt: string | Date, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  const factors = computeDynamicConfidence({
    baseEvidenceWeight: 1,
    observedAt,
    halfLifeDays,
    evidenceCount: 1,
  });
  return Math.max(0.05, factors.time_decay);
}
