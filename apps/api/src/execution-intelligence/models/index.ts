import type { BeliefUpdateObservation, EntityBeliefRow } from "../types.js";
import { updateBetaBelief, BETA_MODEL_ID } from "./beta-v1.js";
import { updateGaussianBelief, GAUSSIAN_MODEL_ID } from "./gaussian-v1.js";

export type BeliefModelKind = "beta" | "gaussian";

const BETA_KEYS = new Set([
  "reliability",
  "ownership",
  "collaboration",
  "consistency",
  "recovery_ability",
  "decision_quality",
  "learning_rate",
]);

export function modelKindForBeliefKey(beliefKey: string): BeliefModelKind {
  if (beliefKey.startsWith("performance_at_load:") || beliefKey.startsWith("expertise:")) {
    return "beta";
  }
  return BETA_KEYS.has(beliefKey) ? "beta" : "gaussian";
}

export function updateBeliefWithModel(
  beliefKey: string,
  existing: EntityBeliefRow | null,
  obs: BeliefUpdateObservation,
  weight: number,
) {
  const kind = modelKindForBeliefKey(beliefKey);
  if (kind === "beta") {
    return updateBetaBelief(existing, obs, weight);
  }
  return updateGaussianBelief(existing, obs, weight);
}

export { BETA_MODEL_ID, GAUSSIAN_MODEL_ID };
