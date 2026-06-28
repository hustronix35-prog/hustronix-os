/**
 * V8 enterprise schema — memory evidence, organizational truth, tenancy, approvals, security observability.
 * Idempotent; called after V7 security schema on boot.
 */
export function ensureV8EnterpriseSchema(
  dbExec: (sql: string) => void,
  ensureColumn: (table: string, name: string, ddl: string) => void,
) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS memory_evidence (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL
        CHECK(evidence_type IN ('signal', 'meeting', 'decision', 'email', 'user', 'task')),
      evidence_id TEXT NOT NULL,
      relationship TEXT DEFAULT 'SUPPORTS'
        CHECK(relationship IN ('SUPPORTS', 'CONTRADICTS', 'OBSERVED_IN')),
      confidence REAL DEFAULT 0.5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(fact_id) REFERENCES memory_records(id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_fact ON memory_evidence(fact_id);
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_tenant ON memory_evidence(tenant_id, evidence_type);

    CREATE TABLE IF NOT EXISTS organizational_truth_snapshots (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      workspace_id TEXT,
      topic_hash TEXT NOT NULL,
      active_statement TEXT NOT NULL,
      truth_confidence REAL NOT NULL,
      status TEXT DEFAULT 'ACTIVE'
        CHECK(status IN ('ACTIVE', 'SUPERSEDED', 'HISTORICAL', 'REVOKED')),
      supporting_evidence_json TEXT,
      contradicting_evidence_json TEXT,
      superseded_by_id TEXT,
      computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_truth_tenant_active ON organizational_truth_snapshots(tenant_id, status);

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(org_id) REFERENCES organizations(id),
      UNIQUE(org_id, slug)
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      org_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL
        CHECK(role IN ('owner', 'admin', 'strategist', 'operator', 'viewer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, user_id),
      FOREIGN KEY(org_id) REFERENCES organizations(id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

    CREATE TABLE IF NOT EXISTS pending_action_approvals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      workspace_id TEXT,
      actor_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      permission TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING'
        CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
      approved_by TEXT,
      approved_at DATETIME,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pending_approvals_actor ON pending_action_approvals(actor_id, status);

    CREATE TABLE IF NOT EXISTS security_events_v8 (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      tenant_id TEXT,
      workspace_id TEXT,
      result TEXT NOT NULL CHECK(result IN ('ALLOWED', 'DENIED', 'BLOCKED', 'ERROR')),
      risk_level TEXT NOT NULL CHECK(risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_security_events_v8_tenant ON security_events_v8(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_security_events_v8_risk ON security_events_v8(risk_level, created_at);

    CREATE TABLE IF NOT EXISTS ai_claim_validations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      claim_text TEXT NOT NULL,
      claim_hash TEXT NOT NULL,
      validation_state TEXT NOT NULL
        CHECK(validation_state IN ('PENDING', 'SUPPORTED', 'CONTRADICTED', 'AMBIGUOUS', 'REJECTED')),
      confidence REAL DEFAULT 0,
      evidence_json TEXT,
      contradiction_json TEXT,
      requires_human_review INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ai_claims_tenant ON ai_claim_validations(tenant_id, validation_state);
  `);

  ensureColumn("memory_records", "evidence_count", "INTEGER DEFAULT 0");
  ensureColumn("memory_records", "contradiction_count", "INTEGER DEFAULT 0");
  ensureColumn("memory_records", "created_by", "TEXT");
  ensureColumn("memory_records", "updated_by", "TEXT");
  ensureColumn("external_signals", "workspace_id", "TEXT");
  ensureColumn("decision_ledger", "workspace_id", "TEXT");
  ensureColumn("decision_ledger", "approved_by", "TEXT");
  ensureColumn("decision_ledger", "activated_at", "DATETIME");
}
