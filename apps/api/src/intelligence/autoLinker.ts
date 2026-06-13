import { db } from "../database.js";
import * as llm from "../llm.js";
import { cosine, ensureEmbedding } from "./embeddings.js";
import type { DecisionContext } from "./contextEngine.js";
import type { DetectedSignal } from "./signalDetector.js";

/**
 * Auto-Linker — adapts GBrain's "auto-create relationships between entities"
 * pattern to Hustronix's chain:
 *
 *     signal → execution → decision
 *
 * The output is a single best link suggestion (or none), with a confidence
 * score and the path it took to get there. This is consumed by
 * {@link "./index"}, which decides whether to auto-apply (high confidence) or
 * leave for human review (medium/low).
 *
 * Scoring is two-pass:
 *   1. Deterministic shortlist via FTS5 keyword overlap against
 *      `executions_fts` (BM25 score), restricted to the tenant.
 *   2. Re-rank the shortlist by cosine similarity against the signal's
 *      embedding, when embeddings are available. RRF (Reciprocal Rank Fusion)
 *      combines the two ranks so we never need to handcraft a blend factor.
 *
 * The optional LLM tie-break runs only when the top two candidates are within
 * `LLM_TIEBREAK_DELTA` of each other AND the signal detector classified the
 * signal as `execution` with `risk !== "low"`. This caps the auto-linker's
 * marginal LLM cost.
 */

const SHORTLIST_SIZE = 8;
const LLM_TIEBREAK_DELTA = 0.05;
/**
 * Auto-apply threshold. Below this, we still record the suggestion on the
 * signal (`related_decision_id`) but do not call `linkExternalSignalToTask`.
 */
const AUTO_APPLY_FUSED_SCORE = 0.55;

export interface LinkSuggestion {
  taskId: string;
  decisionId: string;
  fusedScore: number;
  ftsScore: number | null;
  cosineScore: number | null;
  reason: string;
  source: "fts" | "embedding" | "fts+embedding" | "llm-tiebreak";
}

export interface AutoLinkResult {
  /** Best candidate (if any reached the floor for shortlisting). */
  best: LinkSuggestion | null;
  /** Full shortlist for transparency / API debugging. */
  shortlist: LinkSuggestion[];
  /** Whether the orchestrator should call `db.linkExternalSignalToTask`. */
  shouldAutoApply: boolean;
}

interface LinkerInput {
  signalId: string;
  userId: string;
  content: string;
  detected: DetectedSignal;
}

/**
 * Reciprocal Rank Fusion. Lower-rank-number = better. `k` smooths out the
 * top-rank dominance — the canonical RRF paper uses 60. We do not normalize
 * the absolute fused score; it is only meaningful for ranking. The
 * `AUTO_APPLY_FUSED_SCORE` floor is calibrated against this scoring.
 */
function rrf(rank: number, k = 60): number {
  return 1 / (k + rank);
}

/**
 * Build the shortlist from the deterministic FTS index. We tolerate empty
 * results (e.g. signal content has no FTS-tokenizable words) and just return
 * an empty shortlist — the orchestrator will skip linking gracefully.
 */
function ftsShortlist(userId: string, content: string): {
  taskId: string;
  decisionId: string;
  successCondition: string;
  ftsScore: number;
  rank: number;
}[] {
  const rows = db.searchExecutionsFts(userId, content, SHORTLIST_SIZE);
  return rows.map((r, idx) => ({
    taskId: r.task_id,
    decisionId: r.decision_id,
    successCondition: r.success_condition || "",
    /** FTS5 bm25 returns lower=better; we keep raw and use rank for fusion. */
    ftsScore: r.score,
    rank: idx + 1,
  }));
}

/**
 * Re-rank the shortlist by cosine similarity. We embed the signal once, then
 * compute against any precomputed execution embeddings we have. Missing
 * execution embeddings get cosine = null; their fused score uses only the
 * FTS rank component.
 *
 * Best-effort: if `ensureEmbedding` fails (no API key, network), we just
 * return the FTS ranking unchanged.
 */
async function fuseWithEmbeddings(
  userId: string,
  signalId: string,
  signalContent: string,
  shortlist: ReturnType<typeof ftsShortlist>,
): Promise<LinkSuggestion[]> {
  if (shortlist.length === 0) return [];

  const sigEmbedded = await ensureEmbedding("signal", signalId, userId, signalContent);
  if (!sigEmbedded) {
    return shortlist.map((s) => ({
      taskId: s.taskId,
      decisionId: s.decisionId,
      fusedScore: rrf(s.rank),
      ftsScore: s.ftsScore,
      cosineScore: null,
      reason: `fts-only (embedding unavailable)`,
      source: "fts",
    }));
  }

  /** Scoped single-row read instead of scanning every signal embedding for the tenant. */
  const sigVec = db.getEmbeddingForEntity("signal", signalId);
  if (!sigVec) {
    /** Race: ensureEmbedding said success but the row isn't visible yet. */
    return shortlist.map((s) => ({
      taskId: s.taskId,
      decisionId: s.decisionId,
      fusedScore: rrf(s.rank),
      ftsScore: s.ftsScore,
      cosineScore: null,
      reason: `fts-only (signal embedding race)`,
      source: "fts",
    }));
  }

  /** Ensure each shortlisted execution has an embedding (cheap if cached by text_hash). */
  for (const s of shortlist) {
    if (s.successCondition.trim()) {
      await ensureEmbedding("execution", s.taskId, userId, s.successCondition);
    }
  }

  /** Scoped IN-list read for only the shortlisted executions, not the whole tenant. */
  const execEmbeddings = db.getEmbeddingsForEntities(
    "execution",
    shortlist.map((s) => s.taskId),
  );

  /** Score each candidate by cosine + rank by descending similarity. */
  const withCosine = shortlist.map((s) => {
    const evec = execEmbeddings.get(s.taskId);
    const cos = evec ? cosine(sigVec, evec) : null;
    return { ...s, cosineScore: cos };
  });

  const cosRanked = [...withCosine]
    .filter((x) => typeof x.cosineScore === "number")
    .sort((a, b) => (b.cosineScore as number) - (a.cosineScore as number));
  const cosRank = new Map(cosRanked.map((x, i) => [x.taskId, i + 1] as const));

  return withCosine
    .map((s) => {
      const ftsR = rrf(s.rank);
      const cR = cosRank.has(s.taskId) ? rrf(cosRank.get(s.taskId)!) : 0;
      const fused = ftsR + cR;
      const source: LinkSuggestion["source"] =
        s.cosineScore != null && cosRank.has(s.taskId) ? "fts+embedding" : "fts";
      return {
        taskId: s.taskId,
        decisionId: s.decisionId,
        fusedScore: fused,
        ftsScore: s.ftsScore,
        cosineScore: s.cosineScore,
        reason: `fts-rank=${s.rank}${cosRank.has(s.taskId) ? `, cos-rank=${cosRank.get(s.taskId)}` : ""}`,
        source,
      };
    })
    .sort((a, b) => b.fusedScore - a.fusedScore);
}

/**
 * Optional LLM tie-break. Asks the model to pick between the top two only
 * when scores are very close AND the signal carries enough enforcement
 * weight (execution-typed, risk >= medium). Returns the winning taskId or
 * null on any failure (we keep the FTS+cosine top in that case).
 */
async function llmTiebreak(
  userId: string,
  content: string,
  candidates: LinkSuggestion[],
): Promise<string | null> {
  if (candidates.length < 2) return null;
  if (!llm.hasLlmCredentials(userId)) return null;

  const top = candidates.slice(0, 2);
  const ctxLines = top.map((c, i) => {
    const exec = db.searchExecutionsFts(userId, c.taskId, 1)[0];
    const cond = exec?.success_condition || "";
    return `[${i + 1}] taskId=${c.taskId} decisionId=${c.decisionId} success_condition="${cond.slice(0, 160)}"`;
  });

  try {
    const reply = await llm.chat(
      userId,
      [
        {
          role: "system",
          content:
            "You disambiguate which active execution best matches a Hustronix signal. Reply with the single number (1 or 2) of the best match, or 0 if neither is a real match. No prose.",
        },
        {
          role: "user",
          content: `SIGNAL: ${content.slice(0, 400)}\n\nCANDIDATES:\n${ctxLines.join("\n")}\n\nReturn 1, 2, or 0.`,
        },
      ],
      [],
      undefined,
      { modelTier: "fast" },
    );
    const m = (reply.text || "").trim().match(/[012]/);
    if (!m) return null;
    const idx = Number(m[0]);
    if (idx === 1) return top[0].taskId;
    if (idx === 2) return top[1].taskId;
    return null;
  } catch (e) {
    console.warn(`[intelligence/autoLinker] LLM tie-break failed:`, e);
    return null;
  }
}

/**
 * Main entry point. Given a signal + its detector output + the active
 * decision context, produces a ranked link suggestion list and a
 * `shouldAutoApply` decision.
 *
 * Skips entirely (returns no candidates) when:
 *   - signal_type is "noise"
 *   - there are no active executions to link to
 */
export async function autoLink(input: LinkerInput, context: DecisionContext): Promise<AutoLinkResult> {
  const empty: AutoLinkResult = { best: null, shortlist: [], shouldAutoApply: false };

  if (input.detected.signal_type === "noise") return empty;
  if (context.activeExecutions.length === 0) return empty;

  const shortlist = ftsShortlist(input.userId, input.content);
  if (shortlist.length === 0) return empty;

  /** Restrict to executions actually present in the live context (defensive — FTS
   *  could include rows whose status changed since last index update). */
  const activeIds = new Set(context.activeExecutions.map((e) => e.taskId));
  const filteredShortlist = shortlist.filter((s) => activeIds.has(s.taskId));
  if (filteredShortlist.length === 0) return empty;

  let ranked = await fuseWithEmbeddings(input.userId, input.signalId, input.content, filteredShortlist);
  if (ranked.length === 0) return empty;

  const top = ranked[0];
  const second = ranked[1];

  /** Tie-break only when it might change the outcome AND the signal warrants the cost. */
  const isTie = !!second && Math.abs(top.fusedScore - second.fusedScore) < LLM_TIEBREAK_DELTA;
  const worthLlm = input.detected.signal_type === "execution" && input.detected.risk !== "low";
  if (isTie && worthLlm) {
    const winner = await llmTiebreak(input.userId, input.content, ranked);
    if (winner && winner !== top.taskId) {
      const idx = ranked.findIndex((r) => r.taskId === winner);
      if (idx > 0) {
        const swapped = ranked[idx];
        ranked = [
          { ...swapped, source: "llm-tiebreak", reason: `${swapped.reason} (llm-tiebreak)` },
          ...ranked.filter((_, i) => i !== idx),
        ];
      }
    }
  }

  const best = ranked[0];
  /** signal_type === "noise" was already short-circuited above. */
  const shouldAutoApply = best.fusedScore >= AUTO_APPLY_FUSED_SCORE;
  return { best, shortlist: ranked, shouldAutoApply };
}
