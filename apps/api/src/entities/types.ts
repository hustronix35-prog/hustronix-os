export const ENTITY_TYPES = [
  "company",
  "team",
  "decision",
  "task",
  "customer",
  "competitor",
  "metric",
  "feature",
  "commitment",
  "meeting",
  "person",
  "project",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type EntityEdgeType =
  | "CAUSED_BY"
  | "OBSERVED_IN"
  | "OWNED_BY"
  | "SUPPORTS"
  | "CONTRADICTS"
  | "SUPERSEDES"
  | "RELATED_TO";

export interface EntityRecord {
  id: string;
  tenant_id: string;
  type: EntityType;
  label: string;
  ref_id: string | null;
  metadata_json: string;
  confidence: number;
  freshness_at: string;
  created_at: string;
}

export interface EntityNeighbor {
  entity_id: string;
  type: EntityType;
  label: string;
  edge_type: EntityEdgeType;
  confidence: number;
  direction: "outbound" | "inbound";
}

export interface EntityTimelineEvent {
  at: string;
  kind: string;
  label: string;
  ref_id?: string | null;
  confidence?: number;
}

export interface ConfidenceFactors {
  base_evidence_weight: number;
  source_quality: number;
  evidence_count: number;
  contradiction_penalty: number;
  time_decay: number;
  freshness_bonus: number;
  human_verification_boost: number;
  confidence: number;
}
