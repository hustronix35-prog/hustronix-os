import { db } from "../database.js";
import { requireCausalValidationForActivation } from "../institutional-reasoning.js";
import { attachEpistemicDerivation } from "../epistemic-engine.js";
import { onDecisionCommitted } from "../beliefs/belief-engine.js";
import { assertEpistemicSupportForCommit } from "../evaluation/outcome-evaluation.js";
import { assertDecisionCompletable, getDecisionCompletionEligibility } from "../evaluation/completion-eligibility.js";
import { applySituationFollowthrough } from "../evaluation/situation-followthrough.js";
import { notify, defaultAppLink } from "../notifications/dispatcher.js";
import { assertLedgerTenantAccess } from "./tenant-scope.js";
import { resolveTenantContext } from "./tenant-context.js";
import type { AuthKind } from "../middleware/auth.js";

export interface CommitDecisionOptions {
  approvalId?: string;
  emergencyOverride?: boolean;
  emergencyReason?: string;
}

export function mutationCreateDraftDecision(
  userId: string,
  body: {
    vow?: string;
    expected_outcomes?: unknown[];
    tasks?: { type?: string; weight?: number; owner?: string; success_condition?: string }[];
    /** When false, store proposed work in IR only — no execution_ledger rows until commit. */
    materializeTasks?: boolean;
    institutional_reasoning?: unknown;
    reversal_conditions?: string;
    constraints?: unknown[];
  },
): { id: string; status: string } {
  const vow = String(body.vow || "").trim();
  if (!vow) throw new Error("vow required");
  const materialize = body.materializeTasks !== false;
  const mappedTasks =
    Array.isArray(body.tasks) && body.tasks.length > 0
      ? body.tasks.map((t) => ({
          type: t.type || "ACTION",
          weight: typeof t.weight === "number" ? t.weight : 1,
          owner: String(t.owner || "system").slice(0, 120),
          ...(t.success_condition
            ? { success_condition: String(t.success_condition).slice(0, 500) }
            : {}),
        }))
      : materialize
        ? [{ type: "ACTION", weight: 1, owner: "system" }]
        : [];
  const irBase =
    body.institutional_reasoning != null && typeof body.institutional_reasoning === "object"
      ? { ...(body.institutional_reasoning as Record<string, unknown>) }
      : {};
  if (!materialize && mappedTasks.length > 0) {
    irBase.proposed_tasks = mappedTasks;
  }
  const payload: Record<string, unknown> = {
    vow: vow.slice(0, 4000),
    expected_outcomes: Array.isArray(body.expected_outcomes)
      ? body.expected_outcomes
      : [{ metric: "Outcome", target: "Define success criteria" }],
    constraints: Array.isArray(body.constraints) ? body.constraints : [],
    confidence: 0.75,
  };
  if (materialize && mappedTasks.length > 0) {
    payload.tasks = mappedTasks;
  }
  if (body.reversal_conditions != null && String(body.reversal_conditions).trim() !== "") {
    payload.reversal_conditions = String(body.reversal_conditions).slice(0, 8000);
  }
  if (Object.keys(irBase).length > 0) {
    payload.institutional_reasoning = irBase;
  }
  const id = db.saveDecisionEvent(userId, payload);
  return { id, status: "DRAFT" };
}

/** Patch DRAFT institutional reasoning (Talk validation). Re-attaches epistemic_derivation. */
export function mutationPatchDraftReasoning(
  userId: string,
  decisionId: string,
  memo: Record<string, unknown>,
): void {
  const tenant = db.getDecisionTenant(decisionId);
  if (!tenant) throw new Error("Decision not found.");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  const row = db.getDecisionLedgerRow(decisionId);
  if (!row) throw new Error("Decision not found.");
  if (String(row.status) !== "DRAFT") {
    throw new Error("Only DRAFT decisions can be validated in Talk.");
  }
  const next = { ...memo };
  if (Number(next.institutional_version) >= 3) {
    attachEpistemicDerivation(next as any, db.getEpistemicOrgContext(userId));
  }
  db.rawRun(`UPDATE decision_ledger SET decision_reasoning = ? WHERE id = ?`, [JSON.stringify(next), decisionId]);
}

/** Spawn execution tasks from IR.proposed_tasks (or caller list) if the decision has none. */
export function materializeProposedTasksForDecision(
  userId: string,
  decisionId: string,
): string[] {
  const tenant = db.getDecisionTenant(decisionId);
  if (!tenant) throw new Error("Decision not found.");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  const existing = db.rawGet(
    `SELECT task_id FROM execution_ledger WHERE decision_id = ? LIMIT 1`,
    [decisionId],
  ) as { task_id: string }[];
  if (existing.length > 0) return existing.map((e) => e.task_id);

  const row = db.getDecisionLedgerRow(decisionId);
  let proposed: {
    type?: string;
    weight?: number;
    owner?: string;
    success_condition?: string;
  }[] = [];
  try {
    const ir = row?.decision_reasoning ? JSON.parse(String(row.decision_reasoning)) : null;
    if (Array.isArray(ir?.proposed_tasks)) proposed = ir.proposed_tasks;
  } catch {
    /* ignore */
  }
  if (!proposed.length) {
    proposed = [{ type: "ACTION", weight: 1, owner: "system", success_condition: "Execute committed vow" }];
  }
  const ids: string[] = [];
  for (const t of proposed) {
    ids.push(
      db.saveExecutionTask({
        decision_id: decisionId,
        type: t.type || "ACTION",
        weight: typeof t.weight === "number" ? t.weight : 1,
        owner: String(t.owner || "system").slice(0, 120),
        success_condition: t.success_condition || null,
      }),
    );
  }
  return ids;
}

export function mutationTransitionExecution(
  userId: string,
  params: { taskId: string; newState: string; reason?: string },
): Record<string, unknown> {
  const { taskId, newState, reason } = params;
  if (!taskId || !newState) throw new Error("taskId and newState required");
  const tenant = db.getExecutionTenantForTask(taskId);
  if (!tenant) throw new Error("Task not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  const result = db.transitionExecutionState(taskId, newState, reason);
  const taskRow = (
    db.rawGet(`SELECT decision_id FROM execution_ledger WHERE task_id = ?`, [taskId]) as {
      decision_id: string;
    }[]
  )[0];
  const decisionId = taskRow?.decision_id;
  const elig = decisionId ? getDecisionCompletionEligibility(decisionId) : null;
  return {
    success: true,
    ...result,
    decision_id: decisionId ?? null,
    completion_eligible: elig?.eligible ?? false,
  };
}

export function mutationAssignExecutionOwner(
  userId: string,
  params: { taskId: string; owner: string },
): { taskId: string; owner: string } {
  const taskId = String(params.taskId || "").trim();
  const owner = String(params.owner || "").trim().slice(0, 120);
  if (!taskId || !owner) throw new Error("taskId and owner required");
  const tenant = db.getExecutionTenantForTask(taskId);
  if (!tenant) throw new Error("Task not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  db.rawRun(
    `UPDATE execution_ledger SET owner = ?, last_update = CURRENT_TIMESTAMP WHERE task_id = ?`,
    [owner, taskId],
  );
  db.notifyLedgerAuditor({ type: "execution", taskId });
  return { taskId, owner };
}

export function mutationLinkSignal(
  userId: string,
  params: {
    signalId: string;
    taskId: string;
    linkMethod?: string;
    linkProvenance?: Record<string, unknown>;
  },
): void {
  const { signalId, taskId, linkMethod, linkProvenance } = params;
  if (!signalId || !taskId) throw new Error("signalId and taskId required");
  const sigT = db.getSignalTenant(signalId);
  const execT = db.getExecutionTenantForTask(taskId);
  if (!sigT || !execT) throw new Error("Signal or task not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, sigT);
    assertLedgerTenantAccess(ctx, execT);
  }
  db.linkExternalSignalToTask(signalId, taskId, {
    linkMethod: linkMethod ?? "manual",
    linkProvenance: linkProvenance ?? { actor: userId },
  });
}

export function mutationUnlinkSignal(userId: string, params: { signalId: string }): void {
  const { signalId } = params;
  if (!signalId) throw new Error("signalId required");
  const tenant = db.getSignalTenant(signalId);
  if (!tenant) throw new Error("Signal not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  db.unlinkExternalSignal(signalId);
}

export function mutationKillSignal(userId: string, params: { signalId: string }): void {
  const { signalId } = params;
  if (!signalId) throw new Error("signalId required");
  const tenant = db.getSignalTenant(signalId);
  if (!tenant) throw new Error("Signal not found");
  const ctx = resolveTenantContext(userId);
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  const row = (
    db.rawGet(
      `SELECT ingest_meta, external_id FROM external_signals WHERE id = ?`,
      [signalId],
    ) as { ingest_meta: string | null; external_id: string | null }[]
  )[0];
  if (row) {
    const ext = String(row.external_id || "");
    let runtime = "";
    let scenario = "";
    try {
      const meta = row.ingest_meta ? (JSON.parse(row.ingest_meta) as Record<string, unknown>) : {};
      runtime = String(meta.integration_runtime || "");
      scenario = meta.hsog_scenario_id != null ? String(meta.hsog_scenario_id) : "";
    } catch {
      /* ignore */
    }
    if (ext.startsWith("hsog:") || runtime.startsWith("hsog") || scenario) {
      throw new Error("Corpus/evidence signals cannot be killed; link or leave in GRACE.");
    }
  }
  db.killExternalSignal(signalId);
}

export function mutationCommitDecision(
  userId: string,
  decisionId: string,
  justification?: string,
  _options?: CommitDecisionOptions,
): string {
  const ctx = resolveTenantContext(userId);
  const tenant = db.getDecisionTenant(decisionId);
  if (!tenant) throw new Error("Decision not found.");
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  const row = db.getDecisionLedgerRow(decisionId);
  if (row?.decision_reasoning != null && String(row.decision_reasoning).trim() !== "") {
    requireCausalValidationForActivation(row.decision_reasoning);
    assertEpistemicSupportForCommit(userId, decisionId);
  }
  db.transitionDecisionState(decisionId, "ACTIVE", justification || "Committed via Hustronix");
  const taskIds = materializeProposedTasksForDecision(userId, decisionId);
  const primaryTask = taskIds[0];
  if (primaryTask) {
    const related = db.rawGet(
      `SELECT id FROM external_signals
       WHERE user_id = ? AND related_decision_id = ? AND state IN ('UNVERIFIED','GRACE')
       LIMIT 12`,
      [userId, decisionId],
    ) as { id: string }[];
    for (const s of related) {
      try {
        mutationLinkSignal(userId, {
          signalId: s.id,
          taskId: primaryTask,
          linkMethod: "commit_materialize",
          linkProvenance: { origin: "materialize_on_commit" },
        });
      } catch {
        /* capacity / auditor */
      }
    }
  }
  onDecisionCommitted(userId, decisionId);
  if (userId !== "system") {
    void notify(userId, {
      kind: "decision.committed",
      title: "Decision committed",
      body: `Decision ${decisionId} is now ACTIVE.`,
      linkUrl: defaultAppLink(`/mission-control`),
      payload: { decisionId, status: "ACTIVE" },
    }).catch((err) => console.error("[notifications] decision.committed:", err));
  }
  return ctx.orgId;
}

/** Operator confirm: ACTIVE + all governed tasks DONE → COMPLETED. Does not auto-fire from task DONE. */
export function mutationCompleteDecision(
  userId: string,
  decisionId: string,
  justification?: string,
): string {
  const ctx = resolveTenantContext(userId);
  const tenant = db.getDecisionTenant(decisionId);
  if (!tenant) throw new Error("Decision not found.");
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  assertDecisionCompletable(decisionId);
  db.transitionDecisionState(
    decisionId,
    "COMPLETED",
    justification || "Completed via Hustronix",
  );
  applySituationFollowthrough(decisionId, "COMPLETED");
  if (userId !== "system") {
    void notify(userId, {
      kind: "decision.completed",
      title: "Decision completed",
      body: `Decision ${decisionId} is now COMPLETED.`,
      linkUrl: defaultAppLink(`/execute?decision=${encodeURIComponent(decisionId)}`),
      payload: { decisionId, status: "COMPLETED" },
    }).catch((err) => console.error("[notifications] decision.completed:", err));
  }
  return ctx.orgId;
}

/** Operator confirm: ACTIVE or UNDER_REVIEW → REVERSED. Does not silently retry. */
export function mutationReverseDecision(
  userId: string,
  decisionId: string,
  justification?: string,
): string {
  const ctx = resolveTenantContext(userId);
  const tenant = db.getDecisionTenant(decisionId);
  if (!tenant) throw new Error("Decision not found.");
  if (userId !== "system") {
    assertLedgerTenantAccess(ctx, tenant);
  }
  const row = db.getDecisionLedgerRow(decisionId);
  const status = String(row?.status || "");
  if (status === "REVERSED") throw new Error("Decision is already REVERSED.");
  if (status === "COMPLETED") throw new Error("COMPLETED decisions cannot be reversed here.");
  if (status !== "ACTIVE" && status !== "UNDER_REVIEW") {
    throw new Error(`Decision is ${status || "unknown"}, not ACTIVE or UNDER_REVIEW.`);
  }
  db.transitionDecisionState(decisionId, "REVERSED", justification || "Reversed via Hustronix");
  applySituationFollowthrough(decisionId, "REVERSED");
  if (userId !== "system") {
    void notify(userId, {
      kind: "decision.reversed",
      title: "Decision reversed",
      body: `Decision ${decisionId} is now REVERSED.`,
      linkUrl: defaultAppLink(`/chat`),
      payload: { decisionId, status: "REVERSED" },
    }).catch((err) => console.error("[notifications] decision.reversed:", err));
  }
  return ctx.orgId;
}
export function agentToolGatewayName(toolName: string): string {
  return toolName;
}

export function agentToolArgsForGateway(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === "transition_execution") {
    const taskId = args.task_id ?? args.taskId;
    return { task_id: taskId, newState: args.newState, reason: args.reason ?? "" };
  }
  if (toolName === "log_strategic_decision") {
    return { ...args, vow: args.vow ?? "" };
  }
  return args;
}

export type MutationAuthKind = AuthKind | string | undefined;
