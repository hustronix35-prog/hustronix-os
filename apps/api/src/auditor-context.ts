/**
 * Emitted after ledger / signal writes so the auditor can run scoped enforcement
 * (cron + POST /api/audit/run still use full sweeps as a safety net).
 */
export type AuditorWriteContext =
  | { type: "full" }
  | { type: "decision"; decisionId: string }
  | { type: "execution"; taskId: string }
  | { type: "signal"; signalId: string }
  | { type: "signal_link"; signalId: string; taskId: string };
