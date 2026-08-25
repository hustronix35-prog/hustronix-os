import { v4 as uuidv4 } from "uuid";
import { db } from "../../database.js";
import type { ActionLedgerRow, ActionStatus, ActionType, ExecutionIntent, PolicyVerdict } from "./types.js";

function parseIntent(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowFromDb(r: Record<string, unknown>): ActionLedgerRow {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    decisionId: String(r.decision_id),
    executionId: r.execution_id ? String(r.execution_id) : null,
    runId: String(r.run_id),
    actionType: String(r.action_type) as ActionType,
    targetSystem: String(r.target_system),
    idempotencyKey: String(r.idempotency_key),
    intent: parseIntent(String(r.intent_json || "{}")),
    reason: String(r.reason || ""),
    owner: r.owner ? String(r.owner) : null,
    risk: String(r.risk),
    policyResult: String(r.policy_result) as PolicyVerdict,
    status: String(r.status) as ActionStatus,
    authorization: r.authorization ? String(r.authorization) : null,
    externalId: r.external_id ? String(r.external_id) : null,
    error: r.error ? String(r.error) : null,
    requestedAt: String(r.requested_at || ""),
    completedAt: r.completed_at ? String(r.completed_at) : null,
  };
}

export function findActionByIdempotency(orgId: string, key: string): ActionLedgerRow | null {
  const r = db
    .rawGet(`SELECT * FROM action_ledger WHERE org_id = ? AND idempotency_key = ? LIMIT 1`, [orgId, key])
    .at(0) as Record<string, unknown> | undefined;
  return r ? rowFromDb(r) : null;
}

export function getActionById(id: string): ActionLedgerRow | null {
  const r = db.rawGet(`SELECT * FROM action_ledger WHERE id = ? LIMIT 1`, [id]).at(0) as
    | Record<string, unknown>
    | undefined;
  return r ? rowFromDb(r) : null;
}

export function listActionsForDecision(decisionId: string): ActionLedgerRow[] {
  const rows = db.rawGet(
    `SELECT * FROM action_ledger WHERE decision_id = ? ORDER BY requested_at ASC`,
    [decisionId],
  ) as Record<string, unknown>[];
  return rows.map(rowFromDb);
}

export function insertAction(params: {
  orgId: string;
  runId: string;
  intent: ExecutionIntent;
  policyResult: PolicyVerdict;
  status: ActionStatus;
  authorization?: string;
}): ActionLedgerRow {
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO action_ledger (
      id, org_id, decision_id, execution_id, run_id, action_type, target_system,
      idempotency_key, intent_json, reason, owner, risk, policy_result, status, authorization
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.orgId,
      params.intent.decisionId,
      params.intent.executionId ?? null,
      params.runId,
      params.intent.actionType,
      params.intent.targetSystem,
      params.intent.idempotencyKey,
      JSON.stringify({ ...params.intent.payload, actionType: params.intent.actionType }),
      params.intent.reason,
      params.intent.owner ?? null,
      params.intent.risk,
      params.policyResult,
      params.status,
      params.authorization ?? null,
    ],
  );
  return getActionById(id)!;
}

export function updateAction(
  id: string,
  patch: {
    status?: ActionStatus;
    authorization?: string;
    externalId?: string | null;
    error?: string | null;
    completed?: boolean;
  },
): void {
  const row = getActionById(id);
  if (!row) return;
  db.rawRun(
    `UPDATE action_ledger
     SET status = ?, authorization = ?, external_id = ?, error = ?, completed_at = ?
     WHERE id = ?`,
    [
      patch.status ?? row.status,
      patch.authorization ?? row.authorization,
      patch.externalId === undefined ? row.externalId : patch.externalId,
      patch.error === undefined ? row.error : patch.error,
      patch.completed || patch.status === "COMPLETED" || patch.status === "DENIED" || patch.status === "FAILED" || patch.status === "BLOCKED_CONNECTOR"
        ? new Date().toISOString()
        : row.completedAt,
      id,
    ],
  );
}

export const TERMINAL: ReadonlySet<ActionStatus> = new Set([
  "COMPLETED",
  "DENIED",
  "SKIPPED",
]);

export function shouldSkipExisting(row: ActionLedgerRow): boolean {
  return TERMINAL.has(row.status) || row.status === "AWAITING_APPROVAL" || row.status === "BLOCKED_CONNECTOR";
}
