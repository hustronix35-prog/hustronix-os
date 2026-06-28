import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { memoryTenantInClause, memoryTenantParams } from "../security/tenant-scope.js";
import type { TenantContext } from "../security/tenant-context.js";

export type DoctrinePriority = "constitutional" | "guidance";
export type DoctrineStatus = "ACTIVE" | "SUPERSEDED";

export interface DoctrineRule {
  id: string;
  tenant_id: string;
  statement: string;
  priority: DoctrinePriority;
  status: DoctrineStatus;
  entity_scope: string;
  created_at: string;
  updated_at: string;
}

export function listDoctrineRules(ctx: TenantContext, status: DoctrineStatus = "ACTIVE"): DoctrineRule[] {
  const [orgId, userId] = memoryTenantParams(ctx);
  return db.rawGet(
    `SELECT * FROM doctrine_rules
     WHERE ${memoryTenantInClause()} AND status = ?
     ORDER BY CASE priority WHEN 'constitutional' THEN 0 ELSE 1 END, created_at ASC`,
    [orgId, userId, status],
  ) as DoctrineRule[];
}

export function getDoctrineRule(tenantId: string, ruleId: string): DoctrineRule | null {
  const row = db
    .rawGet(`SELECT * FROM doctrine_rules WHERE id = ? AND tenant_id = ?`, [ruleId, tenantId])
    .at(0) as DoctrineRule | undefined;
  return row ?? null;
}

export function createDoctrineRule(params: {
  tenantId: string;
  statement: string;
  priority?: DoctrinePriority;
  entityScope?: string;
}): DoctrineRule {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO doctrine_rules (id, tenant_id, statement, priority, status, entity_scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.statement.slice(0, 2000),
      params.priority ?? "guidance",
      params.entityScope ?? "org-wide",
      now,
      now,
    ],
  );
  const row = getDoctrineRule(params.tenantId, id);
  if (!row) throw new Error("Failed to create doctrine rule.");
  return row;
}

export function updateDoctrineRule(
  tenantId: string,
  ruleId: string,
  patch: Partial<Pick<DoctrineRule, "statement" | "priority" | "status" | "entity_scope">>,
): DoctrineRule | null {
  const existing = getDoctrineRule(tenantId, ruleId);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.rawRun(
    `UPDATE doctrine_rules SET
      statement = COALESCE(?, statement),
      priority = COALESCE(?, priority),
      status = COALESCE(?, status),
      entity_scope = COALESCE(?, entity_scope),
      updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [
      patch.statement ?? null,
      patch.priority ?? null,
      patch.status ?? null,
      patch.entity_scope ?? null,
      now,
      ruleId,
      tenantId,
    ],
  );
  return getDoctrineRule(tenantId, ruleId);
}

export function supersedeDoctrineRule(tenantId: string, ruleId: string): DoctrineRule | null {
  return updateDoctrineRule(tenantId, ruleId, { status: "SUPERSEDED" });
}
