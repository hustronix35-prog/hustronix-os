import { DEFAULT_HALF_LIFE_HOURS } from "./config.js";
import { lookupAuthority } from "./authority.js";
import type { ScoredEvidenceFactors } from "./types.js";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function hoursSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, ms / 3_600_000);
}

export function freshnessScore(ageHours: number, halfLifeHours: number): number {
  const hl = halfLifeHours > 0 ? halfLifeHours : 168;
  return clamp01(Math.exp((-Math.LN2 * ageHours) / hl));
}

/**
 * Deterministic evidence score — LLM must never invent these factors.
 * score = authority × freshness × reliability × specificity × directness
 */
export function scoreEvidence(params: {
  tenantId: string;
  source: string;
  dimension: string;
  detectedAt?: string | null;
  specificity: number;
  directness: number;
}): ScoredEvidenceFactors {
  const auth = lookupAuthority(params.tenantId, params.source, params.dimension);
  const halfLife =
    auth.halfLifeHours ||
    DEFAULT_HALF_LIFE_HOURS[params.dimension] ||
    DEFAULT_HALF_LIFE_HOURS["*"] ||
    168;
  const freshness = freshnessScore(hoursSince(params.detectedAt), halfLife);
  const specificity = clamp01(params.specificity);
  const directness = clamp01(params.directness);
  const authority = auth.authority;
  const reliability = auth.reliability;
  const score = clamp01(authority * freshness * reliability * specificity * directness);
  return { authority, freshness, reliability, specificity, directness, score };
}
