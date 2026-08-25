/** Authorized side effects for ACTIVE decisions — intent, policy, dispatch, confirmation. */
export function ensureActionLedgerSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS action_ledger (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      execution_id TEXT,
      run_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_system TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      intent_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      owner TEXT,
      risk TEXT NOT NULL CHECK(risk IN ('LOW','MEDIUM','HIGH')),
      policy_result TEXT NOT NULL CHECK(policy_result IN ('ALLOW','REQUIRE_APPROVAL','DENY')),
      status TEXT NOT NULL CHECK(status IN (
        'QUEUED','AWAITING_APPROVAL','AUTHORIZED','COMPLETED','DENIED','BLOCKED_CONNECTOR','FAILED','SKIPPED'
      )),
      authorization TEXT,
      external_id TEXT,
      error TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_action_ledger_idempotency
      ON action_ledger(org_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_action_ledger_decision
      ON action_ledger(decision_id, requested_at);
    CREATE INDEX IF NOT EXISTS idx_action_ledger_run
      ON action_ledger(run_id);
  `);
}
