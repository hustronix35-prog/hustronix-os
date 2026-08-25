/** Situation objects — progressive intelligence between signals and decisions. */

type SqliteLike = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown;
  };
};

export function ensureSituationSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS situations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pattern_id TEXT NOT NULL,
      title TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'AWARENESS'
        CHECK(stage IN ('AWARENESS','FORMING','ELEVATED','DECISION_READY','DECIDED','RESOLVED')),
      confidence REAL NOT NULL DEFAULT 0.3,
      trajectory TEXT NOT NULL DEFAULT 'STABLE'
        CHECK(trajectory IN ('IMPROVING','STABLE','WORSENING')),
      first_observed_day INTEGER,
      last_updated_day INTEGER,
      awareness_day INTEGER,
      forming_day INTEGER,
      elevated_day INTEGER,
      decision_ready_day INTEGER,
      decision_id TEXT,
      potential_impact TEXT,
      recommended_actions_json TEXT,
      entities_json TEXT,
      people_json TEXT,
      teams_json TEXT,
      facets_json TEXT,
      sources_json TEXT,
      timeline_json TEXT,
      readiness_score REAL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      explanation TEXT,
      primary_entity_key TEXT NOT NULL DEFAULT '',
      primary_entity_type TEXT,
      primary_entity_label TEXT,
      causal_cluster TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, pattern_id, primary_entity_key, causal_cluster)
    );
    CREATE INDEX IF NOT EXISTS idx_situations_user ON situations(user_id, stage);
    CREATE INDEX IF NOT EXISTS idx_situations_identity_lookup
      ON situations(user_id, pattern_id, primary_entity_key);

    CREATE TABLE IF NOT EXISTS situation_evidence (
      id TEXT PRIMARY KEY,
      situation_id TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      facet TEXT,
      weight REAL NOT NULL DEFAULT 1.0,
      sim_day INTEGER,
      snippet TEXT,
      attach_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(situation_id, signal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_situation_evidence_sit ON situation_evidence(situation_id);
    CREATE INDEX IF NOT EXISTS idx_situation_evidence_sig ON situation_evidence(signal_id);

    CREATE TABLE IF NOT EXISTS situation_events (
      id TEXT PRIMARY KEY,
      situation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT,
      sim_day INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_situation_events_sit ON situation_events(situation_id);
  `);

  for (const col of [
    "ALTER TABLE situations ADD COLUMN sources_json TEXT",
    "ALTER TABLE situations ADD COLUMN timeline_json TEXT",
    "ALTER TABLE situations ADD COLUMN readiness_score REAL DEFAULT 0",
    "ALTER TABLE situations ADD COLUMN primary_entity_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE situations ADD COLUMN primary_entity_type TEXT",
    "ALTER TABLE situations ADD COLUMN primary_entity_label TEXT",
    "ALTER TABLE situations ADD COLUMN causal_cluster TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE situation_evidence ADD COLUMN attach_reason TEXT",
  ]) {
    try {
      dbExec(col);
    } catch {
      /* already present */
    }
  }
}

/**
 * Identity is tenant + pattern + primary entity. Legacy UNIQUE(user_id, pattern_id)
 * collides Acme/Northstar churn into one row — rebuild that constraint once.
 */
export function migrateSituationIdentity(sqlite: SqliteLike) {
  try {
    sqlite.exec(`ALTER TABLE situations ADD COLUMN primary_entity_key TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* already present */
  }
  try {
    sqlite.exec(`ALTER TABLE situations ADD COLUMN primary_entity_type TEXT`);
  } catch {
    /* already present */
  }
  try {
    sqlite.exec(`ALTER TABLE situations ADD COLUMN primary_entity_label TEXT`);
  } catch {
    /* already present */
  }

  try {
    sqlite.exec(`
      UPDATE situations
         SET primary_entity_key = COALESCE((
           SELECT se.entity_key FROM situation_entities se
           WHERE se.situation_id = situations.id
             AND se.entity_type IN ('customer','product','project')
           ORDER BY se.mention_count DESC
           LIMIT 1
         ), primary_entity_key, '')
       WHERE IFNULL(primary_entity_key, '') = ''
    `);
  } catch {
    /* situation_entities may not exist yet */
  }

  const master = sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='situations'`).get() as
    | { sql: string }
    | undefined;
  const sql = master?.sql || "";
  if (/UNIQUE\s*\(\s*user_id\s*,\s*pattern_id\s*,\s*primary_entity_key\s*,\s*causal_cluster\s*\)/i.test(sql)) return;
  if (/UNIQUE\s*\(\s*user_id\s*,\s*pattern_id\s*,\s*primary_entity_key\s*\)/i.test(sql)) return;
  if (!/UNIQUE\s*\(\s*user_id\s*,\s*pattern_id\s*\)/i.test(sql)) {
    try {
      sqlite.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_situations_identity ON situations(user_id, pattern_id, primary_entity_key)`,
      );
    } catch {
      /* ignore */
    }
    return;
  }

  sqlite.exec(`
    CREATE TABLE situations_identity_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pattern_id TEXT NOT NULL,
      title TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'AWARENESS'
        CHECK(stage IN ('AWARENESS','FORMING','ELEVATED','DECISION_READY','DECIDED','RESOLVED')),
      confidence REAL NOT NULL DEFAULT 0.3,
      trajectory TEXT NOT NULL DEFAULT 'STABLE'
        CHECK(trajectory IN ('IMPROVING','STABLE','WORSENING')),
      first_observed_day INTEGER,
      last_updated_day INTEGER,
      awareness_day INTEGER,
      forming_day INTEGER,
      elevated_day INTEGER,
      decision_ready_day INTEGER,
      decision_id TEXT,
      potential_impact TEXT,
      recommended_actions_json TEXT,
      entities_json TEXT,
      people_json TEXT,
      teams_json TEXT,
      facets_json TEXT,
      sources_json TEXT,
      timeline_json TEXT,
      readiness_score REAL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      explanation TEXT,
      primary_entity_key TEXT NOT NULL DEFAULT '',
      primary_entity_type TEXT,
      primary_entity_label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, pattern_id, primary_entity_key)
    );
  `);
  sqlite.exec(`
    INSERT INTO situations_identity_v2 (
      id, user_id, pattern_id, title, stage, confidence, trajectory,
      first_observed_day, last_updated_day, awareness_day, forming_day, elevated_day,
      decision_ready_day, decision_id, potential_impact, recommended_actions_json,
      entities_json, people_json, teams_json, facets_json, sources_json, timeline_json,
      readiness_score, evidence_count, explanation,
      primary_entity_key, primary_entity_type, primary_entity_label,
      created_at, updated_at
    )
    SELECT
      id, user_id, pattern_id, title, stage, confidence, trajectory,
      first_observed_day, last_updated_day, awareness_day, forming_day, elevated_day,
      decision_ready_day, decision_id, potential_impact, recommended_actions_json,
      entities_json, people_json, teams_json, facets_json, sources_json, timeline_json,
      readiness_score, evidence_count, explanation,
      COALESCE(primary_entity_key, ''), primary_entity_type, primary_entity_label,
      created_at, updated_at
    FROM situations
  `);
  sqlite.exec(`DROP TABLE situations`);
  sqlite.exec(`ALTER TABLE situations_identity_v2 RENAME TO situations`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_situations_user ON situations(user_id, stage)`);
}

/**
 * Identity is tenant + pattern + primary entity + causal cluster.
 * Parallel stories (Acme renewal vs Acme implementation) must not share one row.
 */
export function migrateSituationFingerprint(sqlite: SqliteLike) {
  try {
    sqlite.exec(`ALTER TABLE situations ADD COLUMN causal_cluster TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* already present */
  }
  try {
    sqlite.exec(`DROP INDEX IF EXISTS idx_situations_identity`);
  } catch {
    /* ignore */
  }

  const master = sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='situations'`).get() as
    | { sql: string }
    | undefined;
  const sql = master?.sql || "";
  if (/UNIQUE\s*\(\s*user_id\s*,\s*pattern_id\s*,\s*primary_entity_key\s*,\s*causal_cluster\s*\)/i.test(sql)) {
    return;
  }
  if (!/UNIQUE\s*\(\s*user_id\s*,\s*pattern_id\s*,\s*primary_entity_key\s*\)/i.test(sql)) {
    try {
      sqlite.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_situations_fingerprint
         ON situations(user_id, pattern_id, primary_entity_key, causal_cluster)`,
      );
    } catch {
      /* ignore */
    }
    return;
  }

  sqlite.exec(`
    CREATE TABLE situations_fingerprint_v3 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pattern_id TEXT NOT NULL,
      title TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'AWARENESS'
        CHECK(stage IN ('AWARENESS','FORMING','ELEVATED','DECISION_READY','DECIDED','RESOLVED')),
      confidence REAL NOT NULL DEFAULT 0.3,
      trajectory TEXT NOT NULL DEFAULT 'STABLE'
        CHECK(trajectory IN ('IMPROVING','STABLE','WORSENING')),
      first_observed_day INTEGER,
      last_updated_day INTEGER,
      awareness_day INTEGER,
      forming_day INTEGER,
      elevated_day INTEGER,
      decision_ready_day INTEGER,
      decision_id TEXT,
      potential_impact TEXT,
      recommended_actions_json TEXT,
      entities_json TEXT,
      people_json TEXT,
      teams_json TEXT,
      facets_json TEXT,
      sources_json TEXT,
      timeline_json TEXT,
      readiness_score REAL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      explanation TEXT,
      primary_entity_key TEXT NOT NULL DEFAULT '',
      primary_entity_type TEXT,
      primary_entity_label TEXT,
      causal_cluster TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, pattern_id, primary_entity_key, causal_cluster)
    );
  `);
  sqlite.exec(`
    INSERT INTO situations_fingerprint_v3 (
      id, user_id, pattern_id, title, stage, confidence, trajectory,
      first_observed_day, last_updated_day, awareness_day, forming_day, elevated_day,
      decision_ready_day, decision_id, potential_impact, recommended_actions_json,
      entities_json, people_json, teams_json, facets_json, sources_json, timeline_json,
      readiness_score, evidence_count, explanation,
      primary_entity_key, primary_entity_type, primary_entity_label, causal_cluster,
      created_at, updated_at
    )
    SELECT
      id, user_id, pattern_id, title, stage, confidence, trajectory,
      first_observed_day, last_updated_day, awareness_day, forming_day, elevated_day,
      decision_ready_day, decision_id, potential_impact, recommended_actions_json,
      entities_json, people_json, teams_json, facets_json, sources_json, timeline_json,
      readiness_score, evidence_count, explanation,
      COALESCE(primary_entity_key, ''), primary_entity_type, primary_entity_label,
      COALESCE(causal_cluster, ''),
      created_at, updated_at
    FROM situations
  `);
  sqlite.exec(`DROP TABLE situations`);
  sqlite.exec(`ALTER TABLE situations_fingerprint_v3 RENAME TO situations`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_situations_user ON situations(user_id, stage)`);
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_situations_identity_lookup ON situations(user_id, pattern_id, primary_entity_key)`,
  );
}
