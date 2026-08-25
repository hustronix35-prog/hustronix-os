/**
 * Read-only execution plan for an ACTIVE (or just-committed) decision.
 * Does not create Jira/calendar/tasks — ledger stays source of truth.
 */
import { db } from "../database.js";
import { resolveTenantContext, tenantSqlScope } from "../security/tenant-context.js";
import { jiraCloudUrlForUser, resolveSignalOpenTargets } from "../brain/signal-open.js";

export type PlanActionKind =
  | "ready"
  | "in_progress"
  | "blocked"
  | "needs_clarification"
  | "done"
  | "killed";

export type ExecutionPlanExistingWork = {
  source: string;
  externalId: string | null;
  label: string;
  url: string | null;
  taskId: string | null;
};

export type ExecutionPlanAction = {
  taskId: string;
  label: string;
  owner: string;
  status: string;
  kind: PlanActionKind;
  weight: number;
  incompleteDeps: number;
  blockedReasons: string[];
  clarification: { trigger: string; questionType: string } | null;
  existingWork: ExecutionPlanExistingWork[];
};

export type ExecutionPlanOwnerLoad = {
  owner: string;
  activeWeight: number;
  pendingWeight: number;
  capacity: number;
  conflict: boolean;
};

export type ExecutionPlanCounts = {
  total: number;
  ready: number;
  inProgress: number;
  blocked: number;
  needsClarification: number;
  done: number;
  owners: number;
  dependencies: number;
  existingWork: number;
  ownerConflicts: number;
};

export type ExecutionPlan = {
  decisionId: string;
  vow: string;
  status: string;
  actions: ExecutionPlanAction[];
  counts: ExecutionPlanCounts;
  owners: ExecutionPlanOwnerLoad[];
  existingWork: ExecutionPlanExistingWork[];
  readinessPct: number;
  recommendedNext: string;
};

type ExecRow = {
  task_id: string;
  status: string;
  owner: string;
  type: string | null;
  weight: number | null;
  success_condition: string | null;
  blocked_reasons: string | null;
  dependencies: string | null;
  last_update: string | null;
  started_at: string | null;
  estimated_duration_hours: number | null;
};

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function ownerUnclear(owner: string): boolean {
  const o = (owner || "").trim().toLowerCase();
  return !o || o === "system" || o === "unknown";
}

/** Pure classifier — no DB. Stale/open-clarification overrides happen in buildExecutionPlan. */
export function classifyPlanAction(input: {
  status: string;
  owner: string;
  successCondition: string | null;
  incompleteDeps: number;
}): PlanActionKind {
  const st = String(input.status || "").toUpperCase();
  if (st === "DONE") return "done";
  if (st === "KILLED") return "killed";
  if (st === "BLOCKED") return "blocked";
  if (ownerUnclear(input.owner) || !String(input.successCondition || "").trim() || input.incompleteDeps > 0) {
    return "needs_clarification";
  }
  if (st === "ACTIVE") return "in_progress";
  return "ready";
}

export function readinessPct(counts: Pick<ExecutionPlanCounts, "ready" | "inProgress" | "blocked" | "needsClarification">): number {
  const open = counts.ready + counts.inProgress + counts.blocked + counts.needsClarification;
  if (!open) return 0;
  return Math.round((100 * (counts.ready + counts.inProgress)) / open);
}

export function recommendedNext(counts: ExecutionPlanCounts): string {
  if (!counts.total) return "No linked actions yet. Execution has not started.";
  if (counts.blocked) return "Resolve blockers before starting more work.";
  if (counts.needsClarification) return "Clarify ownership or success conditions.";
  if (counts.ownerConflicts) return "Review owner capacity before activating work.";
  if (counts.ready) return "Start execution.";
  if (counts.inProgress) return "Monitor in-progress work.";
  if (counts.done && !counts.ready && !counts.inProgress && !counts.blocked) return "All linked actions are done.";
  return "Review execution.";
}

export function buildExecutionPlan(userId: string, decisionId: string): ExecutionPlan | null {
  const id = String(decisionId || "").trim();
  if (!id) return null;
  const ctx = resolveTenantContext(userId);
  const scope = tenantSqlScope(ctx);
  const d = db
    .rawGet(
      `SELECT id, user_id, vow, status FROM decision_ledger WHERE id = ?${scope.sql} LIMIT 1`,
      [id, ...scope.params],
    )
    .at(0) as { id: string; user_id: string; vow: string; status: string } | undefined;
  if (!d) return null;

  const rows = db.rawGet(
    `SELECT task_id, status, owner, type, weight, success_condition, blocked_reasons,
            dependencies, last_update, started_at, estimated_duration_hours
     FROM execution_ledger WHERE decision_id = ?
     ORDER BY last_update DESC`,
    [d.id],
  ) as ExecRow[];

  const doneIds = new Set(rows.filter((r) => String(r.status).toUpperCase() === "DONE").map((r) => r.task_id));
  const allDepIds = [...new Set(rows.flatMap((r) => parseJsonArray(r.dependencies)))];
  const missingDepIds = allDepIds.filter((depId) => !rows.some((r) => r.task_id === depId));
  if (missingDepIds.length) {
    const extra = db.rawGet(
      `SELECT task_id, status FROM execution_ledger WHERE task_id IN (${missingDepIds.map(() => "?").join(",")})`,
      missingDepIds,
    ) as { task_id: string; status: string }[];
    for (const e of extra) {
      if (String(e.status).toUpperCase() === "DONE") doneIds.add(e.task_id);
    }
  }

  const taskIds = rows.map((r) => r.task_id);
  const signalParams: unknown[] = [d.id];
  let signalSql = `SELECT id, source, source_subtype, external_id, owner, content, state, ingest_meta, linked_execution_id
     FROM external_signals WHERE related_decision_id = ?`;
  if (taskIds.length) {
    signalSql += ` OR linked_execution_id IN (${taskIds.map(() => "?").join(",")})`;
    signalParams.push(...taskIds);
  }
  const signalRows = db.rawGet(signalSql, signalParams) as Array<{
    id: string;
    source: string;
    source_subtype: string | null;
    external_id: string | null;
    owner: string | null;
    content: string | null;
    state: string;
    ingest_meta: string | null;
    linked_execution_id: string | null;
  }>;

  const jiraCloud = jiraCloudUrlForUser(d.user_id || userId);
  const existingWork: ExecutionPlanExistingWork[] = [];
  const workByTask = new Map<string, ExecutionPlanExistingWork[]>();
  for (const s of signalRows) {
    const src = String(s.source || "").toUpperCase();
    if (src !== "JIRA" && src !== "LINEAR" && src !== "GITHUB") continue;
    const targets = resolveSignalOpenTargets(s, { jiraCloudUrl: jiraCloud });
    const item: ExecutionPlanExistingWork = {
      source: s.source,
      externalId: s.external_id,
      label: String(s.external_id || s.content || s.source).slice(0, 80),
      url: targets[0]?.url ?? null,
      taskId: s.linked_execution_id,
    };
    existingWork.push(item);
    if (item.taskId) {
      const list = workByTask.get(item.taskId) ?? [];
      list.push(item);
      workByTask.set(item.taskId, list);
    }
  }

  let openClarify: { task_id: string; trigger: string; question_type: string }[] = [];
  try {
    openClarify = taskIds.length
      ? (db.rawGet(
          `SELECT task_id, trigger, question_type FROM clarification_requests
           WHERE decision_id = ? AND status = 'OPEN'`,
          [d.id],
        ) as { task_id: string; trigger: string; question_type: string }[])
      : [];
  } catch {
    /* table may be absent on very old DBs */
  }
  const clarifyByTask = new Map(openClarify.map((c) => [c.task_id, c]));

  const actions: ExecutionPlanAction[] = [];
  const ownerPending = new Map<string, number>();
  let depTotal = 0;

  for (const row of rows) {
    const deps = parseJsonArray(row.dependencies);
    const incompleteDeps = deps.filter((depId) => !doneIds.has(depId)).length;
    depTotal += deps.length;
    const blockedReasons = parseJsonArray(row.blocked_reasons);
    let kind = classifyPlanAction({
      status: row.status,
      owner: row.owner,
      successCondition: row.success_condition,
      incompleteDeps,
    });
    // ponytail: open clarifications only; stale scan stays on the auditor. Upgrade: call detectClarificationNeed.
    let clarification: ExecutionPlanAction["clarification"] = null;
    const open = clarifyByTask.get(row.task_id);
    if (open) {
      clarification = { trigger: open.trigger, questionType: open.question_type };
      if (kind === "ready" || kind === "in_progress") kind = "needs_clarification";
    }

    if (kind === "ready" || kind === "needs_clarification") {
      const owner = (row.owner || "system").trim() || "system";
      ownerPending.set(owner, (ownerPending.get(owner) || 0) + Number(row.weight || 0));
    }

    actions.push({
      taskId: row.task_id,
      label: String(row.success_condition || row.type || row.task_id).slice(0, 120),
      owner: row.owner || "system",
      status: row.status,
      kind,
      weight: Number(row.weight || 0),
      incompleteDeps,
      blockedReasons,
      clarification,
      existingWork: workByTask.get(row.task_id) ?? [],
    });
  }

  const ownerNames = [...new Set(actions.map((a) => a.owner).filter((o) => !ownerUnclear(o)))];
  const owners: ExecutionPlanOwnerLoad[] = ownerNames.map((owner) => {
    const cap = db.getOwnerCapacity(owner, userId);
    const activeWeight = db.getOwnerActiveWeight(owner, userId);
    const pendingWeight = ownerPending.get(owner) || 0;
    return {
      owner,
      activeWeight,
      pendingWeight,
      capacity: cap.capacity,
      conflict: !cap.is_locked && activeWeight + pendingWeight > cap.capacity,
    };
  });

  const counts: ExecutionPlanCounts = {
    total: actions.length,
    ready: actions.filter((a) => a.kind === "ready").length,
    inProgress: actions.filter((a) => a.kind === "in_progress").length,
    blocked: actions.filter((a) => a.kind === "blocked").length,
    needsClarification: actions.filter((a) => a.kind === "needs_clarification").length,
    done: actions.filter((a) => a.kind === "done").length,
    owners: ownerNames.length,
    dependencies: depTotal,
    existingWork: existingWork.length,
    ownerConflicts: owners.filter((o) => o.conflict).length,
  };

  return {
    decisionId: d.id,
    vow: d.vow,
    status: d.status,
    actions,
    counts,
    owners,
    existingWork,
    readinessPct: readinessPct(counts),
    recommendedNext: recommendedNext(counts),
  };
}
