import type { AuthKind } from "../middleware/auth.js";
import {
  AuthorizationError,
  CapabilityDeniedError,
  TenantIsolationError,
} from "./authorization-errors.js";
import { secureAuthorizeToolExecution } from "./agent-tool-gate.js";
import { resolveTenantContext } from "./tenant-context.js";
import { runContentTrustPipeline } from "./content-trust-pipeline.js";
import { validateLlmInput } from "./llm-output-firewall.js";
import { recordSecurityEventV8 } from "./security-observability.js";
import { assertLedgerTenantAccess } from "./tenant-scope.js";
import { validateApprovalForAction } from "./approval-gate.js";
import type { Permission } from "./authorization.js";

export interface SecurityPrincipal {
  userId: string;
  authKind?: AuthKind | string;
}

export interface ExecuteToolRequest extends SecurityPrincipal {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  approvalId?: string;
  capabilityToken?: string;
  emergencyOverride?: boolean;
  emergencyReason?: string;
}

export interface ExecuteToolHandler {
  (input: Record<string, unknown>): Promise<string> | string;
}

/**
 * UnifiedSecurityBoundary — every tool execution must pass through this gateway.
 * Enforces RBAC, tenant context, approval, capability, audit, and provenance hooks.
 */
export async function executeSecuredTool(
  req: ExecuteToolRequest,
  handler: ExecuteToolHandler,
): Promise<string> {
  const auth = secureAuthorizeToolExecution({
    userId: req.userId,
    authKind: req.authKind,
    toolName: req.toolName,
    toolArgs: req.toolArgs,
    capabilityToken: req.capabilityToken,
    approvalId: req.approvalId,
    emergencyOverride: req.emergencyOverride,
    emergencyReason: req.emergencyReason,
  });

  const result = await handler({
    ...(req.toolArgs ?? {}),
    userId: req.userId,
    orgId: auth.tenantId,
    workspaceId: auth.workspaceId,
    approvalId: req.approvalId,
  });

  return String(result);
}

/** Scan untrusted user chat before LLM reasoning. */
export function gateUserChatInput(params: {
  userId: string;
  content: string;
  sourceLabel?: string;
}): { allowed: boolean; message?: string; isolatedContent: string } {
  const tenant = resolveTenantContext(params.userId);
  const firewall = validateLlmInput(params.content);
  if (!firewall.allowed) {
    recordSecurityEventV8({
      actorId: params.userId,
      action: "llm.input_blocked",
      resourceType: "chat",
      resourceId: params.sourceLabel ?? "user_chat",
      tenantId: tenant.orgId,
      workspaceId: tenant.workspaceId,
      result: "BLOCKED",
      riskLevel: "HIGH",
      metadata: { reasons: firewall.blockedReasons },
    });
    return {
      allowed: false,
      message: `Input blocked: ${firewall.blockedReasons.join(", ")}`,
      isolatedContent: "",
    };
  }

  const trust = runContentTrustPipeline({
    content: params.content,
    sourceLabel: params.sourceLabel ?? "user_chat",
    tenantId: tenant.orgId,
    actorId: params.userId,
    workspaceId: tenant.workspaceId,
  });

  if (!trust.allowLlmReasoning) {
    recordSecurityEventV8({
      actorId: params.userId,
      action: "content.injection.blocked",
      resourceType: "chat",
      tenantId: tenant.orgId,
      workspaceId: tenant.workspaceId,
      result: "BLOCKED",
      riskLevel: "CRITICAL",
      metadata: { classification: trust.classification },
    });
    return {
      allowed: false,
      message: `Chat input blocked (${trust.classification}).`,
      isolatedContent: "",
    };
  }

  return { allowed: true, isolatedContent: trust.isolatedContent };
}

export interface MutationAuthorizationRequest extends SecurityPrincipal {
  permission: Permission;
  actionType: string;
  resourceTenantId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  approvalId?: string;
  emergencyOverride?: boolean;
  emergencyReason?: string;
}

/** Authorize REST/WS mutations through the same policy layer as tools. */
export function authorizeSecuredMutation(req: MutationAuthorizationRequest): {
  tenantId: string;
  workspaceId: string;
} {
  const auth = secureAuthorizeToolExecution({
    userId: req.userId,
    authKind: req.authKind,
    toolName: req.toolName ?? req.actionType,
    toolArgs: req.toolArgs,
    approvalId: req.approvalId,
    emergencyOverride: req.emergencyOverride,
    emergencyReason: req.emergencyReason,
  });
  if (req.resourceTenantId) {
    const tenant = resolveTenantContext(req.userId);
    assertLedgerTenantAccess(tenant, req.resourceTenantId);
  }
  return { tenantId: auth.tenantId, workspaceId: auth.workspaceId };
}

export interface ExecuteMutationRequest extends MutationAuthorizationRequest {
  capabilityToken?: string;
}

/**
 * Unified mutation boundary — RBAC, tenant, dual-control, capability JTI, audit.
 * All REST, WebSocket, and agent mutations should pass through this helper.
 */
export async function authorizeAndExecuteMutation<T>(
  req: ExecuteMutationRequest,
  handler: (ctx: { tenantId: string; workspaceId: string; capabilityJti: string }) => Promise<T> | T,
): Promise<T> {
  const toolName = req.toolName ?? req.actionType;
  const auth = secureAuthorizeToolExecution({
    userId: req.userId,
    authKind: req.authKind,
    toolName,
    toolArgs: req.toolArgs,
    capabilityToken: req.capabilityToken,
    approvalId: req.approvalId,
    emergencyOverride: req.emergencyOverride,
    emergencyReason: req.emergencyReason,
  });
  if (req.resourceTenantId) {
    const tenant = resolveTenantContext(req.userId);
    assertLedgerTenantAccess(tenant, req.resourceTenantId);
  }
  return handler({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    capabilityJti: auth.capabilityJti,
  });
}

export function formatSecurityError(err: unknown): string {
  if (
    err instanceof AuthorizationError ||
    err instanceof CapabilityDeniedError ||
    err instanceof TenantIsolationError
  ) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Re-export for approval validation in REST handlers. */
export { validateApprovalForAction };
