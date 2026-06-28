import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { createBelief } from "../beliefs/belief-engine.js";
import { storeMemoryFact } from "../security/memory-fact.js";
import { runMemoryGarbageCollection } from "../security/memory-store.js";

export interface CompressionStats {
  messagesProcessed: number;
  factsCreated: number;
  beliefsCreated: number;
  gcArchived: number;
  gcMerged: number;
}

const MESSAGE_BATCH = 200;

function extractFactCandidates(content: string): string[] {
  const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const candidates: string[] = [];
  for (const line of lines) {
    if (line.length < 24 || line.length > 400) continue;
    if (/^(hi|hello|thanks|ok|yes|no)\b/i.test(line)) continue;
    if (/\b(decided|will|plan|commit|launch|blocker|risk|priority)\b/i.test(line)) {
      candidates.push(line);
    }
  }
  return candidates.slice(0, 3);
}

function messageToBeliefCandidates(content: string): string[] {
  const matches = content.match(/\b(we believe|assume|hypothesis|likely that)\b[^.!?]{10,120}/gi);
  return (matches ?? []).map((m) => m.trim()).slice(0, 2);
}

/**
 * Weekly compression pipeline: messages → facts → beliefs → doctrine candidates.
 */
export function runWeeklyMemoryCompression(tenantId: string): CompressionStats {
  const stats: CompressionStats = {
    messagesProcessed: 0,
    factsCreated: 0,
    beliefsCreated: 0,
    gcArchived: 0,
    gcMerged: 0,
  };

  const messages = db.rawGet(
    `SELECT id, content FROM messages
     WHERE user_id = ? AND role = 'user'
     ORDER BY timestamp DESC LIMIT ?`,
    [tenantId, MESSAGE_BATCH],
  ) as { id: string; content: string }[];

  for (const msg of messages) {
    stats.messagesProcessed++;
    for (const fact of extractFactCandidates(msg.content)) {
      try {
        storeMemoryFact({
          tenantId,
          sourceType: "system",
          author: "compression-job",
          content: fact,
          createdBy: "compression-job",
          skipClaimValidation: true,
          verificationState: "UNVERIFIED",
        });
        stats.factsCreated++;
      } catch {
        /* duplicate or validation */
      }
    }
    for (const beliefText of messageToBeliefCandidates(msg.content)) {
      createBelief({ tenantId, statement: beliefText, initialConfidence: 0.42 });
      stats.beliefsCreated++;
    }
  }

  const gc = runMemoryGarbageCollection(tenantId);
  stats.gcArchived = gc.archived;
  stats.gcMerged = gc.merged;

  db.rawRun(
    `INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`,
    [
      "MEMORY_COMPRESSION_RUN",
      JSON.stringify(stats),
      tenantId,
    ],
  );

  return stats;
}

export function runCompressionForAllTenants(): CompressionStats {
  const tenants = db.rawGet(`SELECT DISTINCT user_id AS id FROM messages`) as { id: string }[];
  const total: CompressionStats = {
    messagesProcessed: 0,
    factsCreated: 0,
    beliefsCreated: 0,
    gcArchived: 0,
    gcMerged: 0,
  };
  for (const t of tenants) {
    const s = runWeeklyMemoryCompression(t.id);
    total.messagesProcessed += s.messagesProcessed;
    total.factsCreated += s.factsCreated;
    total.beliefsCreated += s.beliefsCreated;
    total.gcArchived += s.gcArchived;
    total.gcMerged += s.gcMerged;
  }
  return total;
}

/** Record doctrine candidate from high-confidence repeated beliefs (manual review). */
export function surfaceDoctrineCandidates(tenantId: string): string[] {
  const rows = db.rawGet(
    `SELECT statement FROM beliefs
     WHERE tenant_id = ? AND status = 'CONFIRMED' AND confidence >= 0.8
     ORDER BY updated_at DESC LIMIT 5`,
    [tenantId],
  ) as { statement: string }[];

  const ids: string[] = [];
  for (const r of rows) {
    const id = uuidv4();
    db.rawRun(
      `INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`,
      ["DOCTRINE_CANDIDATE", r.statement.slice(0, 500), id],
    );
    ids.push(id);
  }
  return ids;
}
