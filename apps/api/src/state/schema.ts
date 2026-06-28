/**
 * Phase 1 organization state + doctrine schema.
 */
export function ensureStateSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS organization_state_versions (
      version INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      parent_version INTEGER,
      diff_from_parent_json TEXT,
      compiled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      trigger_event TEXT,
      author TEXT,
      PRIMARY KEY (tenant_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_org_state_versions_tenant
      ON organization_state_versions(tenant_id, version DESC);

    CREATE TABLE IF NOT EXISTS doctrine_rules (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      statement TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'guidance'
        CHECK(priority IN ('constitutional', 'guidance')),
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK(status IN ('ACTIVE', 'SUPERSEDED')),
      entity_scope TEXT DEFAULT 'org-wide',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_doctrine_rules_tenant
      ON doctrine_rules(tenant_id, status);

    CREATE TABLE IF NOT EXISTS domain_state_patches (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      domain TEXT NOT NULL
        CHECK(domain IN ('engineering', 'sales', 'marketing', 'coordinator')),
      section_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_domain_patches_tenant
      ON domain_state_patches(tenant_id, domain);

    CREATE TABLE IF NOT EXISTS decision_outcomes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      expected_json TEXT,
      actual_json TEXT,
      delta_score REAL,
      learning_notes TEXT,
      evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_decision_outcomes_decision
      ON decision_outcomes(decision_id);
  `);
}
