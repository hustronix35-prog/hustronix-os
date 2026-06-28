/**
 * V9 trust schema — capability replay prevention, memory provenance, emergency overrides, dual-control.
 */
export function ensureV9TrustSchema(
  dbExec: (sql: string) => void,
  ensureColumn: (table: string, name: string, ddl: string) => void,
) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS capability_jti_log (
      jti TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      permission TEXT NOT NULL,
      issued_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME,
      consumed INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_capability_jti_tenant ON capability_jti_log(tenant_id, consumed);

    CREATE TABLE IF NOT EXISTS memory_provenance_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      fact_id TEXT,
      event_type TEXT NOT NULL
        CHECK(event_type IN (
          'ORIGIN', 'VALIDATION', 'HUMAN_REVIEW', 'CONTRADICTION',
          'VERIFICATION', 'TRUST_CHANGE', 'REVOCATION'
        )),
      actor_id TEXT,
      source_type TEXT,
      source_id TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_memory_provenance_fact ON memory_provenance_events(fact_id, created_at);

    CREATE TABLE IF NOT EXISTS emergency_overrides (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      resource_id TEXT,
      reason TEXT NOT NULL,
      review_status TEXT DEFAULT 'PENDING'
        CHECK(review_status IN ('PENDING', 'REVIEWED', 'ESCALATED')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_emergency_overrides_tenant ON emergency_overrides(tenant_id, review_status);

    CREATE TABLE IF NOT EXISTS truth_recompute_queue (
      tenant_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      scheduled_at DATETIME NOT NULL,
      last_computed_at DATETIME
    );
  `);

  ensureColumn("pending_action_approvals", "second_approved_by", "TEXT");
  ensureColumn("pending_action_approvals", "second_approved_at", "DATETIME");
  ensureColumn("pending_action_approvals", "emergency_override_id", "TEXT");
  ensureColumn("memory_records", "workspace_id", "TEXT");
  ensureColumn("ai_claim_validations", "weighted_score", "REAL DEFAULT 0");
  ensureColumn("ai_claim_validations", "source_diversity", "INTEGER DEFAULT 0");
}
