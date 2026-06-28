/** Phase 5 causal simulation run persistence. */
export function ensureSimulationSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS simulation_runs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      decision_id TEXT,
      input_graph_hash TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_projection_json TEXT NOT NULL,
      risk_score REAL DEFAULT 0,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_simulation_runs_tenant ON simulation_runs(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_simulation_runs_decision ON simulation_runs(decision_id);
  `);
}
