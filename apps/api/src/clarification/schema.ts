/** Exception-channel clarification requests — workflow objects, not chat memory. */
export function ensureClarificationSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS clarification_requests (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      decision_id TEXT,
      user_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      owner_user_id TEXT,
      trigger TEXT NOT NULL
        CHECK(trigger IN ('BLOCKED','STALE','MISSING_FIELD','CONFLICT','DEPENDENCY_UNCLEAR','OWNER_UNCLEAR')),
      question_type TEXT NOT NULL
        CHECK(question_type IN ('STATUS','ETA','BLOCKER','FACT','DEPENDENCY','OWNERSHIP')),
      question TEXT NOT NULL,
      reason TEXT NOT NULL,
      requested_fields TEXT,
      trigger_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK(status IN ('OPEN','ANSWERED','COMMITTED','DISMISSED','EXPIRED')),
      answer TEXT,
      extracted_claims TEXT,
      proposed_mutations TEXT,
      committed_mutations TEXT,
      rejected_claims TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      answered_at DATETIME,
      committed_at DATETIME,
      FOREIGN KEY(task_id) REFERENCES execution_ledger(task_id)
    );
    CREATE INDEX IF NOT EXISTS idx_clarification_user_status
      ON clarification_requests(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_clarification_task_status
      ON clarification_requests(task_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clarification_one_open
      ON clarification_requests(task_id) WHERE status = 'OPEN';
  `);
}
