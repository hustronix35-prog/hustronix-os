import type { ConfidenceFactors } from "../entities/types.js";

export type DynamicConfidenceInput = ConfidenceInput;

export interface ConfidenceInput {
  baseEvidenceWeight?: number;
  sourceQuality?: number;
  evidenceCount?: number;
  contradictionPenalty?: number;
  contradictionCount?: number;
  /** Age in days for time decay (computed from observedAt/freshnessAt when omitted). */
  ageDays?: number;
  observedAt?: string | Date | null;
  freshnessAt?: string | Date | null;
  halfLifeDays?: number;
  freshnessBonus?: number;
  humanVerificationBoost?: number;
  humanVerified?: boolean;
}

function daysSince(iso: string | Date | null | undefined): number {
  if (!iso) return 0;
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
}

/**
 * Unified dynamic confidence — applied to entities, facts, state sections, and links.
 */
export function computeDynamicConfidence(input: ConfidenceInput): ConfidenceFactors {
  const base = Math.max(0, Math.min(1, input.baseEvidenceWeight ?? 0.5));
  const source = Math.max(0, Math.min(1, input.sourceQuality ?? 0.6));
  const count = Math.max(0, input.evidenceCount ?? 0);
  const evidenceBoost = Math.min(0.25, 0.04 * count);

  const contradictionFromCount = Math.min(0.5, (input.contradictionCount ?? 0) * 0.12);
  const contradiction = Math.max(
    contradictionFromCount,
    Math.max(0, Math.min(0.5, input.contradictionPenalty ?? 0)),
  );

  const halfLife = Math.max(1, input.halfLifeDays ?? 90);
  const age =
    input.ageDays ??
    daysSince(input.observedAt ?? input.freshnessAt);
  const decay = Math.pow(0.5, age / halfLife);

  const freshnessDays = daysSince(input.freshnessAt ?? input.observedAt);
  const freshnessFromAge =
    freshnessDays <= 1 ? 0.08 : freshnessDays <= 7 ? 0.04 : 0;
  const freshness = Math.max(
    freshnessFromAge,
    Math.max(0, Math.min(0.15, input.freshnessBonus ?? 0)),
  );

  const human = input.humanVerified
    ? 0.15
    : Math.max(0, Math.min(0.2, input.humanVerificationBoost ?? 0));

  const raw =
    (base * 0.35 + source * 0.25 + evidenceBoost) * decay * (1 - contradiction) + freshness + human;
  const confidence = Math.max(0, Math.min(1, raw));

  return {
    base_evidence_weight: base,
    source_quality: source,
    evidence_count: count,
    contradiction_penalty: contradiction,
    time_decay: decay,
    freshness_bonus: freshness,
    human_verification_boost: human,
    confidence,
  };
}
