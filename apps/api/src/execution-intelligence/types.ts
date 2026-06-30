export type EntityType = "person" | "team" | "decision" | "task" | "project";

export type EvidenceEventType =
  | "task.completed"
  | "task.killed"
  | "task.blocked"
  | "task.spawned"
  | "signal.shadow_killed"
  | "signal.linked"
  | "decision.outcome"
  | "prediction.calibration_error";

export interface EvidenceInput {
  tenantId: string;
  eventType: EvidenceEventType;
  subjectEntityType: EntityType;
  subjectEntityId: string;
  sourceEntityType?: EntityType | null;
  sourceEntityId?: string | null;
  payload: Record<string, unknown>;
  observedAt?: string;
  idempotencyKey: string;
}

export interface EvidenceRecord extends EvidenceInput {
  id: string;
  observedAt: string;
}

export interface FeatureVector {
  active_load?: number;
  duration_ratio?: number;
  planning_error_ratio?: number;
  attribution?: string;
  domain_tokens?: string[];
  delta_score?: number;
  error_magnitude?: number;
  prediction_type?: string;
  on_time?: boolean;
  recovery_path?: boolean;
  grace_exceeded?: boolean;
  source?: string;
  load_bucket?: string;
  success?: boolean;
  [key: string]: unknown;
}

export interface EntityBeliefRow {
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  belief_key: string;
  model_id: string;
  mean: number;
  variance: number;
  n_obs: number;
  params_json: string;
  updated_at: string;
}

export interface BeliefView {
  beliefKey: string;
  mean: number;
  confidence: number;
  variance: number;
  nObs: number;
  modelId: string;
}

export interface PredictionExplanation {
  factor: string;
  belief_key?: string;
  contribution: number;
  domain?: string;
  active_load?: number;
}

export interface PredictionRecord {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  predictionType: string;
  predictedValue: number;
  actualValue: number | null;
  confidence: number;
  explanation: PredictionExplanation[];
  modelVersion: string;
  featureVersion: string;
  algorithmVersion: string;
  evidenceId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface BeliefUpdateObservation {
  success?: boolean;
  value?: number;
  weight?: number;
}
