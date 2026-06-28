/**
 * Trust Engine V8 — per-entity trust scores with explainable inputs.
 */
export type TrustEntityType =
  | "memory"
  | "decision"
  | "signal"
  | "recommendation"
  | "project";

export interface TrustScoreInput {
  entityType: TrustEntityType;
  evidenceCount: number;
  contradictionCount: number;
  sourceQuality: number;
  humanVerified: boolean;
  recencyHours: number;
  historicalAccuracy?: number;
}

export interface TrustScoreResult {
  score: number;
  evidenceCount: number;
  sourceQuality: number;
  contradictions: number;
  humanVerification: boolean;
  recencyFactor: number;
  reasoning: string;
}

const SOURCE_QUALITY: Record<TrustEntityType, number> = {
  memory: 0.5,
  decision: 0.9,
  signal: 0.55,
  recommendation: 0.45,
  project: 0.6,
};

export function computeEntityTrustScore(input: TrustScoreInput): TrustScoreResult {
  const baseQuality = Math.max(input.sourceQuality, SOURCE_QUALITY[input.entityType] ?? 0.5);
  const evidenceBoost = Math.min(0.25, input.evidenceCount * 0.05);
  const contradictionPenalty = Math.min(0.4, input.contradictionCount * 0.12);
  const humanBoost = input.humanVerified ? 0.15 : 0;
  const recencyFactor = Math.max(0.5, 1 - input.recencyHours / (24 * 30));
  const hist = input.historicalAccuracy ?? 0.5;

  let score =
    (baseQuality + evidenceBoost + humanBoost) * recencyFactor * (0.7 + hist * 0.3) -
    contradictionPenalty;
  score = Math.max(0, Math.min(1, score));

  const reasoning = [
    `entity=${input.entityType}`,
    `evidence=${input.evidenceCount}`,
    `contradictions=${input.contradictionCount}`,
    `source_quality=${baseQuality.toFixed(2)}`,
    `human_verified=${input.humanVerified}`,
    `recency_factor=${recencyFactor.toFixed(2)}`,
  ].join("; ");

  return {
    score,
    evidenceCount: input.evidenceCount,
    sourceQuality: baseQuality,
    contradictions: input.contradictionCount,
    humanVerification: input.humanVerified,
    recencyFactor,
    reasoning,
  };
}

export interface RecommendationTrustEnvelope {
  trustScore: number;
  evidence: string[];
  sources: string[];
  confidence: number;
  reasoning: string;
  contradictions: string[];
}

export function buildRecommendationEnvelope(params: {
  entityType: TrustEntityType;
  statement: string;
  evidence: string[];
  sources: string[];
  contradictions?: string[];
  humanVerified?: boolean;
}): RecommendationTrustEnvelope {
  const trust = computeEntityTrustScore({
    entityType: params.entityType,
    evidenceCount: params.evidence.length,
    contradictionCount: params.contradictions?.length ?? 0,
    sourceQuality: SOURCE_QUALITY[params.entityType],
    humanVerified: params.humanVerified ?? false,
    recencyHours: 1,
  });
  return {
    trustScore: trust.score,
    evidence: params.evidence,
    sources: params.sources,
    confidence: trust.score,
    reasoning: trust.reasoning,
    contradictions: params.contradictions ?? [],
  };
}
