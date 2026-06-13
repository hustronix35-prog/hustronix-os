import { db } from "./database.js";
import type { AuditorWriteContext } from "./auditor-context.js";
import { processSignalFireAndForget } from "./intelligence/index.js";

/**
 * Rule enforcement outside the LLM. Scoped runs fire on every ledger write; {@link evaluateAll}
 * is for cron and manual safety sweeps.
 */
export class AuditorEngine {
  /**
   * Event-driven enforcement for a single write. Avoids waiting for the 5-minute cron for
   * shadow-work expiry, capacity/NO-list repair, and structural collapse checks.
   *
   * On `signal` writes we also kick off the intelligence pipeline (detector +
   * auto-linker) via {@link processSignalFireAndForget}. It runs on the next
   * tick so the synchronous ingest return is not blocked on LLM/embedding
   * round-trips. The pipeline writes back through `db` (enrichSignal,
   * linkExternalSignalToTask) which themselves invoke the auditor — this
   * recursion is safe because `linkExternalSignalToTask` flips the signal to
   * `LINKED` and `processSignal` short-circuits on terminal states.
   */
  onWrite(ctx: AuditorWriteContext) {
    if (ctx.type === "full") {
      this.evaluateAll();
      return;
    }
    if (ctx.type === "signal") {
      this.evaluateShadowWorkForSignal(ctx.signalId);
      /** Non-blocking — runs after the current write returns. */
      setImmediate(() => processSignalFireAndForget(ctx.signalId));
      return;
    }
    if (ctx.type === "decision") {
      this.evaluateDecisionsForDecision(ctx.decisionId);
      const owners = db.rawGet(
        `SELECT DISTINCT e.owner FROM execution_ledger e WHERE e.decision_id = ? AND e.status = 'ACTIVE'`,
        [ctx.decisionId],
      ) as { owner: string }[];
      for (const { owner } of owners) {
        this.evaluateTasksForOwner(owner);
      }
      return;
    }
    if (ctx.type === "execution") {
      const rows = db.rawGet(`SELECT owner, decision_id FROM execution_ledger WHERE task_id = ?`, [
        ctx.taskId,
      ]) as { owner: string; decision_id: string }[];
      const row = rows[0];
      if (!row) return;
      this.evaluateTasksForOwner(row.owner);
      this.evaluateDecisionsForDecision(row.decision_id);
      return;
    }
    if (ctx.type === "signal_link") {
      this.evaluateShadowWorkForSignal(ctx.signalId);
      const t = db.rawGet(`SELECT owner, decision_id FROM execution_ledger WHERE task_id = ?`, [
        ctx.taskId,
      ]) as { owner: string; decision_id: string }[];
      const ex = t[0];
      if (ex) {
        this.evaluateTasksForOwner(ex.owner);
        this.evaluateDecisionsForDecision(ex.decision_id);
      }
    }
  }

  /**
   * Full reality sweep (cron + POST /api/audit/run). Also used when a path needs a full pass.
   */
  evaluateAll() {
    this.evaluateShadowWork();
    this.evaluateTasks();
    this.evaluateDecisions();
  }

  /** @deprecated prefer {@link onWrite} after signal insert; hook covers ingest. */
  runAfterSignalIngested() {
    this.evaluateShadowWork();
  }

  /** @deprecated prefer {@link onWrite}; full sweep is heavy. */
  runAfterLedgerMutation() {
    this.evaluateAll();
  }

  // --- Rule 1: shadow work (batch) ---

  private evaluateShadowWork() {
    db.rawRun(`
            UPDATE external_signals 
            SET grace_expires_at = datetime(detected_at, CASE 
                WHEN source = 'SLACK' THEN '+2 hours'
                WHEN source = 'GITHUB' THEN '+12 hours'
                WHEN source = 'JIRA' THEN '+12 hours'
                ELSE '+6 hours' 
            END)
            WHERE grace_expires_at IS NULL AND state = 'UNVERIFIED'
        `);

    const expiredSignals = db.rawGet(`
            SELECT id, source, owner, content, grace_expires_at 
            FROM external_signals 
            WHERE state = 'UNVERIFIED' AND grace_expires_at < CURRENT_TIMESTAMP
        `);

    for (const signal of expiredSignals) {
      this.killExpiredSignal(signal);
    }
  }

  private evaluateShadowWorkForSignal(signalId: string) {
    db.rawRun(
      `
            UPDATE external_signals 
            SET grace_expires_at = datetime(detected_at, CASE 
                WHEN source = 'SLACK' THEN '+2 hours'
                WHEN source = 'GITHUB' THEN '+12 hours'
                WHEN source = 'JIRA' THEN '+12 hours'
                ELSE '+6 hours' 
            END)
            WHERE id = ? AND grace_expires_at IS NULL AND state = 'UNVERIFIED'
        `,
      [signalId],
    );

    const expiredSignals = db.rawGet(
      `
            SELECT id, source, owner, content, grace_expires_at 
            FROM external_signals 
            WHERE id = ? AND state = 'UNVERIFIED' AND grace_expires_at < CURRENT_TIMESTAMP
        `,
      [signalId],
    );

    for (const signal of expiredSignals) {
      this.killExpiredSignal(signal);
    }
  }

  private killExpiredSignal(signal: any) {
    db.rawRun("UPDATE external_signals SET state = 'KILLED' WHERE id = ?", [signal.id]);
    db.rawRun(
      "INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)",
      ["SIGNAL_KILLED", `Shadow work exceeded grace window: ${signal.source}`, signal.id],
    );

    db.rawRun(
      `
                UPDATE owner_reputation 
                SET failed_executions = failed_executions + 1, 
                    reputation_modifier = MAX(0.2, reputation_modifier - 0.1) 
                WHERE owner = ?
            `,
      [signal.owner],
    );

    console.log(`[Auditor] KILLED Shadow Work from ${signal.owner} (Source: ${signal.source})`);
  }

  // --- Rules 2 & 5: capacity + NO list (batch) ---

  private evaluateTasks() {
    const ownerRows = db.rawGet(
      `SELECT DISTINCT owner FROM execution_ledger WHERE status = 'ACTIVE'`,
    ) as { owner: string }[];
    for (const { owner } of ownerRows) {
      this.evaluateTasksForOwner(owner);
    }
  }

  private evaluateTasksForOwner(owner: string) {
    const { capacity } = db.getOwnerCapacity(owner);
    const activeTasks = db.rawGet(
      "SELECT task_id, weight, priority FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'",
      [owner],
    ) as { task_id: string; weight: number; priority: number }[];
    const currentLoad = activeTasks.reduce((acc: number, t: { weight: number }) => acc + t.weight, 0);

    if (currentLoad > capacity) {
      const suggestion = activeTasks.sort(
        (a: { priority: number; weight: number }, b: { priority: number; weight: number }) =>
          a.priority - b.priority || b.weight - a.weight,
      )[0];
      if (suggestion) {
        db.rawRun("INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)", [
          "KILL_SUGGESTION",
          `Capacity breached (${currentLoad.toFixed(2)}/${capacity.toFixed(2)}). Suggest killing this task to restore enforcement.`,
          suggestion.task_id,
        ]);
      }
    }

    const activeDecisions = db.rawGet(
      `
                SELECT DISTINCT d.id, d.constraints 
                FROM decision_ledger d
                JOIN execution_ledger e ON d.id = e.decision_id
                WHERE e.owner = ? AND e.status = 'ACTIVE'
            `,
      [owner],
    ) as { id: string; constraints: string }[];

    for (const decision of activeDecisions) {
      const noList = JSON.parse(decision.constraints || "[]");
      const tasks = db.rawGet(
        "SELECT task_id, success_condition FROM execution_ledger WHERE decision_id = ? AND status = 'ACTIVE'",
        [decision.id],
      ) as { task_id: string; success_condition: string }[];
      for (const task of tasks) {
        const violation = noList.find((forbidden: string) =>
          (task.success_condition || "").toLowerCase().includes(forbidden.toLowerCase()),
        );
        if (violation) {
          db.transitionExecutionState(
            task.task_id,
            "BLOCKED",
            `Constraint Violation: NO list forbids "${violation}"`,
            true,
          );
        }
      }
    }
  }

  // --- Rule 6: structural collapse (batch) ---

  private evaluateDecisions() {
    const activeDecisions = db.rawGet(
      "SELECT id, vow, confidence, status FROM decision_ledger WHERE status = 'ACTIVE'",
    ) as { id: string }[];
    for (const d of activeDecisions) {
      this.evaluateDecisionsForDecision(d.id);
    }
  }

  private evaluateDecisionsForDecision(decisionId: string) {
    const decision = db.rawGet(
      "SELECT id, status FROM decision_ledger WHERE id = ?",
      [decisionId],
    ) as { id: string; status: string }[];
    const d = decision[0];
    if (!d || d.status !== "ACTIVE") return;

    const stats = (
      db.rawGet(
        `
                SELECT 
                    count(*) as total, 
                    sum(CASE WHEN status IN ('KILLED', 'BLOCKED') THEN 1 ELSE 0 END) as failed 
                FROM execution_ledger 
                WHERE decision_id = ?
            `,
        [decisionId],
      ) as { total: number; failed: number | null }[]
    )[0];

    const total = Number(stats?.total ?? 0);
    const failed = Number(stats?.failed ?? 0);
    if (total > 0 && failed / total > 0.5) {
      db.rawRun("UPDATE decision_ledger SET status = 'UNDER_REVIEW' WHERE id = ?", [decisionId]);
      db.rawRun("INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)", [
        "DECISION_COLLAPSE",
        "Structural failure: >50% tasks failed or blocked",
        decisionId,
      ]);
      db.notifyLedgerAuditor({ type: "decision", decisionId });
    }
  }
}

export const auditor = new AuditorEngine();
