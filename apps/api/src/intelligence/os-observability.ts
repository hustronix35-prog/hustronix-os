/**
 * Internal OS health: counts an operator can inspect without opening SQLite.
 */
import { db } from "../database.js";
import { DETECT_ENGINE_VERSION, countUnprocessedSignals } from "./signal-processing.js";

export type OsHealthSnapshot = {
  signals_ingested: number;
  signals_processed: number;
  signals_unprocessed: number;
  situations_created: number;
  situations_updated: number;
  situations_resolved: number;
  decisions_created: number;
  decisions_executed: number;
  decisions_completed: number;
  decisions_reversed: number;
  outcomes_evaluated: number;
  learning_updates: number;
  dependency_edges: number;
  last_detection_latency_ms: number | null;
  engine_version: string;
};

function n(sql: string, params: unknown[] = []): number {
  const row = (db.rawGet(sql, params) as { n: number }[])[0];
  return Number(row?.n || 0);
}

export function ensureOsEngineRunsSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS os_engine_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      scanned INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_os_engine_runs_kind ON os_engine_runs(kind, created_at);
  `);
}

export function recordEngineRun(opts: {
  userId: string;
  kind: string;
  latencyMs: number;
  scanned?: number;
}): void {
  try {
    db.rawRun(
      `INSERT INTO os_engine_runs (id, user_id, kind, latency_ms, scanned) VALUES (?, ?, ?, ?, ?)`,
      [
        `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        opts.userId,
        opts.kind,
        Math.max(0, Math.round(opts.latencyMs)),
        opts.scanned ?? null,
      ],
    );
  } catch {
    /* schema may not exist yet on a partial boot */
  }
}

export function osHealthSnapshot(userId?: string): OsHealthSnapshot {
  const tenant = userId && userId !== "system" ? userId : null;
  const u = tenant ? ` AND user_id = ?` : "";
  const p = tenant ? [tenant] : [];
  const last = (
    db.rawGet(
      `SELECT latency_ms FROM os_engine_runs WHERE kind = 'detect' ${
        tenant ? "AND user_id = ?" : ""
      } ORDER BY created_at DESC LIMIT 1`,
      tenant ? [tenant] : [],
    ) as { latency_ms: number }[]
  )[0];
  return {
    signals_ingested: n(`SELECT COUNT(1) AS n FROM external_signals WHERE 1=1${u}`, p),
    signals_processed: n(
      `SELECT COUNT(1) AS n FROM signal_processing sp
        INNER JOIN external_signals s ON s.id = sp.signal_id
       WHERE sp.engine_version = ?${tenant ? " AND s.user_id = ?" : ""}`,
      tenant ? [DETECT_ENGINE_VERSION, tenant] : [DETECT_ENGINE_VERSION],
    ),
    signals_unprocessed: tenant
      ? countUnprocessedSignals(tenant)
      : n(
          `SELECT COUNT(1) AS n FROM external_signals s
            LEFT JOIN signal_processing sp ON sp.signal_id = s.id AND sp.engine_version = ?
           WHERE sp.signal_id IS NULL`,
          [DETECT_ENGINE_VERSION],
        ),
    situations_created: n(`SELECT COUNT(1) AS n FROM situations WHERE 1=1${u}`, p),
    situations_updated: n(
      `SELECT COUNT(1) AS n FROM situations WHERE stage NOT IN ('RESOLVED')${u.replace(" AND", " AND")}`,
      p,
    ),
    situations_resolved: n(`SELECT COUNT(1) AS n FROM situations WHERE stage = 'RESOLVED'${u}`, p),
    decisions_created: n(`SELECT COUNT(1) AS n FROM decision_ledger WHERE 1=1${u}`, p),
    decisions_executed: n(`SELECT COUNT(1) AS n FROM decision_ledger WHERE status = 'ACTIVE'${u}`, p),
    decisions_completed: n(`SELECT COUNT(1) AS n FROM decision_ledger WHERE status = 'COMPLETED'${u}`, p),
    decisions_reversed: n(`SELECT COUNT(1) AS n FROM decision_ledger WHERE status = 'REVERSED'${u}`, p),
    outcomes_evaluated: n(
      tenant
        ? `SELECT COUNT(1) AS n FROM decision_outcomes WHERE tenant_id = ?`
        : `SELECT COUNT(1) AS n FROM decision_outcomes`,
      tenant ? [tenant] : [],
    ),
    learning_updates: n(
      tenant
        ? `SELECT COUNT(1) AS n FROM learning_log WHERE user_id = ?`
        : `SELECT COUNT(1) AS n FROM learning_log`,
      tenant ? [tenant] : [],
    ),
    dependency_edges: n(`SELECT COUNT(1) AS n FROM org_dependencies WHERE 1=1${u}`, p),
    last_detection_latency_ms: last?.latency_ms ?? null,
    engine_version: DETECT_ENGINE_VERSION,
  };
}
