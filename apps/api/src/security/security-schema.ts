/**
 * V7 security schema — memory provenance, decision relationships, evidence graph, agent audit.
 * Called from database.initSchema(); idempotent CREATE IF NOT EXISTS + additive ALTERs.
 */

export function ensureSecuritySchema(dbExec: (sql: string) => void, ensureColumn: (table: string, name: string, ddl: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      author TEXT NOT NULL,
      observed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confidence REAL DEFAULT 0.5,
      verification_state TEXT DEFAULT 'UNVERIFIED'
        CHECK(verification_state IN ('UNVERIFIED', 'VERIFIED', 'SUPERSEDED', 'REVOKED', 'ARCHIVED')),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      block TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_memory_records_tenant ON memory_records(tenant_id, verification_state);
    CREATE INDEX IF NOT EXISTS idx_memory_records_hash ON memory_records(tenant_id, content_hash);

    CREATE TABLE IF NOT EXISTS memory_conflicts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      memory_a_id TEXT NOT NULL,
      memory_b_id TEXT NOT NULL,
      conflict_type TEXT DEFAULT 'contradiction',
      resolution_state TEXT DEFAULT 'OPEN'
        CHECK(resolution_state IN ('OPEN', 'RESOLVED', 'DISMISSED')),
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_by TEXT,
      notes TEXT,
      FOREIGN KEY(memory_a_id) REFERENCES memory_records(id),
      FOREIGN KEY(memory_b_id) REFERENCES memory_records(id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_conflicts_tenant ON memory_conflicts(tenant_id, resolution_state);

    CREATE TABLE IF NOT EXISTS decision_relationships (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      from_type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL
        CHECK(relationship_type IN ('SUPERSEDES', 'REVOKES', 'SUPPORTS', 'CONFLICTS_WITH', 'DEPENDS_ON')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decision_rel_tenant ON decision_relationships(tenant_id, relationship_type);
    CREATE INDEX IF NOT EXISTS idx_decision_rel_from ON decision_relationships(from_type, from_id);
    CREATE INDEX IF NOT EXISTS idx_decision_rel_to ON decision_relationships(to_type, to_id);

    CREATE TABLE IF NOT EXISTS evidence_nodes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      node_type TEXT NOT NULL
        CHECK(node_type IN ('fact', 'decision', 'task', 'meeting', 'signal', 'person', 'project', 'customer')),
      ref_id TEXT,
      label TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      verification_state TEXT DEFAULT 'UNVERIFIED',
      source_type TEXT,
      source_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_nodes_tenant ON evidence_nodes(tenant_id, node_type);

    CREATE TABLE IF NOT EXISTS evidence_edges (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL
        CHECK(edge_type IN ('CAUSED_BY', 'OBSERVED_IN', 'OWNED_BY', 'SUPPORTS', 'CONTRADICTS', 'SUPERSEDES')),
      confidence REAL DEFAULT 0.5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(from_node_id) REFERENCES evidence_nodes(id),
      FOREIGN KEY(to_node_id) REFERENCES evidence_nodes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_edges_tenant ON evidence_edges(tenant_id, edge_type);

    CREATE TABLE IF NOT EXISTS agent_action_audit (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      auth_kind TEXT,
      tool_name TEXT NOT NULL,
      permission TEXT,
      capability_jti TEXT,
      resource_id TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('ALLOWED', 'DENIED', 'ERROR')),
      denial_reason TEXT,
      args_preview TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_agent_action_audit_tenant ON agent_action_audit(tenant_id, created_at);
  `);

  ensureColumn("external_signals", "injection_classification", "TEXT");
  ensureColumn("external_signals", "resolution_state", "TEXT DEFAULT 'ACTIVE'");
  ensureColumn("external_signals", "superseded_by_signal_id", "TEXT");
  ensureColumn("decision_ledger", "lifecycle_state", "TEXT");
}
