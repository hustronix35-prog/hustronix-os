import type { BeliefUpdateObservation, EntityBeliefRow } from "../types.js";

export const GAUSSIAN_MODEL_ID = "gaussian_v1";

const PRIOR_MEAN = 0.5;
const PRIOR_VAR = 0.25;

export function parseGaussianParams(paramsJson: string): { sum_w: number; sum_wx: number; sum_wx2: number } {
  try {
    const p = JSON.parse(paramsJson) as { sum_w?: number; sum_wx?: number; sum_wx2?: number };
    return {
      sum_w: Number(p.sum_w ?? 1),
      sum_wx: Number(p.sum_wx ?? PRIOR_MEAN),
      sum_wx2: Number(p.sum_wx2 ?? PRIOR_MEAN * PRIOR_MEAN + PRIOR_VAR),
    };
  } catch {
    return { sum_w: 1, sum_wx: PRIOR_MEAN, sum_wx2: PRIOR_MEAN * PRIOR_MEAN + PRIOR_VAR };
  }
}

export function updateGaussianBelief(
  existing: EntityBeliefRow | null,
  obs: BeliefUpdateObservation,
  weight: number,
): { mean: number; variance: number; n_obs: number; params_json: string; model_id: string } {
  const prior = existing ? parseGaussianParams(existing.params_json) : parseGaussianParams("{}");
  const w = Math.max(0.01, obs.weight ?? weight);
  const x = Math.max(0, Math.min(1, obs.value ?? (obs.success ? 1 : 0)));
  const sum_w = prior.sum_w + w;
  const sum_wx = prior.sum_wx + w * x;
  const sum_wx2 = prior.sum_wx2 + w * x * x;
  const mean = sum_wx / sum_w;
  const variance = Math.max(0.001, sum_wx2 / sum_w - mean * mean);
  const n_obs = (existing?.n_obs ?? 0) + 1;
  return {
    mean: Math.max(0, Math.min(1, mean)),
    variance,
    n_obs,
    params_json: JSON.stringify({ sum_w, sum_wx, sum_wx2 }),
    model_id: GAUSSIAN_MODEL_ID,
  };
}
