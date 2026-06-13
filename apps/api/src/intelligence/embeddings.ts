import crypto from "crypto";
import { db } from "../database.js";
import { embedText } from "../llm.js";

/**
 * Embedding helpers backing the hybrid retrieval and auto-linker layers.
 *
 * Storage policy
 * --------------
 * - Float32Array vectors are persisted as raw BLOBs in `entity_embeddings`
 *   (see {@link "../database".HustronixDB.upsertEmbedding}). One row per
 *   `(entity_type, entity_id)` keeps writes idempotent.
 * - `text_hash` is the sha256 of the canonical text used to embed. We re-embed
 *   only when the text actually changed; this is the sole guard against
 *   thrashing the OpenAI API on every signal mutation.
 * - We do not maintain an ANN index. Cosine is computed in JS by callers
 *   ({@link cosine}) over the per-tenant subset returned by
 *   `db.listEmbeddingsForUser`. This is intentional while N stays in the low
 *   thousands per tenant; revisit if working sets exceed ~50k vectors.
 *
 * Failure mode
 * ------------
 * `ensureEmbedding` swallows API errors (returns `false`) and logs a warning
 * so signal ingestion never blocks on the embedding provider being
 * unavailable. The Hybrid Retrieval layer falls back to FTS-only ranking when
 * embeddings are missing.
 */

export type EmbedEntityType = "signal" | "execution" | "decision";

export function textHash(text: string): string {
  return crypto.createHash("sha256").update(text || "").digest("hex");
}

/**
 * One-shot warning so we don't spam the log when an entire pipeline run
 * lacks an OpenAI key. Reset on process restart.
 */
let warnedNoEmbeddingProvider = false;

/**
 * Idempotent embed-and-store. Skips work when the input text is identical to
 * what was last embedded for this entity (matched by sha256). Returns true if
 * an embedding now exists, false on hard failure (no API key, network error).
 *
 * Failure logging policy:
 * - "no API key" warns once per process — it's expected when running without
 *   an OpenAI key and would otherwise drown the log on every signal.
 * - Other errors log per occurrence (network blip, model error, etc.) so
 *   transient failures stay visible.
 */
export async function ensureEmbedding(
  entityType: EmbedEntityType,
  entityId: string,
  userId: string,
  text: string,
): Promise<boolean> {
  const t = (text || "").trim();
  if (!t) return false;

  const h = textHash(t);
  const existing = db.getEmbeddingTextHash(entityType, entityId);
  if (existing === h) return true;

  try {
    const vec = await embedText(userId === "system" ? entityIdToOwnerForKey(entityId, userId) : userId, t);
    if (!Array.isArray(vec) || vec.length === 0) return false;
    const f32 = new Float32Array(vec);
    db.upsertEmbedding({
      entityType,
      entityId,
      userId,
      vector: f32,
      textHash: h,
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("No OpenAI API key")) {
      if (!warnedNoEmbeddingProvider) {
        warnedNoEmbeddingProvider = true;
        console.warn(
          "[intelligence/embeddings] No OpenAI key — semantic search degraded to FTS-only. Set OPENAI_API_KEY to enable embeddings. (Suppressing further warnings.)",
        );
      }
    } else {
      console.warn(`[intelligence/embeddings] ensureEmbedding(${entityType}:${entityId}) failed: ${msg}`);
    }
    return false;
  }
}

/**
 * The OpenAI key resolver in `llm.ts` falls back to a per-user SQLite key. For
 * the synthetic `system` tenant we have no user key — so we hand it the same
 * userId, which makes `embedText` resolve via `config.openai.apiKey` (the env
 * var). Keeping this isolated so future tenant lookup logic has one place to
 * change.
 */
function entityIdToOwnerForKey(_entityId: string, userId: string): string {
  return userId;
}

/** Cosine over Float32Array. Returns 0 for zero-magnitude vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
