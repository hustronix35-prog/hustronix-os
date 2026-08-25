export const ACTION_TYPES = [
  "LINK_EXISTING_WORK",
  "ASK_CLARIFICATION",
  "NOTIFY_OWNER",
  "NOTIFY_FOUNDER",
  "RECOMMEND_OWNER",
  "ASSIGN_OWNER",
  "CREATE_JIRA",
  "UPDATE_JIRA",
  "CREATE_MEETING",
  "START_TASK",
  "MOVE_DEADLINE",
  "REALLOCATE_OWNER",
  "CHANGE_DECISION",
  "REVERSE_VOW",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export type PolicyVerdict = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export type ActionStatus =
  | "QUEUED"
  | "AWAITING_APPROVAL"
  | "AUTHORIZED"
  | "COMPLETED"
  | "DENIED"
  | "BLOCKED_CONNECTOR"
  | "FAILED"
  | "SKIPPED";

export type TargetSystem = "ledger" | "jira" | "calendar" | "people" | "notify";

export type ExecutionIntent = {
  actionType: ActionType;
  targetSystem: TargetSystem;
  decisionId: string;
  executionId?: string;
  idempotencyKey: string;
  reason: string;
  owner?: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  payload: Record<string, unknown>;
};

export type PolicyDecision = {
  verdict: PolicyVerdict;
  note: string;
};

export type ActionLedgerRow = {
  id: string;
  orgId: string;
  decisionId: string;
  executionId: string | null;
  runId: string;
  actionType: ActionType;
  targetSystem: string;
  idempotencyKey: string;
  intent: Record<string, unknown>;
  reason: string;
  owner: string | null;
  risk: string;
  policyResult: PolicyVerdict;
  status: ActionStatus;
  authorization: string | null;
  externalId: string | null;
  error: string | null;
  requestedAt: string;
  completedAt: string | null;
};

export type OrchestrationSummary = {
  decisionId: string;
  vow: string;
  status: string;
  readinessPct: number;
  recommendedNext: string;
  runId: string | null;
  counts: {
    actions: number;
    existing: number;
    missing: number;
    meetings: number;
    clarifications: number;
    people: number;
    awaitingApproval: number;
    completed: number;
    blockedConnector: number;
  };
  people: string[];
  actions: ActionLedgerRow[];
};
