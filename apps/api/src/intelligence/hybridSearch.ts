import { db } from "../database.js";
import { cosine, ensureEmbedding } from "./embeddings.js";

/**
 * Hybrid Retrieval — answers the two question shapes the user actually
 * asks of a Hustronix instance:
 *
 *   "What signals relate to onboarding?"
 *   "What is violating the current decision?"
 *
 * These are best served by mixing exact keyword recall (FTS5/BM25) with
 * semantic recall (embeddings). We intentionally do NOT use a vector DB.
 * SQLite + FTS5 + a Float32 BLOB store is sufficient at the working-set
 * sizes Hustronix targets, and keeps the deployment story to "one file".
 *
 * Output is unified across entity types (signal/execution/decision) so the
 * UI can render a single ranked list.
 */

export type EntityType = "signal" | "execution" | "decision";

export interface SearchHit {
  entityType: EntityType;
  entityId: string;
  /** A short, human-readable snippet — `content` for signals, `success_condition` for executions, `vow` for decisions. */
  snippet: string;
  /** Convenience: where it lives in the ledger. */
  decisionId?: string;
  taskId?: string;
  signalId?: string;
  /** Final fused rank score (higher = better). */
  score: number;
  /** Component scores for transparency. */
  ftsScore: number | null;
  cosineScore: number | null;
  /** Fusion sources. Useful for debug UIs. */
  sources: ("fts" | "embedding")[];
}

const DEFAULT_LIMIT = 20;
/** Per the original RRF paper. */
const RRF_K = 60;

function rrf(rank: number, k = RRF_K): number {
  return 1 / (k + rank);
}

interface FtsRow {
  entityType: EntityType;
  entityId: string;
  snippet: string;
  ftsScore: number;
  decisionId?: string;
  taskId?: string;
  signalId?: string;
}

/**
 * Run the FTS5 query against any subset of {signal, execution, decision} and
 * return a flat list. We oversample (limit*2) per type so that fusion has
 * enough candidates per source to actually fuse.
 */
function ftsAcrossEntities(userId: string, query: string, types: EntityType[], limit: number): FtsRow[] {
  const out: FtsRow[] = [];
  const per = Math.max(limit * 2, 10);

  if (types.includes("signal")) {
    for (const r of db.searchSignalsFts(userId, query, per)) {
      out.push({
        entityType: "signal",
        entityId: r.signal_id,
        snippet: (r.content || "").slice(0, 240),
        ftsScore: r.score,
        signalId: r.signal_id,
      });
    }
  }
  if (types.includes("execution")) {
    for (const r of db.searchExecutionsFts(userId, query, per)) {
      out.push({
        entityType: "execution",
        entityId: r.task_id,
        snippet: (r.success_condition || "").slice(0, 240),
        ftsScore: r.score,
        decisionId: r.decision_id,
        taskId: r.task_id,
      });
    }
  }
  if (types.includes("decision")) {
    for (const r of db.searchDecisionsFts(userId, query, per)) {
      out.push({
        entityType: "decision",
        entityId: r.decision_id,
        snippet: (r.vow || "").slice(0, 240),
        ftsScore: r.score,
        decisionId: r.decision_id,
      });
    }
  }

  return out;
}

/**
 * For each FTS hit, look up the precomputed embedding (we do not embed at
 * query time for FTS hits — embeddings are populated by the signal pipeline
 * and by the {@link warmEmbeddingsForActiveLedger} backfill). Compute cosine
 * vs. the query embedding when both sides exist.
 */
async function fuseWithQueryVector(
  userId: string,
  query: string,
  ftsHits: FtsRow[],
  limit: number,
): Promise<SearchHit[]> {
  if (ftsHits.length === 0) return [];

  /** Sort each entity-type bucket by FTS score (lower = better) before assigning ranks. */
  const sortedByFts = [...ftsHits].sort((a, b) => a.ftsScore - b.ftsScore);
  const ftsRank = new Map<string, number>();
  sortedByFts.forEach((h, i) => ftsRank.set(`${h.entityType}:${h.entityId}`, i + 1));

  /** Try to embed the query. If that fails, return FTS-only ranking. */
  const queryEmbedded = await ensureEmbedding("signal", `__query__:${hashLite(query)}`, userId, query);

  let queryVec: Float32Array | null = null;
  if (queryEmbedded) {
    const row = db.listEmbeddingsForUser(userId, "signal").find((r) => r.entityId === `__query__:${hashLite(query)}`);
    queryVec = row?.vector ?? null;
  }

  const rows: SearchHit[] = [];

  if (queryVec) {
    /** Pull all embeddings for the candidate entity types and compute cosine. */
    const allEmbs = [
      ...db.listEmbeddingsForUser(userId, "signal"),
      ...db.listEmbeddingsForUser(userId, "execution"),
      ...db.listEmbeddingsForUser(userId, "decision"),
    ];
    const embIndex = new Map(allEmbs.map((e) => [`${e.entityType}:${e.entityId}`, e.vector] as const));

    /** Score every fts hit; cosine = null when no embedding present. */
    const scored = sortedByFts.map((h) => {
      const v = embIndex.get(`${h.entityType}:${h.entityId}`);
      const cos = v ? cosine(queryVec!, v) : null;
      return { hit: h, cosineScore: cos };
    });

    /** Build a cosine ranking limited to entries that actually have an embedding. */
    const cosRanked = scored.filter((s) => s.cosineScore != null).sort((a, b) => (b.cosineScore as number) - (a.cosineScore as number));
    const cosRank = new Map<string, number>();
    cosRanked.forEach((s, i) => cosRank.set(`${s.hit.entityType}:${s.hit.entityId}`, i + 1));

    for (const s of scored) {
      const key = `${s.hit.entityType}:${s.hit.entityId}`;
      const fr = ftsRank.get(key) ?? null;
      const cr = cosRank.get(key) ?? null;
      const fused = (fr ? rrf(fr) : 0) + (cr ? rrf(cr) : 0);
      const sources: SearchHit["sources"] = [];
      if (fr) sources.push("fts");
      if (cr) sources.push("embedding");
      rows.push({
        entityType: s.hit.entityType,
        entityId: s.hit.entityId,
        snippet: s.hit.snippet,
        decisionId: s.hit.decisionId,
        taskId: s.hit.taskId,
        signalId: s.hit.signalId,
        score: fused,
        ftsScore: s.hit.ftsScore,
        cosineScore: s.cosineScore,
        sources,
      });
    }
  } else {
    /** FTS-only path: rank purely by FTS, RRF-normalized so scores stay comparable across queries. */
    for (const h of sortedByFts) {
      const fr = ftsRank.get(`${h.entityType}:${h.entityId}`) ?? 1;
      rows.push({
        entityType: h.entityType,
        entityId: h.entityId,
        snippet: h.snippet,
        decisionId: h.decisionId,
        taskId: h.taskId,
        signalId: h.signalId,
        score: rrf(fr),
        ftsScore: h.ftsScore,
        cosineScore: null,
        sources: ["fts"],
      });
    }
  }

  /** Deduplicate (FTS hit might recur under same key if re-indexed); keep the highest fused score. */
  const dedup = new Map<string, SearchHit>();
  for (const r of rows) {
    const k = `${r.entityType}:${r.entityId}`;
    const prev = dedup.get(k);
    if (!prev || r.score > prev.score) dedup.set(k, r);
  }

  return Array.from(dedup.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Cheap stable hash for query-embedding cache keys; not security-sensitive. */
function hashLite(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export interface HybridSearchOptions {
  types?: EntityType[];
  limit?: number;
}

/**
 * Public API. Hits the FTS index across the requested entity types, fuses
 * with query-embedding cosine via RRF, and returns up to `limit` deduplicated
 * results. Tenant-scoped via `userId` (system sees all).
 */
export async function hybridSearch(userId: string, query: string, opts: HybridSearchOptions = {}): Promise<SearchHit[]> {
  const types = opts.types && opts.types.length > 0 ? opts.types : (["signal", "execution", "decision"] as EntityType[]);
  const limit = opts.limit ?? DEFAULT_LIMIT;

  if (!query || !query.trim()) return [];

  const ftsHits = ftsAcrossEntities(userId, query, types, limit);
  if (ftsHits.length === 0) return [];

  return fuseWithQueryVector(userId, query, ftsHits, limit);
}

/**
 * Backfill helper. Walks the active ledger surface (active decisions +
 * pending/active executions + recent signals) and ensures embeddings exist.
 * Safe to call lazily from an admin endpoint — no-op when text_hash matches.
 *
 * Bounded by `limit` per type to avoid runaway costs on large tenants.
 */
export async function warmEmbeddingsForActiveLedger(userId: string, limit = 200): Promise<{
  signals: number;
  executions: number;
  decisions: number;
  failed: number;
}> {
  let signals = 0;
  let executions = 0;
  let decisions = 0;
  let failed = 0;

  const decision = db.getActiveDecision(userId);
  if (decision) {
    const text = `${decision.vow}\n${decision.expected_outcomes}\n${decision.constraints}`;
    const ok = await ensureEmbedding("decision", decision.id, userId, text);
    if (ok) decisions++;
    else failed++;
  }

  const execs = db.getActiveExecutions(userId, limit);
  for (const e of execs) {
    if (!e.success_condition?.trim()) continue;
    const ok = await ensureEmbedding("execution", e.task_id, userId, e.success_condition);
    if (ok) executions++;
    else failed++;
  }

  const sigs = db.getRecentSignals(userId, limit);
  for (const s of sigs) {
    const content = String(s.content || "");
    if (!content.trim()) continue;
    const ok = await ensureEmbedding("signal", String(s.id), userId, content);
    if (ok) signals++;
    else failed++;
  }

  return { signals, executions, decisions, failed };
}
