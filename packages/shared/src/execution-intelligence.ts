/** Shared Execution Intelligence Engine (EIE) API shapes — advisory only in V1. */

export type BeliefView = {
  beliefKey: string;
  mean: number;
  confidence: number;
  variance: number;
  nObs: number;
  modelId: string;
};

export type DerivedCapacityView = {
  value: number;
  confidence: number;
  uncertainty: number;
};

export type PredictionExplanation = {
  factor: string;
  belief_key?: string;
  contribution: number;
  domain?: string;
  active_load?: number;
};

export type TeamMemberIntelligence = {
  beliefs?: BeliefView[];
  derivedCapacity?: DerivedCapacityView;
  legacyCapacity?: number;
  trustScore?: { mean: number; confidence: number; nObs: number };
  intelligenceAdvisory?: boolean;
};
