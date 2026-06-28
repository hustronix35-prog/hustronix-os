import { db } from "../database.js";
import type { AuthKind } from "../middleware/auth.js";
import { AuthorizationError, TenantIsolationError } from "./authorization-errors.js";
import {
  type Permission,
  userHasPermission,
} from "./authorization.js";
import { resolveTenantContext } from "./tenant-context.js";

/** Coordinator + memory + sub-agent tool names mapped to required permissions. Default: DENY. */
export const TOOL_PERMISSION_REGISTRY: Readonly<Record<string, Permission>> = {
  log_strategic_decision: "decision:write",
  commit_decision: "decision:commit",
  transition_execution: "execution:write",
  link_execution_signal: "execution:write",
  kill_signal: "signal:write",
  remember_fact: "memory:write",
  recall_memory: "memory:read",
  get_current_time: "agent:invoke",
  web_search: "agent:invoke",
  delegate_to_marketing: "agent:invoke",
  delegate_to_research: "agent:invoke",
  ping: "agent:invoke",
  update_domain_state: "agent:invoke",
};

/** Sub-agents may search the web and write domain state patches. */
export const SUB_AGENT_ALLOWED_TOOLS = new Set(["web_search", "update_domain_state"]);

export interface ToolAuthorizationContext {
  userId: string;
  authKind?: AuthKind | string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
}

export function requiredPermissionForTool(toolName: string): Permission | null {
  if (toolName.startsWith("mcp__")) return "agent:invoke";
  return TOOL_PERMISSION_REGISTRY[toolName] ?? null;
}

export function assertToolPermitted(ctx: ToolAuthorizationContext): Permission {
  const permission = requiredPermissionForTool(ctx.toolName);
  if (!permission) {
    throw new AuthorizationError(`Tool "${ctx.toolName}" is not registered — denied by default.`);
  }
  if (!userHasPermission(ctx.userId, ctx.authKind, permission)) {
    throw new AuthorizationError(
      `Missing permission "${permission}" for tool "${ctx.toolName}".`,
      permission,
    );
  }
  return permission;
}

export function assertExecutionOwnership(userId: string, taskId: string): void {
  const tenant = db.getExecutionTenantForTask(taskId);
  if (!tenant) {
    throw new TenantIsolationError("Task not found.");
  }
  const ctx = resolveTenantContext(userId);
  if (
    userId !== "system" &&
    tenant !== userId &&
    tenant !== ctx.orgId
  ) {
    throw new TenantIsolationError("Forbidden: task belongs to another account.");
  }
}

export function assertDecisionOwnership(userId: string, decisionId: string): void {
  const tenant = db.getDecisionTenant(decisionId);
  if (!tenant) {
    throw new TenantIsolationError("Decision not found.");
  }
  const ctx = resolveTenantContext(userId);
  if (userId !== "system" && tenant !== userId && tenant !== ctx.orgId) {
    throw new TenantIsolationError("Forbidden: decision belongs to another account.");
  }
}

/**
 * Full tool authorization: permission check + resource ownership for mutating tools.
 */
export function authorizeToolExecution(ctx: ToolAuthorizationContext): Permission {
  const permission = assertToolPermitted(ctx);

  if (ctx.toolName === "transition_execution" && ctx.toolArgs) {
    const taskId = String(ctx.toolArgs.task_id ?? ctx.toolArgs.taskId ?? "").trim();
    if (!taskId) {
      throw new AuthorizationError("transition_execution requires task_id.");
    }
    assertExecutionOwnership(ctx.userId, taskId);
  }

  return permission;
}

export function assertSubAgentToolAllowed(toolName: string): void {
  if (!SUB_AGENT_ALLOWED_TOOLS.has(toolName)) {
    throw new AuthorizationError(
      `Sub-agent tool "${toolName}" is not allowed — sub-agents are read-only.`,
    );
  }
}
