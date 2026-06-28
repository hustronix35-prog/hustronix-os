/**
 * Phase 1 entity registry schema — company brain entity layer.
 */
export function ensureEntitySchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL
        CHECK(type IN (
          'company', 'team', 'decision', 'task', 'customer', 'competitor',
          'metric', 'feature', 'commitment', 'meeting', 'person', 'project'
        )),
      label TEXT NOT NULL,
      ref_id TEXT,
      metadata_json TEXT DEFAULT '{}',
      confidence REAL DEFAULT 0.5,
      freshness_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_entities_tenant_type ON entities(tenant_id, type);
    CREATE INDEX IF NOT EXISTS idx_entities_tenant_ref ON entities(tenant_id, type, ref_id);
  `);
}
