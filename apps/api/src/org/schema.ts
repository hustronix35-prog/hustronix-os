/** First-class org structure for the Teams surface. Roster + ledger remain the people/work source. */

export function ensureOrgIntelligenceSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS org_teams (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_org_teams_user ON org_teams(user_id);

    CREATE TABLE IF NOT EXISTS org_dependencies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_team TEXT NOT NULL,
      from_work TEXT,
      to_team TEXT NOT NULL,
      to_work TEXT,
      status TEXT NOT NULL DEFAULT 'ON_TRACK'
        CHECK(status IN ('ON_TRACK','AT_RISK','DELAYED')),
      source TEXT NOT NULL DEFAULT 'manual'
        CHECK(source IN ('ledger','manual','inferred','pattern')),
      execution_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_org_deps_user ON org_dependencies(user_id);
    CREATE INDEX IF NOT EXISTS idx_org_deps_user_teams ON org_dependencies(user_id, from_team, to_team);

    CREATE TABLE IF NOT EXISTS org_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL
        CHECK(kind IN ('assignment','completion','membership','ownership','structure')),
      actor TEXT,
      summary TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_org_events_user ON org_events(user_id, created_at);

    CREATE TABLE IF NOT EXISTS org_health_snapshots (
      user_id TEXT NOT NULL,
      captured_on TEXT NOT NULL,
      health_pct INTEGER NOT NULL,
      PRIMARY KEY (user_id, captured_on)
    );
  `);
  try {
    dbExec(`ALTER TABLE team_roster ADD COLUMN reports_to TEXT`);
  } catch {
    /* already present */
  }
  try {
    dbExec(`ALTER TABLE org_dependencies ADD COLUMN edge_type TEXT`);
  } catch {
    /* already present */
  }
  try {
    dbExec(`ALTER TABLE org_dependencies ADD COLUMN evidence_json TEXT`);
  } catch {
    /* already present */
  }
  try {
    dbExec(`ALTER TABLE org_dependencies ADD COLUMN confidence_0_1 REAL`);
  } catch {
    /* already present */
  }
  try {
    dbExec(`ALTER TABLE org_dependencies ADD COLUMN situation_id TEXT`);
  } catch {
    /* already present */
  }
}
