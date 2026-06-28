import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";

export type MemoryVerificationState =
  | "UNVERIFIED"
  | "VERIFIED"
  | "SUPERSEDED"
  | "REVOKED"
  | "ARCHIVED";

export type MemorySourceType =
  | "user_chat"
  | "agent_tool"
  | "slack"
  | "email"
  | "meeting"
  | "manual"
  | "system";

export interface MemoryRecordInput {
  tenantId: string;
  sourceType: MemorySourceType;
  sourceId?: string | null;
  author: string;
  content: string;
  confidence?: number;
  verificationState?: MemoryVerificationState;
  block?: string | null;
  observedAt?: string;
}

export interface MemoryRecordRow {
  id: string;
  tenant_id: string;
  source_type: string;
  source_id: string | null;
  author: string;
  observed_at: string;
  confidence: number;
  verification_state: MemoryVerificationState;
  content: string;
  content_hash: string;
  block: string | null;
  created_at: string;
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content.trim().toLowerCase()).digest("hex");
}

function tokenSet(s: string): Set<string> {
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  );
}

function contradictionScore(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = overlap / union;
  if (jaccard < 0.25) return 0;

  const negA = /\b(not|no|never|delay|cancel|postpone|wait|stop|revoke|deny)\b/i.test(a);
  const negB = /\b(not|no|never|delay|cancel|postpone|wait|stop|revoke|deny)\b/i.test(b);
  const posA = /\b(approve|launch|proceed|yes|commit|go ahead|will do)\b/i.test(a);
  const posB = /\b(approve|launch|proceed|yes|commit|go ahead|will do)\b/i.test(b);
  if ((negA && posB) || (negB && posA)) return 0.85;
  if (negA !== negB && jaccard >= 0.35) return 0.7;
  return jaccard >= 0.5 ? 0.4 : 0;
}

export function insertMemoryRecord(input: MemoryRecordInput): MemoryRecordRow {
  const id = uuidv4();
  const hash = contentHash(input.content);
  const confidence = Math.max(0, Math.min(1, input.confidence ?? 0.5));
  const state = input.verificationState ?? "UNVERIFIED";

  db.rawRun(
    `INSERT INTO memory_records (
      id, tenant_id, source_type, source_id, author, observed_at,
      confidence, verification_state, content, content_hash, block
    ) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.sourceType,
      input.sourceId ?? null,
      input.author,
      input.observedAt ?? null,
      confidence,
      state,
      input.content,
      hash,
      input.block ?? null,
    ],
  );

  detectAndRecordMemoryConflicts(input.tenantId, id, input.content);

  const row = db
    .rawGet(`SELECT * FROM memory_records WHERE id = ?`, [id])
    .at(0) as MemoryRecordRow | undefined;
  if (!row) throw new Error("Failed to persist memory record.");
  return row;
}

function detectAndRecordMemoryConflicts(tenantId: string, newId: string, content: string): void {
  const peers = db.rawGet(
    `SELECT id, content FROM memory_records
     WHERE tenant_id = ? AND verification_state NOT IN ('REVOKED', 'ARCHIVED', 'SUPERSEDED')
     AND id != ?
     ORDER BY observed_at DESC LIMIT 50`,
    [tenantId, newId],
  ) as { id: string; content: string }[];

  for (const peer of peers) {
    const score = contradictionScore(content, peer.content);
    if (score < 0.65) continue;
    const conflictId = uuidv4();
    db.rawRun(
      `INSERT INTO memory_conflicts (id, tenant_id, memory_a_id, memory_b_id, conflict_type, notes)
       VALUES (?, ?, ?, ?, 'contradiction', ?)`,
      [
        conflictId,
        tenantId,
        newId,
        peer.id,
        `Auto-detected contradiction (score=${score.toFixed(2)})`,
      ],
    );
    db.rawRun(
      `INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`,
      ["MEMORY_CONFLICT_DETECTED", `conflict=${conflictId}`, newId],
    );
  }
}

export function listMemoryRecords(tenantId: string, limit = 100): MemoryRecordRow[] {
  return db.rawGet(
    `SELECT * FROM memory_records WHERE tenant_id = ?
     ORDER BY observed_at DESC LIMIT ?`,
    [tenantId, limit],
  ) as MemoryRecordRow[];
}

export function listOpenMemoryConflicts(tenantId: string): Array<{
  id: string;
  memory_a_id: string;
  memory_b_id: string;
  notes: string | null;
}> {
  return db.rawGet(
    `SELECT id, memory_a_id, memory_b_id, notes FROM memory_conflicts
     WHERE tenant_id = ? AND resolution_state = 'OPEN'
     ORDER BY detected_at DESC`,
    [tenantId],
  ) as Array<{ id: string; memory_a_id: string; memory_b_id: string; notes: string | null }>;
}

export function getVerifiedMemoryForPrompt(tenantId: string, block?: string): string {
  const params: unknown[] = [tenantId];
  let sql = `SELECT content, author, source_type, observed_at, confidence, verification_state
             FROM memory_records
             WHERE tenant_id = ? AND verification_state IN ('UNVERIFIED', 'VERIFIED')`;
  if (block) {
    sql += ` AND block = ?`;
    params.push(block);
  }
  sql += ` ORDER BY observed_at DESC LIMIT 40`;
  const rows = db.rawGet(sql, params) as Array<{
    content: string;
    author: string;
    source_type: string;
    observed_at: string;
    confidence: number;
    verification_state: string;
  }>;
  if (!rows.length) return "";
  return rows
    .map(
      (r) =>
        `- [${r.verification_state}|conf=${r.confidence.toFixed(2)}|${r.source_type}|${r.author}|${r.observed_at}] ${r.content}`,
    )
    .join("\n");
}

/** Backward-compatible core_memory projection from provenance records. */
export function syncCoreMemoryProjection(tenantId: string, block: string): void {
  const projection = getVerifiedMemoryForPrompt(tenantId, block);
  db.updateCoreMemory(tenantId, block, projection);
}

export interface MemoryGcStats {
  archived: number;
  merged: number;
  decayed: number;
}

/**
 * GC hooks for compression job — decay low-confidence duplicates, archive stale rows.
 */
export function runMemoryGarbageCollection(tenantId: string): MemoryGcStats {
  const stats: MemoryGcStats = { archived: 0, merged: 0, decayed: 0 };
  const staleDays = 180;
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

  const archived = db.rawRun(
    `UPDATE memory_records SET verification_state = 'ARCHIVED'
     WHERE tenant_id = ? AND verification_state = 'UNVERIFIED'
     AND confidence < 0.25 AND observed_at < ?`,
    [tenantId, cutoff],
  ) as { changes?: number };
  stats.archived = archived?.changes ?? 0;

  const rows = db.rawGet(
    `SELECT id, content_hash, confidence FROM memory_records
     WHERE tenant_id = ? AND verification_state IN ('UNVERIFIED','VERIFIED')
     ORDER BY observed_at DESC LIMIT 100`,
    [tenantId],
  ) as { id: string; content_hash: string; confidence: number }[];

  const byHash = new Map<string, { id: string; confidence: number }>();
  for (const r of rows) {
    const prev = byHash.get(r.content_hash);
    if (!prev) {
      byHash.set(r.content_hash, { id: r.id, confidence: r.confidence });
      continue;
    }
    if (r.confidence <= prev.confidence) {
      db.rawRun(
        `UPDATE memory_records SET verification_state = 'SUPERSEDED' WHERE id = ?`,
        [r.id],
      );
      stats.merged++;
    } else {
      db.rawRun(
        `UPDATE memory_records SET verification_state = 'SUPERSEDED' WHERE id = ?`,
        [prev.id],
      );
      byHash.set(r.content_hash, { id: r.id, confidence: r.confidence });
      stats.merged++;
    }
  }

  const decayed = db.rawRun(
    `UPDATE memory_records SET confidence = MAX(0.1, confidence * 0.98)
     WHERE tenant_id = ? AND verification_state IN ('UNVERIFIED','VERIFIED')
     AND observed_at < ?`,
    [tenantId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()],
  ) as { changes?: number };
  stats.decayed = decayed?.changes ?? 0;

  return stats;
}
