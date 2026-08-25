/**
 * Action Policy Engine — control plane for external side effects.
 * Orchestrator produces intents; this decides ALLOW / REQUIRE_APPROVAL / DENY.
 * Mutations still go through authorizeAndExecuteMutation.
 */
import type { ActionType, PolicyDecision } from "./types.js";

const DEFAULTS: Record<ActionType, PolicyDecision> = {
  NOTIFY_OWNER: { verdict: "ALLOW", note: "Audience-routed owner notify is automatic." },
  NOTIFY_FOUNDER: { verdict: "ALLOW", note: "Informational founder notify is automatic." },
  ASK_CLARIFICATION: { verdict: "ALLOW", note: "Clarification is the exception channel." },
  LINK_EXISTING_WORK: { verdict: "ALLOW", note: "Linking existing Jira/Linear/GitHub is automatic." },
  RECOMMEND_OWNER: { verdict: "ALLOW", note: "Recommendation does not mutate assignment." },
  ASSIGN_OWNER: { verdict: "REQUIRE_APPROVAL", note: "Owner assignment changes capacity." },
  CREATE_JIRA: { verdict: "REQUIRE_APPROVAL", note: "Creating project work is policy-gated." },
  UPDATE_JIRA: { verdict: "REQUIRE_APPROVAL", note: "Updating project work is policy-gated." },
  CREATE_MEETING: { verdict: "REQUIRE_APPROVAL", note: "Scheduling is policy-gated." },
  START_TASK: { verdict: "REQUIRE_APPROVAL", note: "Starting work is a separate commitment from Approve." },
  MOVE_DEADLINE: { verdict: "REQUIRE_APPROVAL", note: "Deadline changes require approval." },
  REALLOCATE_OWNER: { verdict: "REQUIRE_APPROVAL", note: "High-capacity reallocation requires approval." },
  CHANGE_DECISION: { verdict: "DENY", note: "Strategic vow changes are human-only." },
  REVERSE_VOW: { verdict: "DENY", note: "Reversing a vow is human-only." },
};

export function evaluateActionPolicy(actionType: ActionType): PolicyDecision {
  return DEFAULTS[actionType] ?? { verdict: "DENY", note: "Unknown action — denied by default." };
}

export function initialStatusForPolicy(verdict: PolicyDecision["verdict"]): "AUTHORIZED" | "AWAITING_APPROVAL" | "DENIED" {
  if (verdict === "ALLOW") return "AUTHORIZED";
  if (verdict === "REQUIRE_APPROVAL") return "AWAITING_APPROVAL";
  return "DENIED";
}
