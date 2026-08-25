/**
 * Reconciliation schema — additive, idempotent.
 * Separate from V8 organizational_truth (narrative topic-hash layer).
 */
export function ensureReconciliationSchema(dbExec: (sql: string) => void): void {
  dbExec(`
    CREATE TABLE IF NOT EXISTS source_authority_rules (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source TEXT NOT NULL,
      claim_dimension TEXT NOT NULL,
      claim_predicate TEXT NOT NULL DEFAULT '*',
      authority REAL NOT NULL,
      reliability_prior REAL NOT NULL DEFAULT 0.7,
      freshness_half_life_hours REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(tenant_id, source, claim_dimension, claim_predicate)
    );
    CREATE INDEX IF NOT EXISTS idx_source_authority_lookup
      ON source_authority_rules(tenant_id, source, claim_dimension);

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_label TEXT,
      dimension TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value TEXT NOT NULL,
      state TEXT,
      intent TEXT NOT NULL
        CHECK(intent IN (
          'OBSERVATION','ASSERTION','PROPOSAL','DECISION',
          'COMMITMENT','PREDICTION','QUESTION','OPINION'
        )),
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK(status IN ('ACTIVE','SUPERSEDED','RETRACTED','MERGED')),
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence_score REAL,
      claim_key TEXT NOT NULL,
      first_seen_at DATETIME NOT NULL,
      last_seen_at DATETIME NOT NULL,
      superseded_by_claim_id TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_tenant_key
      ON claims(tenant_id, claim_key);
    CREATE INDEX IF NOT EXISTS idx_claims_entity_dim
      ON claims(tenant_id, entity_id, dimension, status);

    CREATE TABLE IF NOT EXISTS claim_evidence (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'SUPPORTS'
        CHECK(relationship IN ('SUPPORTS','CONTRADICTS','CONTEXT')),
      authority REAL,
      freshness REAL,
      reliability REAL,
      specificity REAL,
      directness REAL,
      score REAL NOT NULL,
      extractor TEXT NOT NULL DEFAULT 'heuristic'
        CHECK(extractor IN ('heuristic','llm','adapter','human')),
      extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(claim_id, signal_id, relationship)
    );
    CREATE INDEX IF NOT EXISTS idx_claim_evidence_signal ON claim_evidence(signal_id);
    CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim ON claim_evidence(claim_id);

    CREATE TABLE IF NOT EXISTS conflicts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      dimension TEXT NOT NULL,
      conflict_type TEXT NOT NULL
        CHECK(conflict_type IN (
          'STATE_MISMATCH','TEMPORAL_MISMATCH','AUTHORITY_MISMATCH',
          'STALE_SIGNAL','SEMANTIC_CONFLICT','PARTIAL_STATE','UNKNOWN'
        )),
      severity TEXT NOT NULL
        CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      confidence REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK(status IN ('OPEN','RESOLVED','COEXISTING','ESCALATED','DISMISSED')),
      claim_ids_json TEXT NOT NULL,
      causal_impact REAL,
      detected_at DATETIME NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decision_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conflicts_open
      ON conflicts(tenant_id, status, severity);
    CREATE INDEX IF NOT EXISTS idx_conflicts_entity_dim
      ON conflicts(tenant_id, entity_id, dimension, status);

    CREATE TABLE IF NOT EXISTS conflict_resolutions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      conflict_id TEXT NOT NULL,
      resolution_type TEXT NOT NULL
        CHECK(resolution_type IN (
          'SUPERSEDED','COEXIST','STALE','MERGED','HUMAN_DECISION','UNKNOWN'
        )),
      winning_claim_id TEXT,
      explanation TEXT NOT NULL,
      confidence REAL NOT NULL,
      resolved_by TEXT NOT NULL
        CHECK(resolved_by IN ('SYSTEM','USER','NEW_EVIDENCE')),
      supporting_evidence_json TEXT,
      resolved_at DATETIME NOT NULL,
      UNIQUE(conflict_id)
    );

    CREATE TABLE IF NOT EXISTS entity_state_snapshots (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      dimension TEXT NOT NULL,
      state TEXT NOT NULL,
      value TEXT,
      confidence REAL NOT NULL,
      winning_claim_id TEXT,
      supporting_claim_ids_json TEXT,
      contradicting_claim_ids_json TEXT,
      resolution_method TEXT,
      unknown_reason TEXT,
      last_updated_at DATETIME NOT NULL,
      UNIQUE(tenant_id, entity_id, dimension)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_state_tenant
      ON entity_state_snapshots(tenant_id, last_updated_at DESC);

    CREATE TABLE IF NOT EXISTS entity_aliases (
      tenant_id TEXT NOT NULL,
      alias_id TEXT NOT NULL,
      entity_ref_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, alias_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_canonical
      ON entity_aliases(tenant_id, entity_ref_id);
  `);
}
