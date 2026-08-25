import { db } from "../database.js";
import type { AuditorWriteContext } from "../auditor-context.js";
import { recordEvidence } from "./evidence-collector.js";
import { predictTaskSuccess } from "./shadow-predictor.js";
import { resolvePrediction } from "./feedback.js";
import { replayBeliefsForTenant } from "./replay.js";
import type { EvidenceEventType } from "./types.js";

function tenantForTask(taskId: string): string | null {
  return db.getExecutionTenantForTask(taskId) ?? null;
}

function tenantForDecision(decisionId: string): string | null {
  return db.getDecisionTenant(decisionId) ?? null;
}

function tenantForSignal(signalId: string): string | null {
  return db.getSignalTenant(signalId) ?? null;
}

function ownerActiveLoad(owner: string): number {
  const row = db
    .rawGet(
      `SELECT COALESCE(SUM(weight), 0) AS w FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'`,
      [owner],
    )
    .at(0) as { w: number } | undefined;
  return Number(row?.w ?? 0);
}

function taskDurationRatio(task: {
  started_at?: string | null;
  completed_at?: string | null;
  estimated_duration_hours?: number | null;
}): number {
  if (!task.started_at || !task.completed_at) return 1;
  const start = Date.parse(task.started_at);
  const end = Date.parse(task.completed_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  const actualHours = (end - start) / (1000 * 60 * 60);
  const estimated = Number(task.estimated_duration_hours) || actualHours || 1;
  return actualHours / Math.max(0.1, estimated);
}

function emitTaskEvidence(
  task: Record<string, unknown>,
  eventType: EvidenceEventType,
  idempotencySuffix: string,
) {
  const taskId = String(task.task_id);
  const tenantId = tenantForTask(taskId);
  if (!tenantId) return;
  const owner = String(task.owner ?? "system");
  const activeLoad = ownerActiveLoad(owner);

  recordEvidence({
    tenantId,
    eventType,
    subjectEntityType: "person",
    subjectEntityId: owner,
    sourceEntityType: "task",
    sourceEntityId: taskId,
    payload: {
      task_id: taskId,
      decision_id: task.decision_id,
      status: task.status,
      attribution: task.attribution ?? "unknown",
      active_load: activeLoad,
      duration_ratio: taskDurationRatio(task as { started_at?: string; completed_at?: string; estimated_duration_hours?: number }),
      on_time: taskDurationRatio(task as { started_at?: string; completed_at?: string; estimated_duration_hours?: number }) <= 1.05,
      success_condition: task.success_condition,
      weight: task.weight,
    },
    idempotencyKey: `${eventType}:${taskId}:${idempotencySuffix}`,
  });
}

/** Wire from bootstrap setLedgerAuditorHook — parallel to auditor. */
export function onLedgerEvent(ctx: AuditorWriteContext) {
  try {
    if (ctx.type === "execution") {
      const task = db
        .rawGet(`SELECT * FROM execution_ledger WHERE task_id = ?`, [ctx.taskId])
        .at(0) as Record<string, unknown> | undefined;
      if (!task) return;
      const status = String(task.status);
      if (status === "DONE") {
        emitTaskEvidence(task, "task.completed", status);
        const tenantId = tenantForTask(ctx.taskId);
        if (tenantId) {
          const preds = db.rawGet(
            `SELECT id FROM execution_predictions
             WHERE tenant_id = ? AND entity_id = ? AND resolved_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [tenantId, task.owner],
          ) as { id: string }[];
          if (preds[0]) resolvePrediction(preds[0].id, 1);
        }
      } else if (status === "KILLED") {
        emitTaskEvidence(task, "task.killed", status);
        const tenantId = tenantForTask(ctx.taskId);
        if (tenantId) {
          const preds = db.rawGet(
            `SELECT id FROM execution_predictions
             WHERE tenant_id = ? AND entity_id = ? AND resolved_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [tenantId, task.owner],
          ) as { id: string }[];
          if (preds[0]) resolvePrediction(preds[0].id, 0);
        }
      } else if (status === "BLOCKED") {
        emitTaskEvidence(task, "task.blocked", status);
      } else if (status === "PENDING") {
        emitTaskSpawnedEvidence(ctx.taskId, String(task.owner ?? "system"));
        const tenantId = tenantForTask(ctx.taskId);
        if (tenantId) {
          predictTaskSuccess(tenantId, String(task.owner ?? "system"), {
            activeLoad: ownerActiveLoad(String(task.owner ?? "system")),
          });
        }
      } else if (status === "ACTIVE") {
        const tenantId = tenantForTask(ctx.taskId);
        if (tenantId) {
          predictTaskSuccess(tenantId, String(task.owner ?? "system"), {
            activeLoad: ownerActiveLoad(String(task.owner ?? "system")),
          });
        }
      }
      return;
    }

    if (ctx.type === "signal_link") {
      const signal = db
        .rawGet(`SELECT * FROM external_signals WHERE id = ?`, [ctx.signalId])
        .at(0) as { owner?: string; user_id?: string } | undefined;
      const tenantId = tenantForSignal(ctx.signalId) ?? signal?.user_id ?? null;
      if (!tenantId || !signal?.owner) return;
      recordEvidence({
        tenantId,
        eventType: "signal.linked",
        subjectEntityType: "person",
        subjectEntityId: signal.owner,
        sourceEntityType: "task",
        sourceEntityId: ctx.taskId,
        payload: { signal_id: ctx.signalId, task_id: ctx.taskId },
        idempotencyKey: `signal.linked:${ctx.signalId}:${ctx.taskId}`,
      });
      return;
    }

    if (ctx.type === "decision") {
      const decision = db.getDecisionLedgerRow(ctx.decisionId);
      if (!decision) return;
      const status = String(decision.status ?? "");
      if (status !== "COMPLETED" && status !== "REVERSED") return;
      const tenantId = tenantForDecision(ctx.decisionId);
      if (!tenantId) return;
      const owners = db.rawGet(
        `SELECT DISTINCT owner FROM execution_ledger WHERE decision_id = ?`,
        [ctx.decisionId],
      ) as { owner: string }[];
      const owner = owners[0]?.owner ?? "system";
      recordEvidence({
        tenantId,
        eventType: "decision.outcome",
        subjectEntityType: "person",
        subjectEntityId: owner,
        sourceEntityType: "decision",
        sourceEntityId: ctx.decisionId,
        payload: {
          decision_id: ctx.decisionId,
          status,
          delta_score: 0.5,
        },
        idempotencyKey: `decision.outcome:${ctx.decisionId}:${status}`,
      });
    }
  } catch (e) {
    console.error("[EIE] onLedgerEvent failed:", e);
  }
}

export function emitShadowKilledEvidence(signal: {
  id: string;
  owner: string;
  source: string;
  user_id?: string;
}) {
  const tenantId = signal.user_id ?? db.getSignalTenant(signal.id) ?? "system";
  recordEvidence({
    tenantId,
    eventType: "signal.shadow_killed",
    subjectEntityType: "person",
    subjectEntityId: signal.owner || tenantId,
    sourceEntityType: "task",
    sourceEntityId: signal.id,
    payload: { signal_id: signal.id, source: signal.source, grace_exceeded: true },
    idempotencyKey: `signal.shadow_killed:${signal.id}`,
  });
}

export function emitDecisionOutcomeEvidence(params: {
  tenantId: string;
  decisionId: string;
  owner: string;
  deltaScore: number;
}) {
  recordEvidence({
    tenantId: params.tenantId,
    eventType: "decision.outcome",
    subjectEntityType: "person",
    subjectEntityId: params.owner,
    sourceEntityType: "decision",
    sourceEntityId: params.decisionId,
    payload: { decision_id: params.decisionId, delta_score: params.deltaScore },
    idempotencyKey: `decision.outcome:${params.decisionId}:${params.deltaScore.toFixed(2)}`,
  });
}

export const emitSignalShadowKilledEvidence = emitShadowKilledEvidence;

export function emitTaskSpawnedEvidence(taskId: string, owner: string) {
  const tenantId = tenantForTask(taskId);
  if (!tenantId) return;
  recordEvidence({
    tenantId,
    eventType: "task.spawned",
    subjectEntityType: "person",
    subjectEntityId: owner,
    sourceEntityType: "task",
    sourceEntityId: taskId,
    payload: { task_id: taskId, active_load: ownerActiveLoad(owner) },
    idempotencyKey: `task.spawned:${taskId}`,
  });
}

export { recordEvidence } from "./evidence-collector.js";
export { resolvePrediction } from "./feedback.js";
export { replayBeliefsForTenant } from "./replay.js";
export {
  listBeliefsForEntity,
  computeDerivedCapacity,
  computeTrustScore,
  buildOwnerProfile,
  computeCalibration,
} from "./derived-views.js";
export { listPredictions, predictTaskSuccess, predictCapacityHeadroom } from "./shadow-predictor.js";
export { listEvidenceForEntity } from "./evidence-collector.js";
export { listGraphNeighbors } from "./graph-linker.js";

export const executionIntelligence = {
  onLedgerEvent,
  recordEvidence,
  resolvePrediction,
  replayBeliefsForTenant,
  emitShadowKilledEvidence,
  emitDecisionOutcomeEvidence,
  emitTaskSpawnedEvidence,
};
