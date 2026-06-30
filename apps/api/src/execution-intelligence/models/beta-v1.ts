import type { BeliefUpdateObservation, EntityBeliefRow } from "../types.js";

export const BETA_MODEL_ID = "beta_v1";

const PRIOR_ALPHA = 2;
const PRIOR_BETA = 2;

export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

export function betaVariance(alpha: number, beta: number): number {
  const s = alpha + beta;
  return (alpha * beta) / (s * s * (s + 1));
}

export function parseBetaParams(paramsJson: string): { alpha: number; beta: number } {
  try {
    const p = JSON.parse(paramsJson) as { alpha?: number; beta?: number };
    return {
      alpha: Number(p.alpha ?? PRIOR_ALPHA),
      beta: Number(p.beta ?? PRIOR_BETA),
    };
  } catch {
    return { alpha: PRIOR_ALPHA, beta: PRIOR_BETA };
  }
}

export function updateBetaBelief(
  existing: EntityBeliefRow | null,
  obs: BeliefUpdateObservation,
  weight: number,
): { mean: number; variance: number; n_obs: number; params_json: string; model_id: string } {
  const prior = existing ? parseBetaParams(existing.params_json) : { alpha: PRIOR_ALPHA, beta: PRIOR_BETA };
  const w = Math.max(0.01, obs.weight ?? weight);
  const success = obs.success ?? (obs.value != null ? obs.value >= 0.5 : true);
  const alpha = prior.alpha + (success ? w : 0);
  const beta = prior.beta + (success ? 0 : w);
  const n_obs = (existing?.n_obs ?? 0) + 1;
  return {
    mean: betaMean(alpha, beta),
    variance: betaVariance(alpha, beta),
    n_obs,
    params_json: JSON.stringify({ alpha, beta }),
    model_id: BETA_MODEL_ID,
  };
}
