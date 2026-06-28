import { db } from "../database.js";
import { requireCausalValidationForActivation } from "../institutional-reasoning.js";
import { onDecisionCommitted } from "../beliefs/belief-engine.js";
import { assertEpistemicSupportForCommit } from "../evaluation/outcome-evaluation.js";
import { notify, defaultAppLink } from "../notifications/dispatcher.js";
import { assertLedgerTenantAccess } from "./tenant-scope.js";
import { resolveTenantContext } from "./tenant-context.js";
import type { AuthKind } from "../middleware/auth.js";

export interface CommitDecisionOptions {
  approvalId?: string;
  emergencyOverride?: boolean;
  emergencyReason?: string;
}

export function mutationCreateDraftDecision(
  userId: string,
  body: {
    vow?: string;
    expected_outcomes?: unknown[];
    tasks?: { type?: string; weight?: number; owner?: string }[];
    institutional_reasoning?: unknown;
    reversal_conditions?: string;
    constraints?: unknown[];
  },
): { id: string; status: string } {
  const vow = String(body.vow || "").trim();
  if (!vow) throw new Error("vow required");
  const tasks =
    Array.isArray(body.tasks) && body.tasks.length > 0
      ? body.tasks.map((t) => ({
          type: t.type || "ACTION",
          weight: typeof t.weight === "number" ? t.weight : 1,
          owner: String(t.owner || "system").slice(0, 120),
        }))
      : [{ type: "ACTION", weight: 1, owner: "system" }];
  const payload: Record<string, unknown> = {
    vow: vow.slice(0, 4000),
    expected_outcomes: Array.isArray(body.expected_outcomes)
      ? body.expected_outcomes
      : [{ metric: "Outcome", target: "Define success criteria" }],
    constraints: Array.isArray(body.constraints) ? body.constraints : [],
    confidence: 0.75,
    tasks,
  };
  if (body.reversal_conditions != null && String(body.reversal_conditions).trim() !== "") {
    payload.reversal_conditions = String(body.reversal_conditions).slice(0, 8000);
  }
  if (body.institutional_reasoning != null && typeof body.institutional_reasoning === "object") {
    payload.institutional_reasoning = body.institutional_reasoning;
  }
  const id = db.saveDecisionEvent(userId, payload);
  return { id, status: "DRAFT" };
}

export function mutationTransitionExecution(
  userId: string,
  params: { taskId: string; newState: string; reason?: string },
): Record<string, unknown> {
  const { taskId, newState, reason } = params;
  if (!taskId || !newState) throw new Error("taskId and newState required");
  const tenant = db.getExecutionTenantForTask(taskId);
  if (!tenant) throw new Error("Task not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  return { success: true, ...db.transitionExecutionState(taskId, newState, reason) };
}

export function mutationLinkSignal(
  userId: string,
  params: {
    signalId: string;
    taskId: string;
    linkMethod?: string;
    linkProvenance?: Record<string, unknown>;
  },
): void {
  const { signalId, taskId, linkMethod, linkProvenance } = params;
  if (!signalId || !taskId) throw new Error("signalId and taskId required");
  const sigT = db.getSignalTenant(signalId);
  const execT = db.getExecutionTenantForTask(taskId);
  if (!sigT || !execT) throw new Error("Signal or task not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, sigT);
    assertLedgerTenantAccess(ctx, execT);
  }
  db.linkExternalSignalToTask(signalId, taskId, {
    linkMethod: linkMethod ?? "manual",
    linkProvenance: linkProvenance ?? { actor: userId },
  });
}

export function mutationUnlinkSignal(userId: string, params: { signalId: string }): void {
  const { signalId } = params;
  if (!signalId) throw new Error("signalId required");
  const tenant = db.getSignalTenant(signalId);
  if (!tenant) throw new Error("Signal not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  db.unlinkExternalSignal(signalId);
}

export function mutationKillSignal(userId: string, params: { signalId: string }): void {
  const { signalId } = params;
  if (!signalId) throw new Error("signalId required");
  const tenant = db.getSignalTenant(signalId);
  if (!tenant) throw new Error("Signal not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  db.killExternalSignal(signalId);
}

export function mutationCommitDecision(
  userId: string,
  decisionId: string,
  justification?: string,
  _options?: CommitDecisionOptions,
): string {
  const ctx = resolveTenantContext(userId);
  const tenant = db.getDecisionTenant(decisionId);
  if (!tenant) throw new Error("Decision not found.");
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  const row = db.getDecisionLedgerRow(decisionId);
  if (row?.decision_reasoning != null && String(row.decision_reasoning).trim() !== "") {
    requireCausalValidationForActivation(row.decision_reasoning);
    assertEpistemicSupportForCommit(userId, decisionId);
  }
  db.transitionDecisionState(decisionId, "ACTIVE", justification || "Committed via Hustronix");
  onDecisionCommitted(userId, decisionId);
  if (userId !== "system") {
    void notify(userId, {
      kind: "decision.committed",
      title: "Decision committed",
      body: `Decision ${decisionId} is now ACTIVE.`,
      linkUrl: defaultAppLink(`/mission-control`),
      payload: { decisionId, status: "ACTIVE" },
    }).catch((err) => console.error("[notifications] decision.committed:", err));
  }
  return ctx.orgId;
}

/** Map agent tool args to gateway tool names. */
export function agentToolGatewayName(toolName: string): string {
  return toolName;
}

export function agentToolArgsForGateway(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === "transition_execution") {
    const taskId = args.task_id ?? args.taskId;
    return { task_id: taskId, newState: args.newState, reason: args.reason ?? "" };
  }
  if (toolName === "log_strategic_decision") {
    return { ...args, vow: args.vow ?? "" };
  }
  return args;
}

export type MutationAuthKind = AuthKind | string | undefined;
