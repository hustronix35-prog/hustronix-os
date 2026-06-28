import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";

export type SecurityRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SecurityEventResult = "ALLOWED" | "DENIED" | "BLOCKED" | "ERROR";

export interface SecurityEventInput {
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  tenantId?: string | null;
  workspaceId?: string | null;
  result: SecurityEventResult;
  riskLevel: SecurityRiskLevel;
  metadata?: Record<string, unknown>;
}

export function recordSecurityEventV8(input: SecurityEventInput): string {
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO security_events_v8 (
      id, actor_id, action, resource_type, resource_id, tenant_id, workspace_id,
      result, risk_level, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.actorId ?? null,
      input.action,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.tenantId ?? null,
      input.workspaceId ?? null,
      input.result,
      input.riskLevel,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  return id;
}

export interface SecurityDashboardSummary {
  last24h: {
    total: number;
    critical: number;
    high: number;
    denied: number;
    injectionAttempts: number;
    crossTenantAttempts: number;
    privilegeEscalation: number;
    memoryPoisoning: number;
  };
  recent: Array<{
    id: string;
    action: string;
    result: string;
    risk_level: string;
    created_at: string;
  }>;
}

export function getSecurityDashboard(tenantId: string): SecurityDashboardSummary {
  const counts = db
    .rawGet(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN risk_level = 'CRITICAL' THEN 1 ELSE 0 END) AS critical,
         SUM(CASE WHEN risk_level = 'HIGH' THEN 1 ELSE 0 END) AS high,
         SUM(CASE WHEN result = 'DENIED' OR result = 'BLOCKED' THEN 1 ELSE 0 END) AS denied,
         SUM(CASE WHEN action LIKE '%injection%' THEN 1 ELSE 0 END) AS injection_attempts,
         SUM(CASE WHEN action = 'tenant.isolation_violation' THEN 1 ELSE 0 END) AS cross_tenant,
         SUM(CASE WHEN action LIKE '%privilege%' OR action LIKE '%escalation%' THEN 1 ELSE 0 END) AS privilege,
         SUM(CASE WHEN action LIKE '%memory.poison%' OR action LIKE '%memory.conflict%' THEN 1 ELSE 0 END) AS memory_poison
       FROM security_events_v8
       WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')`,
      [tenantId],
    )
    .at(0) as Record<string, number> | undefined;

  const recent = db.rawGet(
    `SELECT id, action, result, risk_level, created_at FROM security_events_v8
     WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 25`,
    [tenantId],
  ) as SecurityDashboardSummary["recent"];

  return {
    last24h: {
      total: counts?.total ?? 0,
      critical: counts?.critical ?? 0,
      high: counts?.high ?? 0,
      denied: counts?.denied ?? 0,
      injectionAttempts: counts?.injection_attempts ?? 0,
      crossTenantAttempts: counts?.cross_tenant ?? 0,
      privilegeEscalation: counts?.privilege ?? 0,
      memoryPoisoning: counts?.memory_poison ?? 0,
    },
    recent,
  };
}
