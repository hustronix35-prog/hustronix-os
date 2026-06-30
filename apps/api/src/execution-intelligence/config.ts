/** Feature extraction schema version — bump when extraction logic changes. */
export const FEATURE_VERSION = "v1";

export const MODEL_VERSION = "shadow_v1";
export const ALGORITHM_VERSION = "beta_gaussian_blend_v1";

export const DEFAULT_HALF_LIFE_DAYS = 90;
export const DERIVED_CAPACITY_THRESHOLD = 0.85;
export const BASE_CAPACITY_WEIGHT = 3.0;

/** Load buckets for performance_at_load beliefs. */
export const LOAD_BUCKETS = [
  { key: "0-1", min: 0, max: 1 },
  { key: "1-2", min: 1, max: 2 },
  { key: "2-3", min: 2, max: 3 },
  { key: "3+", min: 3, max: Infinity },
] as const;

export function loadBucketFor(activeLoad: number): string {
  for (const b of LOAD_BUCKETS) {
    if (activeLoad >= b.min && activeLoad < b.max) return b.key;
  }
  return "3+";
}

export const TRUST_WEIGHTS: Record<string, number> = {
  reliability: 0.25,
  execution_speed: 0.15,
  planning_accuracy: 0.15,
  decision_quality: 0.15,
  collaboration: 0.05,
  ownership: 0.1,
  consistency: 0.1,
  recovery_ability: 0.05,
};
