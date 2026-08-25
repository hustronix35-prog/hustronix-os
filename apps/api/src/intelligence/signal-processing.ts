/**
 * Incremental detection processing state.
 * New signals → mark processed after the engine has seen them.
 */
import { db } from "../database.js";

export const DETECT_ENGINE_VERSION = "progressive-2026-08-18";

export function ensureSignalProcessingSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS signal_processing (
      signal_id TEXT NOT NULL,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      engine_version TEXT NOT NULL,
      PRIMARY KEY (signal_id, engine_version)
    );
    CREATE INDEX IF NOT EXISTS idx_signal_processing_version
      ON signal_processing(engine_version, processed_at);
  `);
}

export function markSignalsProcessed(signalIds: string[], engineVersion = DETECT_ENGINE_VERSION): void {
  const now = new Date().toISOString();
  for (const id of signalIds) {
    if (!id) continue;
    try {
      db.rawRun(
        `INSERT INTO signal_processing (signal_id, processed_at, engine_version)
         VALUES (?, ?, ?)
         ON CONFLICT(signal_id, engine_version) DO UPDATE SET processed_at = excluded.processed_at`,
        [id, now, engineVersion],
      );
    } catch {
      try {
        db.rawRun(
          `INSERT OR REPLACE INTO signal_processing (signal_id, processed_at, engine_version) VALUES (?, ?, ?)`,
          [id, now, engineVersion],
        );
      } catch {
        /* ignore */
      }
    }
  }
}

export function countUnprocessedSignals(userId: string, engineVersion = DETECT_ENGINE_VERSION): number {
  const row = (
    db.rawGet(
      `SELECT COUNT(1) AS n
         FROM external_signals s
         LEFT JOIN signal_processing sp
           ON sp.signal_id = s.id AND sp.engine_version = ?
        WHERE s.user_id = ?
          AND s.state IN ('UNVERIFIED','GRACE','LINKED')
          AND sp.signal_id IS NULL`,
      [engineVersion, userId],
    ) as { n: number }[]
  )[0];
  return Number(row?.n || 0);
}
