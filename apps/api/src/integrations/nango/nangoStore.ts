/**
 * Persist Nango connection IDs against Hustronix users.
 * Tokens stay in Nango; we only store the linkage + display metadata + sync cursors.
 * Evidence never lives here — only in external_signals.
 */

import { randomUUID } from "crypto";
import { db } from "../../database.js";

export type NangoConnectionRow = {
  id: string;
  user_id: string;
  provider: string;
  integration_id: string;
  connection_id: string;
  connection_name: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NangoSyncCursorRow = {
  connection_pk: string;
  model: string;
  cursor: string;
  updated_at: string;
};

/** Ensure additive columns / cursor table (idempotent). */
export function ensureNangoTables(): void {
  try {
    const cols = db.rawGet(`PRAGMA table_info(nango_connections)`) as {
      name: string;
    }[];
    if (cols?.length && !cols.some((c) => c.name === "last_sync_at")) {
      db.rawRun(
        `ALTER TABLE nango_connections ADD COLUMN last_sync_at DATETIME`,
      );
    }
  } catch (e) {
    console.warn(
      "[nangoStore] last_sync_at migrate:",
      e instanceof Error ? e.message : e,
    );
  }

  db.rawRun(`
    CREATE TABLE IF NOT EXISTS nango_sync_cursors (
      connection_pk TEXT NOT NULL,
      model TEXT NOT NULL,
      cursor TEXT NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (connection_pk, model)
    )
  `);
}

export function upsertNangoConnection(input: {
  userId: string;
  provider: string;
  integrationId: string;
  connectionId: string;
  connectionName?: string | null;
}): NangoConnectionRow {
  ensureNangoTables();
  const provider = input.provider.trim().toLowerCase();
  const existing = (
    db.rawGet(
      `SELECT id FROM nango_connections WHERE user_id = ? AND provider = ?`,
      [input.userId, provider],
    ) as { id: string }[]
  ).at(0);

  const id = existing?.id || randomUUID();
  const now = new Date().toISOString();
  if (existing) {
    db.rawRun(
      `UPDATE nango_connections
       SET integration_id = ?, connection_id = ?, connection_name = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.integrationId,
        input.connectionId,
        input.connectionName ?? null,
        now,
        id,
      ],
    );
  } else {
    db.rawRun(
      `INSERT INTO nango_connections
        (id, user_id, provider, integration_id, connection_id, connection_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.userId,
        provider,
        input.integrationId,
        input.connectionId,
        input.connectionName ?? null,
        now,
        now,
      ],
    );
  }
  return getNangoConnection(input.userId, provider)!;
}

export function getNangoConnection(
  userId: string,
  provider: string,
): NangoConnectionRow | null {
  return (
    (
      db.rawGet(
        `SELECT * FROM nango_connections WHERE user_id = ? AND provider = ?`,
        [userId, provider.trim().toLowerCase()],
      ) as NangoConnectionRow[]
    ).at(0) || null
  );
}

export function listNangoConnections(userId: string): NangoConnectionRow[] {
  return db.rawGet(
    `SELECT * FROM nango_connections WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId],
  ) as NangoConnectionRow[];
}

export function deleteNangoConnection(userId: string, provider: string): boolean {
  const row = getNangoConnection(userId, provider);
  if (row) {
    db.rawRun(`DELETE FROM nango_sync_cursors WHERE connection_pk = ?`, [row.id]);
  }
  const r = db.rawRun(
    `DELETE FROM nango_connections WHERE user_id = ? AND provider = ?`,
    [userId, provider.trim().toLowerCase()],
  ) as { changes?: number };
  return (r?.changes || 0) > 0;
}

export function findNangoConnectionByRemoteId(
  connectionId: string,
): NangoConnectionRow | null {
  return (
    (
      db.rawGet(`SELECT * FROM nango_connections WHERE connection_id = ?`, [
        connectionId,
      ]) as NangoConnectionRow[]
    ).at(0) || null
  );
}

export function touchNangoLastSync(connectionPk: string): void {
  ensureNangoTables();
  db.rawRun(
    `UPDATE nango_connections SET last_sync_at = ?, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), new Date().toISOString(), connectionPk],
  );
}

export function getSyncCursor(
  connectionPk: string,
  model: string,
): NangoSyncCursorRow | null {
  ensureNangoTables();
  return (
    (
      db.rawGet(
        `SELECT * FROM nango_sync_cursors WHERE connection_pk = ? AND model = ?`,
        [connectionPk, model],
      ) as NangoSyncCursorRow[]
    ).at(0) || null
  );
}

export function setSyncCursor(
  connectionPk: string,
  model: string,
  cursor: string,
): void {
  ensureNangoTables();
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO nango_sync_cursors (connection_pk, model, cursor, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(connection_pk, model) DO UPDATE SET
       cursor = excluded.cursor,
       updated_at = excluded.updated_at`,
    [connectionPk, model, cursor, now],
  );
}
