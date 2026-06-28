import type { AuthKind } from "../middleware/auth.js";
import {
  AuthorizationError,
  CapabilityDeniedError,
  TenantIsolationError,
} from "./authorization-errors.js";
import type { Permission } from "./authorization.js";
import { roleForUser } from "./authorization.js";
import { recordAgentActionAudit } from "./agent-audit.js";
import {
  HIGH_RISK_TOOLS,
  issueCapabilityToken,
  verifyCapabilityToken,
} from "./capability-tokens.js";
import { authorizeToolExecution } from "./tool-permissions.js";
import { enforceHighRiskApproval } from "./approval-gate.js";
import { resolveTenantContext } from "./tenant-context.js";
import { recordSecurityEventV8 } from "./security-observability.js";

export interface SecureToolExecutionContext {
  userId: string;
  authKind?: AuthKind | string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  capabilityToken?: string;
  approvalId?: string;
  emergencyOverride?: boolean;
  emergencyReason?: string;
}

export interface SecureToolExecutionResult {
  permission: Permission;
  capabilityJti: string;
  tenantId: string;
  workspaceId: string;
}

/**
 * Central gate for agent tool execution: tenant + RBAC + approval + capability + audit.
 */
export function secureAuthorizeToolExecution(
  ctx: SecureToolExecutionContext,
): SecureToolExecutionResult {
  const tenantCtx = resolveTenantContext(ctx.userId);
  let permission: Permission;
  try {
    permission = authorizeToolExecution({
      userId: ctx.userId,
      authKind: ctx.authKind,
      toolName: ctx.toolName,
      toolArgs: ctx.toolArgs,
    });
  } catch (err) {
    const reason =
      err instanceof AuthorizationError || err instanceof TenantIsolationError
        ? err.message
        : "Authorization failed.";
    recordAgentActionAudit({
      tenantId: tenantCtx.orgId,
      actorId: ctx.userId,
      authKind: String(ctx.authKind || ""),
      toolName: ctx.toolName,
      outcome: "DENIED",
      denialReason: reason,
      argsPreview: ctx.toolArgs ? JSON.stringify(ctx.toolArgs).slice(0, 200) : null,
    });
    recordSecurityEventV8({
      actorId: ctx.userId,
      action: "tool.privilege_denied",
      resourceType: "tool",
      resourceId: ctx.toolName,
      tenantId: tenantCtx.orgId,
      workspaceId: tenantCtx.workspaceId,
      result: "DENIED",
      riskLevel: "HIGH",
      metadata: { reason },
    });
    throw err;
  }

  enforceHighRiskApproval({
    userId: ctx.userId,
    tenantId: tenantCtx.orgId,
    workspaceId: tenantCtx.workspaceId,
    toolName: ctx.toolName,
    toolArgs: ctx.toolArgs ?? {},
    permission,
    approvalId: ctx.approvalId,
    emergencyOverride: ctx.emergencyOverride,
    emergencyReason: ctx.emergencyReason,
  });

  const issued = issueCapabilityToken({
    userId: ctx.userId,
    tenantId: tenantCtx.orgId,
    toolName: ctx.toolName,
    permission,
  });

  if (HIGH_RISK_TOOLS.has(ctx.toolName)) {
    const token = ctx.capabilityToken ?? issued.token;
    try {
      verifyCapabilityToken(
        token,
        {
          userId: ctx.userId,
          tenantId: tenantCtx.orgId,
          toolName: ctx.toolName,
          permission,
        },
        { consume: true },
      );
    } catch (err) {
      recordAgentActionAudit({
        tenantId: tenantCtx.orgId,
        actorId: ctx.userId,
        authKind: String(ctx.authKind || ""),
        toolName: ctx.toolName,
        permission,
        outcome: "DENIED",
        denialReason: err instanceof Error ? err.message : "Capability denied.",
        argsPreview: ctx.toolArgs ? JSON.stringify(ctx.toolArgs).slice(0, 200) : null,
      });
      throw new CapabilityDeniedError(
        err instanceof Error ? err.message : "Capability token validation failed.",
      );
    }
  }

  recordAgentActionAudit({
    tenantId: tenantCtx.orgId,
    actorId: ctx.userId,
    authKind: String(ctx.authKind || ""),
    toolName: ctx.toolName,
    permission,
    capabilityJti: issued.payload.jti,
    resourceId:
      ctx.toolName === "transition_execution"
        ? String(ctx.toolArgs?.task_id ?? ctx.toolArgs?.taskId ?? "")
        : null,
    outcome: "ALLOWED",
    argsPreview: ctx.toolArgs ? JSON.stringify(ctx.toolArgs).slice(0, 200) : null,
  });

  recordSecurityEventV8({
    actorId: ctx.userId,
    action: `tool.${ctx.toolName}`,
    resourceType: "tool",
    resourceId: ctx.toolName,
    tenantId: tenantCtx.orgId,
    workspaceId: tenantCtx.workspaceId,
    result: "ALLOWED",
    riskLevel: HIGH_RISK_TOOLS.has(ctx.toolName) ? "HIGH" : "LOW",
    metadata: { role: roleForUser(ctx.userId, ctx.authKind) },
  });

  return {
    permission,
    capabilityJti: issued.payload.jti,
    tenantId: tenantCtx.orgId,
    workspaceId: tenantCtx.workspaceId,
  };
}
