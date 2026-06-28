import { db } from "../database.js";
import { fetchDecisionContext, formatForPrompt } from "./contextEngine.js";
import { detectSignal, detectSignalHeuristic } from "./signalDetector.js";
import { autoLink } from "./autoLinker.js";
import { adaptiveLinkPolicyEnabled, linkPolicyEngine } from "./link-policy.js";
import { ensureEmbedding } from "./embeddings.js";
import { hybridSearch } from "./hybridSearch.js";
import { applyEnrichment } from "./enrich.js";
import { runContentTrustPipeline } from "../security/content-trust-pipeline.js";
import { resolveTemporalDecisionSignal } from "../security/decision-lifecycle.js";
import {
  applyGraphPatch,
  indexSignalAsEvidence,
  type EvidenceNodeType,
} from "../security/evidence-graph.js";
import { computeOrganizationalTruth, scheduleOrganizationalTruthRecompute } from "../security/organizational-truth.js";
import { resolveTenantContext } from "../security/tenant-context.js";
import { patchOrganizationState } from "../state/organization-state.js";

/**
 * Intelligence orchestrator — the single entry point the rest of the system
 * calls. Other modules SHOULD NOT import the sub-modules directly; route
 * through here so we can keep the side-effect graph in one file.
 *
 * Pipeline (per signal):
 *
 *   1. Fetch decision context (sync, cheap).
 *   2. Run signal detector (LLM + heuristic fallback).
 *   3. Persist enrichment to `external_signals` immediately so any subsequent
 *      reader sees it (auditor, UI, agent prompt).
 *   4. Best-effort embed the signal text (FTS already populated by the
 *      database layer at insert time).
 *   5. Run auto-linker. If `shouldAutoApply`, call `linkExternalSignalToTask`,
 *      which itself triggers `auditor.onWrite({type:"signal_link",...})` and
 *      drives enforcement.
 *
 * The whole pipeline is wrapped so a single failure (e.g. LLM 5xx) downgrades
 * cleanly — the signal stays in the ledger, the auditor still gets its
 * `type:"signal"` invocation from the original insert, and we record the
 * error on `external_signals.intelligence_error` for ops visibility.
 */

/** Re-exports so consumers have one import path. */
export { fetchDecisionContext, formatForPrompt } from "./contextEngine.js";
export { hybridSearch, warmEmbeddingsForActiveLedger } from "./hybridSearch.js";
export type { DecisionContext } from "./contextEngine.js";
export type { DetectedSignal } from "./signalDetector.js";
export type { AutoLinkResult, LinkSuggestion } from "./autoLinker.js";
export type { SearchHit } from "./hybridSearch.js";

export {
  findDriftSignals,
  findOverloadedOwners,
  findConflictingExecutions,
  findSignalsRelatedToTask,
  operationalSearch,
} from "./operationalQuery.js";
export type {
  DriftSignal,
  OwnerLoad,
  ConflictingExecution,
  RelatedSignal,
} from "./operationalQuery.js";

export {
  weeklyDriftReport,
  operationalHealth,
  formatWeeklyDriftMarkdown,
  formatHealthMarkdown,
} from "./reports.js";
export type { WeeklyDriftReport, OperationalHealth } from "./reports.js";

export { ingestMeeting, extractHeuristic, meetingKindToOpClass } from "./meetingIngestion.js";
export type {
  MeetingIngestInput,
  MeetingIngestResult,
  MeetingItem,
  MeetingItemKind,
} from "./meetingIngestion.js";

export {
  enrichHeuristic,
  applyEnrichment,
  coerceEnrichment,
  ENRICHMENT_SCHEMA_HINT,
  ENRICHMENT_POLICY,
  VALID_URGENCY,
  VALID_OP_CLASS,
} from "./enrich.js";
export type { EnrichmentExtras, SignalUrgency, OpClassification } from "./enrich.js";

interface ProcessSignalOptions {
  /** When true, use only deterministic heuristics — no LLM. Used by tests/cron drift sweeps. */
  noLlm?: boolean;
  /** When true, force re-processing even if the signal was already enriched. */
  force?: boolean;
}

export interface ProcessSignalResult {
  signalId: string;
  detected: ReturnType<typeof detectSignalHeuristic>;
  linked: { taskId: string; decisionId: string } | null;
  error?: string;
  /** "skipped" only set on idempotency / cost-gate short-circuits, for telemetry. */
  skippedReason?:
    | "already-enriched"
    | "no-active-decision-and-noisy"
    | "tiny-content"
    | "injection-blocked";
}

/**
 * Cost-gate constants. Tweak via env if needed; defaults err on the side of
 * "skip the LLM" because Hustronix runs heuristic floors that are good enough
 * for unambiguous cases (NO-list violation, no active decision, tiny noise).
 */
const TINY_TOKEN_FLOOR = 4;
/** Minimum length before we'll even consider enriching at all. */
const MIN_CONTENT_CHARS = 6;

function tokenCount(s: string): number {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3).length;
}

/**
 * Main pipeline. Call this from `auditor.onWrite` (signal path) wrapped in
 * `setImmediate` so signal ingestion never waits on the LLM.
 *
 * Cost gates (in order):
 *   1. Idempotency — if `intent_extracted_at` is set and `opts.force` is not,
 *      we already enriched; skip both detector and embed.
 *   2. Tiny content — content below `MIN_CONTENT_CHARS` gets a cheap
 *      heuristic-only pass and no embedding. Most often empty Slack
 *      attachments / channel-join echoes.
 *   3. Heuristic-first — we always run the heuristic locally. If it returns
 *      `risk=high` (NO-list match) OR there is no active decision context to
 *      LLM-classify against, we skip the LLM detector entirely.
 *   4. Embed gating — only embed if the auto-linker stands a chance:
 *      `signal_type !== "noise"` AND `context.activeExecutions.length > 0`.
 *      Saves the OpenAI embed call on signals that can't link to anything.
 *
 * All writes (`enrichSignal`, `linkExternalSignalToTask`) remain idempotent.
 */
export async function processSignal(signalId: string, opts: ProcessSignalOptions = {}): Promise<ProcessSignalResult | null> {
  const sig = db.getSignalById(signalId);
  if (!sig) return null;
  if (sig.state === "KILLED" || sig.state === "LINKED") {
    /** Already terminal — re-running detection has no enforcement value. */
    return null;
  }

  const userId = sig.user_id;

  /**
   * Gate 1: Idempotency. If something already enriched this signal (e.g.
   * meetingIngestion fast-path, prior auditor run), the column
   * `intent_extracted_at` is non-null. The auditor still needs to evaluate
   * shadow-work / capacity for this signal write, but that runs synchronously
   * BEFORE this fire-and-forget pipeline — so we can short-circuit here
   * without touching enforcement correctness.
   */
  const sigRow = sig as typeof sig & { intent_extracted_at?: string | null };
  if (!opts.force && sigRow.intent_extracted_at) {
    const detectedFromRow: ReturnType<typeof detectSignalHeuristic> = {
      signal_type: (sig.intent && sig.intent.startsWith("potential constraint") ? "execution" : "observation") as
        | "execution"
        | "observation"
        | "noise",
      intent: sig.intent ?? "(prior enrichment)",
      risk: ((sig.risk as "low" | "medium" | "high" | null) ?? "low") as "low" | "medium" | "high",
      confidence: typeof sig.intent_confidence === "number" ? sig.intent_confidence : 0.5,
      related_decision_id: sig.related_decision_id ?? null,
      reasoning: "skipped (already enriched)",
      source: "heuristic",
      extras: {
        urgency: ((sig.urgency as "immediate" | "soon" | "scheduled" | "informational" | null) ??
          "informational") as "immediate" | "soon" | "scheduled" | "informational",
        op_classification: ((sig.op_classification as
          | "incident"
          | "change"
          | "inquiry"
          | "status"
          | "ambient"
          | "commitment"
          | "blocker"
          | "constraint"
          | "decision_signal"
          | "disagreement"
          | null) ?? "ambient") as
          | "incident"
          | "change"
          | "inquiry"
          | "status"
          | "ambient"
          | "commitment"
          | "blocker"
          | "constraint"
          | "decision_signal"
          | "disagreement",
        affected_systems: parseJsonArray(sig.affected_systems),
      },
    };
    return { signalId, detected: detectedFromRow, linked: null, skippedReason: "already-enriched" };
  }

  const context = fetchDecisionContext(userId);
  const tenantCtx = resolveTenantContext(userId);
  const content = String(sig.content || "");
  const trust = runContentTrustPipeline({
    content,
    sourceLabel: sig.source,
    tenantId: tenantCtx.orgId,
    actorId: sig.owner,
    workspaceId: tenantCtx.workspaceId,
  });
  db.rawRun(`UPDATE external_signals SET injection_classification = ? WHERE id = ?`, [
    trust.classification,
    signalId,
  ]);
  const tCount = tokenCount(content);

  /** Gate 2: Tiny content — heuristic only, no LLM, no embed. */
  if (content.trim().length < MIN_CONTENT_CHARS || tCount < TINY_TOKEN_FLOOR) {
    const fb = detectSignalHeuristic(
      { signalId, userId, content, source: sig.source, owner: sig.owner },
      context,
    );
    applyEnrichment(signalId, fb, fb.extras, null);
    return { signalId, detected: fb, linked: null, skippedReason: "tiny-content" };
  }

  /**
   * Gate 3: Heuristic-first. Run the local classifier; if it locks onto a
   * NO-list violation OR there's no decision to LLM-reason against, the LLM
   * call would be redundant.
   */
  const heuristic = detectSignalHeuristic(
    { signalId, userId, content, source: sig.source, owner: sig.owner },
    context,
  );

  const heuristicSufficient =
    opts.noLlm ||
    !trust.allowLlmReasoning ||
    !context.activeDecision ||
    (heuristic.risk === "high" && heuristic.signal_type === "execution");

  let detected: ReturnType<typeof detectSignalHeuristic>;
  if (heuristicSufficient) {
    detected = heuristic;
    if (!context.activeDecision && heuristic.signal_type === "noise") {
      /** No decision + noisy chatter — record + bail before any embed/link. */
      applyEnrichment(signalId, detected, detected.extras, null);
      return { signalId, detected, linked: null, skippedReason: "no-active-decision-and-noisy" };
    }
  } else {
    try {
      detected = await detectSignal(
        { signalId, userId, content, source: sig.source, owner: sig.owner },
        context,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      applyEnrichment(signalId, heuristic, heuristic.extras, `detector: ${msg}`.slice(0, 500));
      return { signalId, detected: heuristic, linked: null, error: msg };
    }
  }

  /** Persist detector + enrichment output BEFORE linking — even if linking fails, the auditor and UI see it. */
  applyEnrichment(signalId, detected, detected.extras, null);

  resolveTemporalDecisionSignal({
    tenantId: tenantCtx.orgId,
    userId,
    signalId,
    content,
    opClassification: detected.extras?.op_classification ?? null,
  });

  try {
    scheduleOrganizationalTruthRecompute(userId);
  } catch {
    /* non-blocking */
  }

  indexSignalAsEvidence({
    tenantId: tenantCtx.orgId,
    signalId,
    label: detected.intent || content.slice(0, 200),
    sourceType: sig.source,
    confidence: detected.confidence,
  });

  wireSignalGraphOnIngest({
    tenantId: tenantCtx.orgId,
    userId,
    signalId,
    label: detected.intent || content.slice(0, 200),
    relatedDecisionId: detected.related_decision_id ?? null,
    affectedSystems: detected.extras?.affected_systems ?? [],
  });

  /** Malicious ingest: record only — never auto-link to executions. */
  if (!trust.allowLlmReasoning) {
    return { signalId, detected, linked: null, skippedReason: "injection-blocked" };
  }

  /**
   * Gate 4: Embed only when linking has any chance. Noise signals and signals
   * arriving when the tenant has no active executions can never auto-link, so
   * the embedding spend is pure waste.
   */
  const canPossiblyLink =
    detected.signal_type !== "noise" && context.activeExecutions.length > 0;

  if (canPossiblyLink) {
    await ensureEmbedding("signal", signalId, userId, content).catch(() => false);
  }

  let linked: { taskId: string; decisionId: string } | null = null;
  if (canPossiblyLink) {
    try {
      const link = await autoLink({ signalId, userId, content, detected }, context);
      const policy = adaptiveLinkPolicyEnabled()
        ? linkPolicyEngine.evaluate({ content, detected, candidate: link.best })
        : {
            tier: link.shouldAutoApply ? ("auto" as const) : ("manual" as const),
            score: link.best?.fusedScore ?? 0,
            method: "legacy",
            provenance: {},
            shouldAutoApply: link.shouldAutoApply,
          };
      if (policy.shouldAutoApply && link.best) {
        try {
          db.linkExternalSignalToTask(signalId, link.best.taskId, {
            linkMethod: policy.method,
            linkProvenance: policy.provenance,
          });
          linked = { taskId: link.best.taskId, decisionId: link.best.decisionId };
          wireSignalGraphOnIngest({
            tenantId: tenantCtx.orgId,
            userId,
            signalId,
            label: detected.intent || content.slice(0, 200),
            relatedDecisionId: null,
            affectedSystems: [],
            linkedTaskId: link.best.taskId,
          });
        } catch (e) {
          console.warn(`[intelligence] linkExternalSignalToTask failed for signal=${signalId}:`, e);
        }
      } else if (link.best) {
        /** Below auto-apply threshold — leave breadcrumb for ops review. */
        console.log(
          `[intelligence] signal=${signalId.slice(0, 8)} top candidate=${link.best.taskId.slice(0, 8)} tier=${policy.tier} score=${policy.score.toFixed(3)}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[intelligence] autoLink failed for signal=${signalId}:`, msg);
      applyEnrichment(signalId, detected, detected.extras, `linker: ${msg}`.slice(0, 500));
    }
  }

  return { signalId, detected, linked };
}

function parseJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const ENTITY_EVIDENCE_TYPES = new Set<string>([
  "decision",
  "task",
  "customer",
  "competitor",
  "metric",
  "feature",
  "commitment",
  "project",
  "person",
  "company",
  "team",
]);

function evidenceTypeForEntity(type: string): EvidenceNodeType | null {
  if (ENTITY_EVIDENCE_TYPES.has(type)) return type as EvidenceNodeType;
  return null;
}

/** Phase 2.1 — link signal evidence to known entities and patch org state. */
function wireSignalGraphOnIngest(params: {
  tenantId: string;
  userId: string;
  signalId: string;
  label: string;
  relatedDecisionId: string | null;
  affectedSystems: string[];
  linkedTaskId?: string | null;
}): void {
  const { tenantId, userId, signalId, label } = params;
  let patched = false;

  const link = (
    linkToRefId: string,
    linkToType: EvidenceNodeType,
    edgeType: "SUPPORTS" | "OBSERVED_IN" = "SUPPORTS",
  ) => {
    try {
      applyGraphPatch({
        tenantId,
        refType: "signal",
        refId: signalId,
        label,
        linkToRefId,
        linkToType,
        edgeType,
      });
      patched = true;
    } catch {
      /* graph patch is best-effort */
    }
  };

  if (params.relatedDecisionId) {
    link(params.relatedDecisionId, "decision", "OBSERVED_IN");
  }

  if (params.linkedTaskId) {
    link(params.linkedTaskId, "task", "SUPPORTS");
  }

  for (const sys of params.affectedSystems.slice(0, 8)) {
    const token = String(sys).trim().toLowerCase();
    if (!token) continue;
    const ent = db
      .rawGet(
        `SELECT ref_id, type FROM entities
         WHERE tenant_id IN (?, ?) AND ref_id IS NOT NULL
           AND (ref_id = ? OR lower(label) = ?)
         LIMIT 1`,
        [tenantId, userId, token, token],
      )
      .at(0) as { ref_id: string; type: string } | undefined;
    if (!ent?.ref_id) continue;
    const nodeType = evidenceTypeForEntity(ent.type);
    if (!nodeType) continue;
    link(ent.ref_id, nodeType, "OBSERVED_IN");
  }

  if (patched) {
    try {
      patchOrganizationState(tenantId, userId, `graph_patch:signal:${signalId}`);
    } catch {
      /* non-blocking */
    }
  }
}

/**
 * Fire-and-forget wrapper for the auditor hot path. Logs but does not throw.
 * The caller (auditor.onWrite signal branch) uses `setImmediate` so the
 * synchronous insert returns before this kicks off.
 */
export function processSignalFireAndForget(signalId: string): void {
  processSignal(signalId).catch((err) => {
    console.error(`[intelligence] processSignal(${signalId}) crashed:`, err);
  });
}

/**
 * Drift sweep — used by the modified cron loop. Re-runs detection (heuristic
 * only, no LLM cost) over UNVERIFIED signals that never got enriched. This is
 * the "missed signals + orphan executions + drift audit" use the user's spec
 * reserves cron for.
 */
export async function reprocessUnenrichedSignals(userId: string, limit = 50): Promise<number> {
  const rows = db.rawGet(
    `SELECT id FROM external_signals
       WHERE state = 'UNVERIFIED'
         AND intent_extracted_at IS NULL
         ${userId === "system" ? "" : "AND user_id = ?"}
       ORDER BY detected_at DESC
       LIMIT ?`,
    userId === "system" ? [limit] : [userId, limit],
  ) as { id: string }[];

  let processed = 0;
  for (const r of rows) {
    const res = await processSignal(r.id, { noLlm: true });
    if (res) processed++;
  }
  return processed;
}
