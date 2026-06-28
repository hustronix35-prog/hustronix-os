/** Phase 4 belief engine schema. */
export function ensureBeliefSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS beliefs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entity_id TEXT,
      statement TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'PROPOSED'
        CHECK(status IN ('PROPOSED', 'CONFIRMED', 'REFUTED', 'SUPERSEDED')),
      evidence_count INTEGER DEFAULT 0,
      contradiction_count INTEGER DEFAULT 0,
      factors_json TEXT DEFAULT '{}',
      source_decision_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_beliefs_tenant ON beliefs(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_beliefs_entity ON beliefs(tenant_id, entity_id);

    CREATE TABLE IF NOT EXISTS belief_evidence (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      belief_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL
        CHECK(evidence_type IN ('signal', 'fact', 'decision', 'meeting', 'belief', 'entity')),
      evidence_id TEXT NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'SUPPORTS'
        CHECK(relationship IN ('SUPPORTS', 'CONTRADICTS', 'OBSERVED_IN')),
      confidence REAL DEFAULT 0.5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(belief_id) REFERENCES beliefs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_belief_evidence_belief ON belief_evidence(belief_id);
  `);
}
