/**
 * Execution orchestrator — runs AFTER a decision is ACTIVE.
 * Produces action intents, evaluates policy, dispatches ALLOW via the mutation gateway.
 * Does not change what Approve means.
 */
import { v4 as uuidv4 } from "uuid";
import type { AuthKind } from "../../middleware/auth.js";
import { db } from "../../database.js";
import { resolveTenantContext, tenantSqlScope } from "../../security/tenant-context.js";
import { buildExecutionPlan } from "../execution-plan.js";
import { buildTeamEntries } from "../../teams/teamsMembers.js";
import { generateIntents, type UnlinkedWork } from "./intents.js";
import { evaluateActionPolicy, initialStatusForPolicy } from "./policy.js";
import { dispatchAction, type DispatchAuth } from "./dispatch.js";
import { findActionByIdempotency, getActionById, insertAction, listActionsForDecision, shouldSkipExisting, updateAction } from "./store.js";
import type { ActionLedgerRow, OrchestrationSummary } from "./types.js";

function loadUnlinkedWork(userId: string, decisionId: string): UnlinkedWork[] {
  const ctx = resolveTenantContext(userId);
  const scope = tenantSqlScope(ctx);
  const rows = db.rawGet(
    `SELECT id, source, external_id, content, owner, linked_execution_id
     FROM external_signals
     WHERE 1=1${scope.sql}
       AND UPPER(source) IN ('JIRA','LINEAR','GITHUB')
       AND (related_decision_id = ? OR linked_execution_id IS NULL)
     ORDER BY detected_at DESC
     LIMIT 80`,
    [...scope.params, decisionId],
  ) as Array<{
    id: string;
    source: string;
    external_id: string | null;
    content: string | null;
    owner: string | null;
    linked_execution_id: string | null;
  }>;
  return rows
    .filter((r) => !r.linked_execution_id)
    .map((r) => ({
      signalId: r.id,
      source: r.source,
      externalId: r.external_id,
      content: String(r.content || ""),
      owner: r.owner,
    }));
}

export function getOrchestration(userId: string, decisionId: string): OrchestrationSummary | null {
  const plan = buildExecutionPlan(userId, decisionId);
  if (!plan) return null;
  const actions = listActionsForDecision(decisionId);
  const latestRun = actions.at(-1)?.runId ?? null;
  const people = [...new Set(plan.actions.map((a) => a.owner).filter((o) => o && o !== "system"))];
  return {
    decisionId: plan.decisionId,
    vow: plan.vow,
    status: plan.status,
    readinessPct: plan.readinessPct,
    recommendedNext: plan.recommendedNext,
    runId: latestRun,
    counts: {
      actions: actions.length,
      existing: actions.filter((a) => a.actionType === "LINK_EXISTING_WORK").length,
      missing: actions.filter((a) => a.actionType === "CREATE_JIRA").length,
      meetings: actions.filter((a) => a.actionType === "CREATE_MEETING").length,
      clarifications: actions.filter((a) => a.actionType === "ASK_CLARIFICATION").length,
      people: people.length,
      awaitingApproval: actions.filter((a) => a.status === "AWAITING_APPROVAL").length,
      completed: actions.filter((a) => a.status === "COMPLETED").length,
      blockedConnector: actions.filter((a) => a.status === "BLOCKED_CONNECTOR").length,
    },
    people,
    actions,
  };
}

export async function runOrchestration(
  userId: string,
  decisionId: string,
  authKind?: AuthKind | string,
): Promise<OrchestrationSummary | null> {
  const plan = buildExecutionPlan(userId, decisionId);
  if (!plan) return null;
  if (plan.status !== "ACTIVE" && plan.status !== "UNDER_REVIEW") {
    return getOrchestration(userId, decisionId);
  }
  const ctx = resolveTenantContext(userId);
  const runId = uuidv4();
  const people = buildTeamEntries(userId).map((e) => ({
    name: e.name,
    loadPct: e.loadPct,
    status: e.status,
    team: e.team,
  }));
  let unlinkedWork: UnlinkedWork[] = [];
  try {
    unlinkedWork = loadUnlinkedWork(userId, decisionId);
  } catch (err) {
    console.warn("[orchestrator] unlinked work query failed:", err);
  }
  const intents = generateIntents({ plan, unlinkedWork, people });
  const auth: DispatchAuth = { userId, authKind };

  for (const intent of intents) {
    const existing = findActionByIdempotency(ctx.orgId, intent.idempotencyKey);
    if (existing && shouldSkipExisting(existing)) continue;
    const policy = evaluateActionPolicy(intent.actionType);
    const status = policy.verdict === "DENY" ? "DENIED" : initialStatusForPolicy(policy.verdict);
    let row;
    try {
      row = insertAction({
        orgId: ctx.orgId,
        runId,
        intent,
        policyResult: policy.verdict,
        status,
        authorization: policy.note,
      });
    } catch {
      continue;
    }
    if (row.status === "AUTHORIZED") {
      await dispatchAction(auth, row.id);
    }
  }

  return getOrchestration(userId, decisionId);
}

export function scheduleOrchestration(
  userId: string,
  decisionId: string,
  authKind?: AuthKind | string,
): void {
  setImmediate(() => {
    runOrchestration(userId, decisionId, authKind).catch((err) => {
      console.error("[orchestrator] run failed:", err);
    });
  });
}

export async function authorizeOrchestrationAction(
  auth: DispatchAuth,
  actionId: string,
): Promise<ActionLedgerRow | null> {
  const row = getActionById(actionId);
  if (!row) return null;
  if (row.status !== "AWAITING_APPROVAL") return row;
  updateAction(actionId, { status: "AUTHORIZED", authorization: `approved_by:${auth.userId}` });
  return dispatchAction(auth, actionId);
}

export { evaluateActionPolicy } from "./policy.js";
export { generateIntents } from "./intents.js";
export type { OrchestrationSummary, ActionLedgerRow } from "./types.js";
