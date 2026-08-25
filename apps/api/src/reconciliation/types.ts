/** First-class org claims — distinct from security/claim-validation (memory gate). */

export const STATE_DIMENSIONS = [
  "TASK_STATUS",
  "IMPLEMENTATION",
  "CODE_INTEGRATION",
  "OWNERSHIP",
  "DEADLINE",
  "DECISION",
  "DEPENDENCY",
  "LAUNCH_READINESS",
  "CUSTOMER_READINESS",
] as const;

export type StateDimension = (typeof STATE_DIMENSIONS)[number];

export const CLAIM_STATES = [
  "COMPLETE",
  "IN_PROGRESS",
  "BLOCKED",
  "NOT_STARTED",
  "READY",
  "AT_RISK",
  "UNKNOWN",
] as const;

export type ClaimState = (typeof CLAIM_STATES)[number];

export const CLAIM_INTENTS = [
  "OBSERVATION",
  "ASSERTION",
  "PROPOSAL",
  "DECISION",
  "COMMITMENT",
  "PREDICTION",
  "QUESTION",
  "OPINION",
] as const;

export type ClaimIntent = (typeof CLAIM_INTENTS)[number];

/** Intents that may write typed state / open hard conflicts. */
export const STATE_SETTING_INTENTS = new Set<ClaimIntent>([
  "OBSERVATION",
  "ASSERTION",
  "DECISION",
  "COMMITMENT",
]);

export type ClaimStatus = "ACTIVE" | "SUPERSEDED" | "RETRACTED" | "MERGED";

export type ConflictType =
  | "STATE_MISMATCH"
  | "TEMPORAL_MISMATCH"
  | "AUTHORITY_MISMATCH"
  | "STALE_SIGNAL"
  | "SEMANTIC_CONFLICT"
  | "PARTIAL_STATE"
  | "UNKNOWN";

export type ConflictSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ConflictStatus = "OPEN" | "RESOLVED" | "COEXISTING" | "ESCALATED" | "DISMISSED";

export type ResolutionType =
  | "SUPERSEDED"
  | "COEXIST"
  | "STALE"
  | "MERGED"
  | "HUMAN_DECISION"
  | "UNKNOWN";

export type ExtractorKind = "heuristic" | "llm" | "adapter" | "human";

export interface CandidateClaim {
  entityId: string;
  entityLabel: string;
  dimension: StateDimension;
  predicate: string;
  value: string;
  state: ClaimState | null;
  intent: ClaimIntent;
  confidence: number;
  specificity: number;
  directness: number;
}

export interface ScoredEvidenceFactors {
  authority: number;
  freshness: number;
  reliability: number;
  specificity: number;
  directness: number;
  score: number;
}

export interface OrgClaimRow {
  id: string;
  tenant_id: string;
  entity_id: string;
  entity_label: string | null;
  dimension: string;
  predicate: string;
  value: string;
  state: string | null;
  intent: string;
  status: string;
  confidence: number;
  evidence_score: number | null;
  claim_key: string;
  first_seen_at: string;
  last_seen_at: string;
  superseded_by_claim_id: string | null;
}

export interface ReconciliationResult {
  signalId: string;
  claimsUpserted: number;
  evidenceAttached: number;
  conflictsOpened: number;
  conflictsResolved: number;
  conflictsEscalated: number;
  snapshotsUpdated: number;
  skippedReason?: string;
  error?: string;
}
