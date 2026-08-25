/**
 * Situation entity/event graph — bind signals to canonical entities,
 * then situations operate over shared entities (not isolated keyword hits).
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { extractEntities, type ExtractedEntity } from "./entity-resolver.js";

export function ensureSituationGraphSchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS situation_entities (
      id TEXT PRIMARY KEY,
      situation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      entity_label TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      first_seen_day INTEGER,
      last_seen_day INTEGER,
      mention_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(situation_id, entity_key)
    );
    CREATE INDEX IF NOT EXISTS idx_sit_ent_user ON situation_entities(user_id, entity_key);

    CREATE TABLE IF NOT EXISTS signal_entities (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      entity_label TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      sim_day INTEGER,
      UNIQUE(signal_id, entity_key)
    );
    CREATE INDEX IF NOT EXISTS idx_sig_ent_user_key ON signal_entities(user_id, entity_key);
    CREATE INDEX IF NOT EXISTS idx_sig_ent_signal ON signal_entities(signal_id);

    CREATE TABLE IF NOT EXISTS entity_cooccurrence (
      user_id TEXT NOT NULL,
      entity_a TEXT NOT NULL,
      entity_b TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      last_day INTEGER,
      PRIMARY KEY (user_id, entity_a, entity_b)
    );
  `);
}

export function indexSignalEntities(
  userId: string,
  signalId: string,
  content: string,
  simDay: number | null,
): ExtractedEntity[] {
  const ents = extractEntities(content);
  for (const e of ents) {
    const existing = (
      db.rawGet(`SELECT id FROM signal_entities WHERE signal_id = ? AND entity_key = ?`, [
        signalId,
        e.key,
      ]) as { id: string }[]
    )[0];
    if (existing) continue;
    db.rawRun(
      `INSERT INTO signal_entities (id, signal_id, user_id, entity_key, entity_label, entity_type, sim_day)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), signalId, userId, e.key, e.label, e.type, simDay],
    );
  }
  // Co-occurrence within this signal
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const a = ents[i].key < ents[j].key ? ents[i].key : ents[j].key;
      const b = ents[i].key < ents[j].key ? ents[j].key : ents[i].key;
      db.rawRun(
        `INSERT INTO entity_cooccurrence (user_id, entity_a, entity_b, weight, last_day)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(user_id, entity_a, entity_b) DO UPDATE SET
           weight = weight + 1,
           last_day = COALESCE(excluded.last_day, last_day)`,
        [userId, a, b, simDay],
      );
    }
  }
  return ents;
}

export function linkEntitiesToSituation(
  userId: string,
  situationId: string,
  ents: ExtractedEntity[],
  simDay: number | null,
): void {
  for (const e of ents) {
    const row = (
      db.rawGet(
        `SELECT id, mention_count FROM situation_entities WHERE situation_id = ? AND entity_key = ?`,
        [situationId, e.key],
      ) as { id: string; mention_count: number }[]
    )[0];
    if (row) {
      db.rawRun(
        `UPDATE situation_entities SET mention_count = mention_count + 1,
           last_seen_day = COALESCE(?, last_seen_day) WHERE id = ?`,
        [simDay, row.id],
      );
    } else {
      db.rawRun(
        `INSERT INTO situation_entities
          (id, situation_id, user_id, entity_key, entity_label, entity_type, first_seen_day, last_seen_day, mention_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [uuidv4(), situationId, userId, e.key, e.label, e.type, simDay, simDay],
      );
    }
  }
}

export function situationEntityKeys(situationId: string): Set<string> {
  const rows = db.rawGet(
    `SELECT entity_key FROM situation_entities WHERE situation_id = ?`,
    [situationId],
  ) as { entity_key: string }[];
  return new Set(rows.map((r) => r.entity_key));
}

export function situationPrimaryEntityKeys(situationId: string): Set<string> {
  const rows = db.rawGet(
    `SELECT entity_key FROM situation_entities
     WHERE situation_id = ? AND entity_type IN ('customer','product','project')`,
    [situationId],
  ) as { entity_key: string }[];
  return new Set(rows.map((r) => r.entity_key));
}

export function situationEntityLabels(situationId: string): string[] {
  const rows = db.rawGet(
    `SELECT entity_label, entity_type, mention_count FROM situation_entities
     WHERE situation_id = ? ORDER BY mention_count DESC LIMIT 24`,
    [situationId],
  ) as { entity_label: string; entity_type: string; mention_count: number }[];
  return rows.map((r) => `${r.entity_label} (${r.entity_type})`);
}

/** Neighbor entities that co-occurred with any situation entity (1-hop). */
export function situationNeighborhood(userId: string, situationId: string): Set<string> {
  const keys = [...situationEntityKeys(situationId)];
  const out = new Set(keys);
  if (!keys.length) return out;
  const placeholders = keys.map(() => "?").join(",");
  const rows = db.rawGet(
    `SELECT entity_a, entity_b FROM entity_cooccurrence
     WHERE user_id = ? AND (entity_a IN (${placeholders}) OR entity_b IN (${placeholders}))`,
    [userId, ...keys, ...keys],
  ) as { entity_a: string; entity_b: string }[];
  for (const r of rows) {
    out.add(r.entity_a);
    out.add(r.entity_b);
  }
  return out;
}

export function signalSharesSituationEntity(
  signalId: string,
  situationKeys: Set<string>,
): boolean {
  if (!situationKeys.size) return false;
  const rows = db.rawGet(`SELECT entity_key FROM signal_entities WHERE signal_id = ?`, [
    signalId,
  ]) as { entity_key: string }[];
  return rows.some((r) => situationKeys.has(r.entity_key));
}

export function signalInNeighborhood(
  signalId: string,
  neighborhood: Set<string>,
): boolean {
  if (!neighborhood.size) return false;
  const rows = db.rawGet(`SELECT entity_key FROM signal_entities WHERE signal_id = ?`, [
    signalId,
  ]) as { entity_key: string }[];
  return rows.some((r) => neighborhood.has(r.entity_key));
}
