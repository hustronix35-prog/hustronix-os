/**
 * Situation detection entrypoint — progressive Situation objects, then DRAFT
 * only at DECISION_READY. Source tag: institutional_reasoning.source = "situation_detect"
 */
import { db } from "../database.js";
import {
  runProgressiveSituationEngine,
  type ProgressiveDetectOpts,
} from "./situation-engine.js";
import { runEmergentSituationEngine } from "./emergent-situations.js";
import { runOpenWorldSituationEngine } from "./open-world-engine.js";
import { inferDependenciesFromWorkflow } from "./workflow-deps.js";
import { inferDependenciesFromSignals } from "./dependency-infer.js";
import { recordSituationLearnings } from "./situation-learning.js";
import { recordEngineRun } from "./os-observability.js";
export { SITUATION_PATTERNS, type SituationPattern } from "./situation-patterns.js";

export type SituationDetectResult = {
  scanned: number;
  situations: Array<{
    id: string;
    hits: number;
    signal_ids: string[];
    decision_id: string | null;
    created: boolean;
    linked: number;
    stage?: string;
    confidence?: number;
    trajectory?: string;
  }>;
  created: number;
  linked: number;
  deps_seeded: number;
  emergent?: {
    clusters: number;
    situations_opened: number;
    decisions_created: number;
    resolved: number;
  };
};

/**
 * Progressive detect. Pass simDay from chronological customer-path replays.
 */
export function runSituationDetection(
  userId: string,
  opts?: ProgressiveDetectOpts,
): SituationDetectResult {
  purgeDraftSituationExecutionTasks(userId);
  if (opts?.openWorld) {
    const ow = runOpenWorldSituationEngine(userId, opts);
    return {
      scanned: 0,
      created: ow.decisions_created,
      linked: 0,
      deps_seeded: 0,
      situations: [],
      emergent: {
        clusters: ow.clusters,
        situations_opened: ow.situations_opened,
        decisions_created: ow.decisions_created,
        resolved: ow.resolved,
      },
    };
  }
  const started = Date.now();
  const r = runProgressiveSituationEngine(userId, opts);
  const emergent = runEmergentSituationEngine(userId, opts);
  try {
    inferDependenciesFromWorkflow(userId);
    inferDependenciesFromSignals(userId, 120);
  } catch {
    /* ignore */
  }
  try {
    recordSituationLearnings(userId);
  } catch {
    /* ignore */
  }
  try {
    recordEngineRun({
      userId,
      kind: "detect",
      latencyMs: Date.now() - started,
      scanned: r.scanned,
    });
  } catch {
    /* ignore */
  }
  return {
    scanned: r.scanned,
    created: r.created_decisions + emergent.decisions_created,
    linked: r.situations.reduce((n, s) => n + (s.decision_id ? s.evidence_count : 0), 0),
    deps_seeded: 0,
    situations: r.situations.map((s) => ({
      id: s.pattern_id,
      hits: s.facets.length,
      signal_ids: [],
      decision_id: s.decision_id,
      created: s.created_decision,
      linked: s.decision_id ? s.evidence_count : 0,
      stage: s.stage,
      confidence: s.confidence,
      trajectory: s.trajectory,
    })),
    emergent,
  };
}

/** Debounced per-user schedule so burst ingest coalesces. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Remove PENDING/BLOCKED execution rows still attached to DRAFT situation decisions.
 */
export function purgeDraftSituationExecutionTasks(userId: string): number {
  const rows = db.rawGet(
    `SELECT e.task_id, d.id AS decision_id, d.decision_reasoning
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ?
       AND d.status = 'DRAFT'
       AND e.status IN ('PENDING','BLOCKED')
       AND (
         d.decision_reasoning LIKE '%"source":"situation_detect"%'
         OR d.decision_reasoning LIKE '%"source": "situation_detect"%'
       )`,
    [userId],
  ) as { task_id: string; decision_id: string; decision_reasoning: string | null }[];

  let removed = 0;
  for (const row of rows) {
    try {
      let ir: Record<string, unknown> = {};
      try {
        ir = row.decision_reasoning ? JSON.parse(row.decision_reasoning) : {};
      } catch {
        ir = {};
      }
      if (!Array.isArray(ir.proposed_tasks) || !(ir.proposed_tasks as unknown[]).length) {
        const tasks = db.rawGet(
          `SELECT owner, type, weight, success_condition FROM execution_ledger WHERE decision_id = ?`,
          [row.decision_id],
        ) as { owner: string; type: string; weight: number; success_condition: string | null }[];
        ir.proposed_tasks = tasks.map((t) => ({
          type: t.type || "ACTION",
          owner: t.owner,
          weight: t.weight || 1,
          success_condition: t.success_condition || undefined,
        }));
        ir.source = ir.source || "situation_detect";
        db.rawRun(`UPDATE decision_ledger SET decision_reasoning = ? WHERE id = ?`, [
          JSON.stringify(ir),
          row.decision_id,
        ]);
      }
      db.rawRun(
        `UPDATE external_signals
         SET related_decision_id = COALESCE(related_decision_id, ?),
             linked_execution_id = CASE WHEN linked_execution_id = ? THEN NULL ELSE linked_execution_id END,
             state = CASE WHEN linked_execution_id = ? AND state = 'LINKED' THEN 'UNVERIFIED' ELSE state END
         WHERE linked_execution_id = ? OR related_decision_id = ?`,
        [row.decision_id, row.task_id, row.task_id, row.task_id, row.decision_id],
      );
      db.rawRun(`DELETE FROM executions_fts WHERE task_id = ?`, [row.task_id]);
      db.rawRun(`DELETE FROM execution_ledger WHERE task_id = ?`, [row.task_id]);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export function scheduleSituationDetection(userId: string, delayMs = 2500) {
  if (process.env.HUSTRONIX_OPEN_WORLD === "1") return;
  if (!userId || userId === "system") return;
  const prev = pending.get(userId);
  if (prev) clearTimeout(prev);
  pending.set(
    userId,
    setTimeout(() => {
      pending.delete(userId);
      try {
        const r = runSituationDetection(userId);
        if (r.created || r.linked) {
          console.log(
            `[situation_detect] user=${userId} created=${r.created} linked=${r.linked} progressive=1`,
          );
        }
      } catch (err) {
        console.warn(
          `[situation_detect] failed for ${userId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }, delayMs),
  );
}
