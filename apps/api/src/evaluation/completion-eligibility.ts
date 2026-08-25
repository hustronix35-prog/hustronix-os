/**
 * Slice 1: a decision becomes eligible for COMPLETED only when execution is
 * finished. Eligibility never completes the ledger — the operator must confirm.
 */
import { db } from "../database.js";

const OPEN_OR_FAILED = new Set(["PENDING", "ACTIVE", "BLOCKED", "KILLED"]);

export type CompletionEligibility = {
  eligible: boolean;
  reason: string;
  decisionStatus: string | null;
  taskCount: number;
  doneCount: number;
  openOrFailed: string[];
};

export function getDecisionCompletionEligibility(decisionId: string): CompletionEligibility {
  const row = db.getDecisionLedgerRow(decisionId);
  if (!row) {
    return {
      eligible: false,
      reason: "Decision not found.",
      decisionStatus: null,
      taskCount: 0,
      doneCount: 0,
      openOrFailed: [],
    };
  }
  const decisionStatus = String(row.status || "");
  const tasks = db.rawGet(`SELECT status FROM execution_ledger WHERE decision_id = ?`, [decisionId]) as {
    status: string;
  }[];
  const taskCount = tasks.length;
  const doneCount = tasks.filter((t) => String(t.status).toUpperCase() === "DONE").length;
  const openOrFailed = tasks
    .map((t) => String(t.status).toUpperCase())
    .filter((s) => OPEN_OR_FAILED.has(s));

  if (decisionStatus === "COMPLETED") {
    return {
      eligible: false,
      reason: "Decision is already COMPLETED.",
      decisionStatus,
      taskCount,
      doneCount,
      openOrFailed,
    };
  }
  if (decisionStatus !== "ACTIVE") {
    return {
      eligible: false,
      reason: `Decision is ${decisionStatus || "unknown"}, not ACTIVE.`,
      decisionStatus,
      taskCount,
      doneCount,
      openOrFailed,
    };
  }
  if (taskCount < 1) {
    return {
      eligible: false,
      reason: "No governed tasks on the execution ledger.",
      decisionStatus,
      taskCount,
      doneCount,
      openOrFailed,
    };
  }
  if (openOrFailed.length > 0 || doneCount !== taskCount) {
    const killed = openOrFailed.filter((s) => s === "KILLED").length;
    const open = openOrFailed.filter((s) => s !== "KILLED").length;
    const bits: string[] = [];
    if (open) bits.push(`${open} still open`);
    if (killed) bits.push(`${killed} killed`);
    return {
      eligible: false,
      reason: `Not eligible for COMPLETED — ${bits.join(", ") || "tasks unfinished"}.`,
      decisionStatus,
      taskCount,
      doneCount,
      openOrFailed,
    };
  }
  return {
    eligible: true,
    reason: "All governed tasks are DONE. Operator may confirm COMPLETED.",
    decisionStatus,
    taskCount,
    doneCount,
    openOrFailed,
  };
}

export function assertDecisionCompletable(decisionId: string): CompletionEligibility {
  const elig = getDecisionCompletionEligibility(decisionId);
  if (!elig.eligible) throw new Error(elig.reason);
  return elig;
}
