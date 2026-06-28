import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import type { Permission } from "./authorization.js";

export function recordAgentActionAudit(params: {
  tenantId: string;
  actorId: string;
  authKind?: string;
  toolName: string;
  permission?: Permission | null;
  capabilityJti?: string | null;
  resourceId?: string | null;
  outcome: "ALLOWED" | "DENIED" | "ERROR";
  denialReason?: string | null;
  argsPreview?: string | null;
}): void {
  db.rawRun(
    `INSERT INTO agent_action_audit (
      id, tenant_id, actor_id, auth_kind, tool_name, permission,
      capability_jti, resource_id, outcome, denial_reason, args_preview
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      params.tenantId,
      params.actorId,
      params.authKind ?? null,
      params.toolName,
      params.permission ?? null,
      params.capabilityJti ?? null,
      params.resourceId ?? null,
      params.outcome,
      params.denialReason ?? null,
      params.argsPreview ? params.argsPreview.slice(0, 500) : null,
    ],
  );
}

export function countDeniedAgentActions(tenantId: string, sinceHours = 24): number {
  const row = db
    .rawGet(
      `SELECT COUNT(*) AS c FROM agent_action_audit
       WHERE tenant_id = ? AND outcome = 'DENIED'
       AND created_at >= datetime('now', ?)`,
      [tenantId, `-${sinceHours} hours`],
    )
    .at(0) as { c: number } | undefined;
  return row?.c ?? 0;
}
