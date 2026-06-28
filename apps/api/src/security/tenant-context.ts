import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { roleForUser, type HustronixRole } from "./authorization.js";
import { TenantIsolationError } from "./authorization-errors.js";
import { recordSecurityEventV8 } from "./security-observability.js";

export interface TenantContext {
  userId: string;
  orgId: string;
  workspaceId: string;
  role: HustronixRole;
}

/** Ensure user has org + default workspace; back-compat maps orgId=userId for solo tenants. */
export function resolveTenantContext(userId: string): TenantContext {
  if (!userId || userId === "system") {
    return { userId: "system", orgId: "system", workspaceId: "system", role: "agent" };
  }

  const membership = db
    .rawGet(
      `SELECT wm.org_id, wm.workspace_id, wm.role
       FROM workspace_members wm WHERE wm.user_id = ? ORDER BY wm.created_at ASC LIMIT 1`,
      [userId],
    )
    .at(0) as { org_id: string; workspace_id: string; role: string } | undefined;

  if (membership) {
    const role = (membership.role as HustronixRole) || roleForUser(userId);
    return {
      userId,
      orgId: membership.org_id,
      workspaceId: membership.workspace_id,
      role,
    };
  }

  const existingOrg = db
    .rawGet(`SELECT id FROM organizations WHERE owner_user_id = ? LIMIT 1`, [userId])
    .at(0) as { id: string } | undefined;

  if (existingOrg) {
    const ws = db
      .rawGet(`SELECT id FROM workspaces WHERE org_id = ? ORDER BY created_at ASC LIMIT 1`, [
        existingOrg.id,
      ])
      .at(0) as { id: string } | undefined;
    if (ws) {
      return { userId, orgId: existingOrg.id, workspaceId: ws.id, role: roleForUser(userId) };
    }
  }

  return provisionDefaultOrganization(userId);
}

export function provisionDefaultOrganization(userId: string): TenantContext {
  const orgId = `org_${userId}`;
  const workspaceId = `ws_${userId}_default`;
  const slug = `org-${userId.slice(0, 12)}`;
  const role = roleForUser(userId);

  db.rawRun(
    `INSERT OR IGNORE INTO organizations (id, slug, name, owner_user_id) VALUES (?, ?, ?, ?)`,
    [orgId, slug, "Default Organization", userId],
  );
  db.rawRun(
    `INSERT OR IGNORE INTO workspaces (id, org_id, slug, name) VALUES (?, ?, 'default', 'Default Workspace')`,
    [workspaceId, orgId],
  );
  db.rawRun(
    `INSERT OR IGNORE INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)`,
    [orgId, workspaceId, userId, role === "agent" ? "viewer" : role],
  );

  return { userId, orgId, workspaceId, role };
}

export function assertResourceTenantAccess(
  ctx: TenantContext,
  resourceTenantId: string,
  resourceWorkspaceId?: string | null,
): void {
  if (ctx.userId === "system") return;
  if (resourceTenantId !== ctx.orgId && resourceTenantId !== ctx.userId) {
    recordSecurityEventV8({
      actorId: ctx.userId,
      action: "tenant.isolation_violation",
      resourceType: "tenant",
      resourceId: resourceTenantId,
      tenantId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      result: "DENIED",
      riskLevel: "CRITICAL",
      metadata: { attempted_tenant: resourceTenantId },
    });
    throw new TenantIsolationError("Cross-tenant access denied.");
  }
  if (resourceWorkspaceId && resourceWorkspaceId !== ctx.workspaceId) {
    recordSecurityEventV8({
      actorId: ctx.userId,
      action: "workspace.isolation_violation",
      resourceType: "workspace",
      resourceId: resourceWorkspaceId,
      tenantId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      result: "DENIED",
      riskLevel: "HIGH",
    });
    throw new TenantIsolationError("Cross-workspace access denied.");
  }
}

export function tenantSqlScope(ctx: TenantContext): { sql: string; params: unknown[] } {
  return {
    sql: " AND (org_id = ? OR user_id IN (?, ?)) ",
    params: [ctx.orgId, ctx.orgId, ctx.userId],
  };
}
