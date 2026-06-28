import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { roleForUser, userHasPermission, type HustronixRole } from "./authorization.js";
import { recordSecurityEventV8 } from "./security-observability.js";

export const HIGH_RISK_ACTIONS = new Set([
  "log_strategic_decision",
  "remember_fact",
  "transition_execution",
  "commit_decision",
  "bulk_update",
]);

const APPROVAL_TTL_MS = 10 * 60 * 1000;

function argsHash(toolName: string, args: Record<string, unknown>): string {
  const sanitized = { ...args };
  delete sanitized.emergency_override;
  delete sanitized.emergencyOverride;
  delete sanitized.emergency_reason;
  delete sanitized.emergencyReason;
  delete sanitized.approval_id;
  delete sanitized.approvalId;
  return crypto
    .createHash("sha256")
    .update(`${toolName}:${JSON.stringify(sanitized)}`)
    .digest("hex");
}

/** V9: all high-risk actions require independent approval — no role bypass. */
export function requiresHumanApproval(_role: HustronixRole, toolName: string): boolean {
  return HIGH_RISK_ACTIONS.has(toolName);
}

export function createPendingApproval(params: {
  tenantId: string;
  workspaceId?: string | null;
  actorId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  permission: string;
}): string {
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  db.rawRun(
    `INSERT INTO pending_action_approvals (
      id, tenant_id, workspace_id, actor_id, tool_name, args_hash, permission, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.workspaceId ?? null,
      params.actorId,
      params.toolName,
      argsHash(params.toolName, params.toolArgs),
      params.permission,
      expiresAt,
    ],
  );
  recordSecurityEventV8({
    actorId: params.actorId,
    action: "approval.pending_created",
    resourceType: "approval",
    resourceId: id,
    tenantId: params.tenantId,
    workspaceId: params.workspaceId ?? null,
    result: "ALLOWED",
    riskLevel: "MEDIUM",
    metadata: { tool: params.toolName },
  });
  return id;
}

export function recordEmergencyOverride(params: {
  tenantId: string;
  actorId: string;
  actionType: string;
  resourceId?: string;
  reason: string;
}): string {
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO emergency_overrides (id, tenant_id, actor_id, action_type, resource_id, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, params.tenantId, params.actorId, params.actionType, params.resourceId ?? null, params.reason],
  );
  recordSecurityEventV8({
    actorId: params.actorId,
    action: "emergency.override",
    resourceType: "override",
    resourceId: id,
    tenantId: params.tenantId,
    result: "ALLOWED",
    riskLevel: "CRITICAL",
    metadata: { actionType: params.actionType, reason: params.reason },
  });
  return id;
}

export function approvePendingAction(
  approvalId: string,
  approverId: string,
  tenantId: string,
): boolean {
  const row = db
    .rawGet(`SELECT * FROM pending_action_approvals WHERE id = ?`, [approvalId])
    .at(0) as {
      status: string;
      expires_at: string;
      actor_id: string;
      tenant_id: string;
      approved_by: string | null;
      second_approved_by: string | null;
    } | undefined;
  if (!row || row.status === "REJECTED" || row.status === "EXPIRED") return false;
  if (row.tenant_id !== tenantId) {
    recordSecurityEventV8({
      actorId: approverId,
      action: "approval.cross_tenant_denied",
      resourceType: "approval",
      resourceId: approvalId,
      tenantId,
      result: "DENIED",
      riskLevel: "CRITICAL",
      metadata: { attempted_tenant: row.tenant_id },
    });
    return false;
  }
  if (new Date(row.expires_at) < new Date()) {
    db.rawRun(`UPDATE pending_action_approvals SET status = 'EXPIRED' WHERE id = ?`, [approvalId]);
    return false;
  }
  if (row.actor_id === approverId) {
    recordSecurityEventV8({
      actorId: approverId,
      action: "approval.self_approve_denied",
      resourceType: "approval",
      resourceId: approvalId,
      tenantId,
      result: "DENIED",
      riskLevel: "HIGH",
    });
    return false;
  }
  if (!userHasPermission(approverId, "session", "security:manage")) {
    const approverRole = roleForUser(approverId);
    if (approverRole !== "owner" && approverRole !== "admin") return false;
  }

  if (!row.approved_by) {
    db.rawRun(
      `UPDATE pending_action_approvals SET approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [approverId, approvalId],
    );
    recordSecurityEventV8({
      actorId: approverId,
      action: "approval.first_granted",
      resourceType: "approval",
      resourceId: approvalId,
      tenantId,
      result: "ALLOWED",
      riskLevel: "MEDIUM",
      metadata: { requester: row.actor_id },
    });
    return true;
  }

  if (row.second_approved_by) return row.status === "APPROVED";

  db.rawRun(
    `UPDATE pending_action_approvals
     SET second_approved_by = ?, second_approved_at = CURRENT_TIMESTAMP, status = 'APPROVED'
     WHERE id = ?`,
    [approverId, approvalId],
  );
  recordSecurityEventV8({
    actorId: approverId,
    action: "approval.dual_control_complete",
    resourceType: "approval",
    resourceId: approvalId,
    tenantId,
    result: "ALLOWED",
    riskLevel: "LOW",
    metadata: { requester: row.actor_id, firstApprover: row.approved_by },
  });
  return true;
}

export function validateApprovalForAction(params: {
  approvalId: string | undefined;
  actorId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  tenantId?: string;
}): boolean {
  if (!params.approvalId) return false;
  const hash = argsHash(params.toolName, params.toolArgs);
  const row = db
    .rawGet(
      `SELECT status, expires_at, actor_id, args_hash, tool_name, tenant_id,
              approved_by, second_approved_by, emergency_override_id
       FROM pending_action_approvals WHERE id = ?`,
      [params.approvalId],
    )
    .at(0) as {
      status: string;
      expires_at: string;
      actor_id: string;
      args_hash: string;
      tool_name: string;
      tenant_id: string;
      approved_by: string | null;
      second_approved_by: string | null;
      emergency_override_id: string | null;
    } | undefined;
  if (!row) return false;
  if (params.tenantId && row.tenant_id !== params.tenantId) return false;
  if (row.status !== "APPROVED") return false;
  if (new Date(row.expires_at) < new Date()) return false;
  if (row.actor_id !== params.actorId) return false;
  if (row.tool_name !== params.toolName) return false;
  if (row.args_hash !== hash) return false;
  if (!row.approved_by || row.approved_by === params.actorId) return false;
  if (!row.second_approved_by && !row.emergency_override_id) return false;
  if (row.second_approved_by && row.second_approved_by === params.actorId) return false;
  return true;
}

export function enforceHighRiskApproval(params: {
  userId: string;
  tenantId: string;
  workspaceId?: string | null;
  toolName: string;
  toolArgs: Record<string, unknown>;
  permission: string;
  approvalId?: string;
  emergencyOverride?: boolean;
  emergencyReason?: string;
}): void {
  if (!requiresHumanApproval(roleForUser(params.userId), params.toolName)) return;

  const approvalId = (params.toolArgs.approval_id ??
    params.toolArgs.approvalId ??
    params.approvalId) as string | undefined;

  const emergency =
    params.emergencyOverride === true ||
    params.toolArgs.emergency_override === true ||
    params.toolArgs.emergencyOverride === true;
  const emergencyReason = String(
    params.emergencyReason ?? params.toolArgs.emergency_reason ?? params.toolArgs.emergencyReason ?? "",
  ).trim();

  if (emergency) {
    const role = roleForUser(params.userId);
    if (role !== "owner") {
      throw new Error("Emergency override is restricted to organization owners.");
    }
    if (!emergencyReason || emergencyReason.length < 12) {
      throw new Error("Emergency override requires a detailed reason (12+ characters).");
    }
    const overrideId = recordEmergencyOverride({
      tenantId: params.tenantId,
      actorId: params.userId,
      actionType: params.toolName,
      reason: emergencyReason,
    });
    if (approvalId) {
      db.rawRun(`UPDATE pending_action_approvals SET emergency_override_id = ? WHERE id = ?`, [
        overrideId,
        approvalId,
      ]);
    }
    if (
      validateApprovalForAction({
        approvalId,
        actorId: params.userId,
        toolName: params.toolName,
        toolArgs: params.toolArgs,
        tenantId: params.tenantId,
      })
    ) {
      return;
    }
    if (!approvalId) {
      throw new Error(
        `Emergency override for "${params.toolName}" still requires one independent approval. Pending approval must be created first.`,
      );
    }
    const row = db
      .rawGet(`SELECT approved_by, status FROM pending_action_approvals WHERE id = ?`, [approvalId])
      .at(0) as { approved_by: string | null; status: string } | undefined;
    if (!row?.approved_by || row.approved_by === params.userId) {
      throw new Error("Emergency override requires one approval from a different principal.");
    }
    db.rawRun(
      `UPDATE pending_action_approvals SET status = 'APPROVED', emergency_override_id = ? WHERE id = ?`,
      [overrideId, approvalId],
    );
    return;
  }

  if (
    validateApprovalForAction({
      approvalId,
      actorId: params.userId,
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      tenantId: params.tenantId,
    })
  ) {
    return;
  }

  const pendingId = createPendingApproval({
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    actorId: params.userId,
    toolName: params.toolName,
    toolArgs: params.toolArgs,
    permission: params.permission,
  });
  recordSecurityEventV8({
    actorId: params.userId,
    action: "high_risk.approval_required",
    resourceType: "approval",
    resourceId: pendingId,
    tenantId: params.tenantId,
    result: "DENIED",
    riskLevel: "HIGH",
    metadata: { dualControl: true },
  });
  throw new Error(
    `High-risk action "${params.toolName}" requires dual-control approval. Pending approval id: ${pendingId}`,
  );
}

export function listPendingApprovals(tenantId: string, viewerId: string) {
  return db
    .rawGet(
      `SELECT id, tenant_id, workspace_id, actor_id, tool_name, permission, status,
              approved_by, second_approved_by, expires_at, created_at
       FROM pending_action_approvals
       WHERE tenant_id = ? AND status IN ('PENDING', 'APPROVED')
         AND expires_at > datetime('now')
       ORDER BY created_at DESC
       LIMIT 100`,
      [tenantId],
    )
    .map((row: Record<string, unknown>) => ({
      ...row,
      canApprove:
        row.actor_id !== viewerId &&
        (!row.approved_by || (row.approved_by !== viewerId && !row.second_approved_by)),
    }));
}

export function getApprovalById(approvalId: string, tenantId: string) {
  const row = db
    .rawGet(`SELECT * FROM pending_action_approvals WHERE id = ?`, [approvalId])
    .at(0) as Record<string, unknown> | undefined;
  if (!row || row.tenant_id !== tenantId) return null;
  return row;
}
