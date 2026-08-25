import type { AuthKind } from "../../middleware/auth.js";
import { authorizeAndExecuteMutation } from "../../security/security-gateway.js";
import { mutationAssignExecutionOwner, mutationLinkSignal } from "../../security/mutation-handlers.js";
import { openClarificationIfNeeded } from "../../clarification/index.js";
import { notify, defaultAppLink } from "../../notifications/dispatcher.js";
import { db } from "../../database.js";
import type { ActionLedgerRow } from "./types.js";
import { getActionById, updateAction } from "./store.js";

export type DispatchAuth = { userId: string; authKind?: AuthKind | string };

function connectorPresent(userId: string, system: "jira" | "calendar"): boolean {
  try {
    if (system === "jira") {
      if (db.getOAuthConnectionForUser(userId, "jira")) return true;
      const nango = db.rawGet(
        `SELECT id FROM nango_connections WHERE user_id = ? AND lower(provider) LIKE '%jira%' LIMIT 1`,
        [userId],
      ) as { id: string }[];
      return nango.length > 0;
    }
    if (db.getOAuthConnectionForUser(userId, "google") || db.getOAuthConnectionForUser(userId, "microsoft")) {
      return true;
    }
    const nango = db.rawGet(
      `SELECT id FROM nango_connections
       WHERE user_id = ? AND (lower(provider) LIKE '%google-calendar%' OR lower(provider) LIKE '%outlook%' OR lower(provider) LIKE '%microsoft%')
       LIMIT 1`,
      [userId],
    ) as { id: string }[];
    return nango.length > 0;
  } catch {
    return false;
  }
}

async function dispatchLink(auth: DispatchAuth, row: ActionLedgerRow): Promise<void> {
  const signalId = String(row.intent.signalId || "");
  const taskId = String(row.intent.taskId || row.executionId || "");
  await authorizeAndExecuteMutation(
    {
      userId: auth.userId,
      authKind: auth.authKind,
      permission: "execution:write",
      actionType: "link_execution_signal",
      toolName: "link_execution_signal",
      toolArgs: { signalId, taskId },
      resourceTenantId: db.getExecutionTenantForTask(taskId),
    },
    () =>
      mutationLinkSignal(auth.userId, {
        signalId,
        taskId,
        linkMethod: "orchestrator_reconcile",
        linkProvenance: { actor: "orchestrator", actionId: row.id },
      }),
  );
  updateAction(row.id, {
    status: "COMPLETED",
    externalId: String(row.intent.externalId || signalId),
    authorization: "mutation_gateway",
    completed: true,
  });
}

async function dispatchAssign(auth: DispatchAuth, row: ActionLedgerRow): Promise<void> {
  const taskId = String(row.intent.taskId || row.executionId || "");
  const owner = String(row.intent.owner || row.owner || "");
  await authorizeAndExecuteMutation(
    {
      userId: auth.userId,
      authKind: auth.authKind,
      permission: "execution:write",
      actionType: "assign_execution_owner",
      toolName: "assign_execution_owner",
      toolArgs: { taskId, owner },
      resourceTenantId: db.getExecutionTenantForTask(taskId),
    },
    () => mutationAssignExecutionOwner(auth.userId, { taskId, owner }),
  );
  updateAction(row.id, {
    status: "COMPLETED",
    authorization: "mutation_gateway",
    completed: true,
  });
}

export async function dispatchAction(auth: DispatchAuth, actionId: string): Promise<ActionLedgerRow | null> {
  const row = getActionById(actionId);
  if (!row) return null;
  if (row.status === "DENIED" || row.status === "COMPLETED" || row.status === "SKIPPED") return row;
  if (row.status === "AWAITING_APPROVAL") return row;

  try {
    if (row.actionType === "LINK_EXISTING_WORK") {
      await dispatchLink(auth, row);
      return getActionById(actionId);
    }
    if (row.actionType === "ASSIGN_OWNER") {
      await dispatchAssign(auth, row);
      return getActionById(actionId);
    }
    if (row.actionType === "ASK_CLARIFICATION") {
      const taskId = String(row.intent.taskId || row.executionId || "");
      const opened = taskId ? openClarificationIfNeeded(taskId) : null;
      updateAction(row.id, {
        status: "COMPLETED",
        externalId: opened?.row.id ?? null,
        authorization: "clarification_channel",
        completed: true,
        error: opened ? null : "No clarification needed (already answered or no trigger).",
      });
      return getActionById(actionId);
    }
    if (row.actionType === "NOTIFY_OWNER" || row.actionType === "NOTIFY_FOUNDER") {
      if (auth.userId && auth.userId !== "system") {
        await notify(auth.userId, {
          kind: row.actionType === "NOTIFY_FOUNDER" ? "decision.health" : "execution.blocked",
          title: row.actionType === "NOTIFY_FOUNDER" ? "Decision health" : "Action required",
          body: row.reason,
          linkUrl: defaultAppLink(`/execute?decision=${encodeURIComponent(row.decisionId)}`),
          payload: { actionId: row.id, decisionId: row.decisionId, audience: row.intent.audience },
        });
      }
      updateAction(row.id, { status: "COMPLETED", authorization: "notify", completed: true });
      return getActionById(actionId);
    }
    if (row.actionType === "RECOMMEND_OWNER") {
      updateAction(row.id, { status: "COMPLETED", authorization: "advisory", completed: true });
      return getActionById(actionId);
    }
    if (row.actionType === "CREATE_JIRA" || row.actionType === "UPDATE_JIRA") {
      const ok = connectorPresent(auth.userId, "jira");
      updateAction(row.id, {
        status: "BLOCKED_CONNECTOR",
        error: ok
          ? "Jira ingest is connected; outbound issue create is not built. Intent is recorded."
          : "No Jira connector. Intent recorded; will not invent a ticket.",
        completed: true,
      });
      return getActionById(actionId);
    }
    if (row.actionType === "CREATE_MEETING") {
      const ok = connectorPresent(auth.userId, "calendar");
      updateAction(row.id, {
        status: "BLOCKED_CONNECTOR",
        error: ok
          ? "Calendar ingest is connected; outbound event create is not built. Intent is recorded."
          : "No calendar connector. Intent recorded; will not invent a meeting.",
        completed: true,
      });
      return getActionById(actionId);
    }
    updateAction(row.id, {
      status: "DENIED",
      error: "This action type is not dispatched by the orchestrator.",
      completed: true,
    });
    return getActionById(actionId);
  } catch (err) {
    updateAction(row.id, {
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
      completed: true,
    });
    return getActionById(actionId);
  }
}
