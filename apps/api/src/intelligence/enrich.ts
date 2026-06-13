import { db } from "../database.js";
import type { DetectedSignal } from "./signalDetector.js";

/**
 * Enrich layer — augments the signal detector output with operational metadata
 * (urgency, affected systems, classification). Co-extracted from the same LLM
 * round-trip as the detector to avoid doubling cost; this module owns the
 * canonical enrichment shape, the heuristic fallback, and the writer.
 *
 * NOT generic NLP: every field exists to feed enforcement/auditor decisions.
 *
 * Why not a separate LLM call?
 * - Each call costs money.
 * - Detector already needs the active decision context to assess risk; the
 *   same context tells us urgency and affected systems with no extra prompt
 *   fetch.
 * - Keeping detector + enricher behind one call also keeps their outputs in
 *   sync (e.g. risk=high implies urgency >= "soon").
 *
 * Where enrichment writes:
 *   external_signals.urgency           — TEXT enum
 *   external_signals.affected_systems  — JSON-stringified array
 *   external_signals.op_classification — TEXT enum
 */

export type SignalUrgency = "immediate" | "soon" | "scheduled" | "informational";

export type OpClassification =
  | "incident"
  | "change"
  | "inquiry"
  | "status"
  | "ambient"
  | "commitment"
  | "blocker"
  | "constraint"
  | "decision_signal"
  | "disagreement";

export interface EnrichmentExtras {
  urgency: SignalUrgency;
  affected_systems: string[];
  op_classification: OpClassification;
}

export const VALID_URGENCY = new Set<SignalUrgency>([
  "immediate",
  "soon",
  "scheduled",
  "informational",
]);
export const VALID_OP_CLASS = new Set<OpClassification>([
  "incident",
  "change",
  "inquiry",
  "status",
  "ambient",
  "commitment",
  "blocker",
  "constraint",
  "decision_signal",
  "disagreement",
]);

const SYSTEM_KEYWORDS: Record<string, string[]> = {
  /** Map of system token -> phrases. Tenants can extend later via settings. */
  billing: ["billing", "payment", "invoice", "stripe", "subscription"],
  auth: ["auth", "login", "oauth", "jwt", "session", "sso", "password"],
  frontend: ["ui", "frontend", "ux", "react", "next", "css", "design", "page"],
  backend: ["api", "backend", "endpoint", "server", "express", "node"],
  database: ["db", "database", "sqlite", "postgres", "schema", "migration"],
  infra: ["infra", "deploy", "docker", "k8s", "terraform", "ci/cd", "pipeline"],
  ads: ["ads", "campaign", "google ads", "meta ads", "facebook ad"],
  legal: ["legal", "compliance", "privacy", "gdpr", "tos", "policy"],
  hiring: ["hire", "candidate", "interview", "recruit", "offer"],
  customer: ["customer", "user complaint", "churn", "support ticket"],
};

/**
 * Heuristic enricher — runs when no LLM is available, or as a sanity floor on
 * top of LLM output. Cheap; always returns sensible defaults.
 *
 * Urgency rules:
 *   - high risk          -> immediate
 *   - explicit "asap"/"now"/"urgent" tokens -> immediate
 *   - medium risk        -> soon
 *   - "this week"/"by friday"/dates -> scheduled
 *   - default            -> informational
 *
 * Classification rules:
 *   - keywords containing "outage"/"down"/"broken" -> incident
 *   - "deploy"/"release"/"ship"/"merge" -> change
 *   - "?" tokens / "how do" / "what is" -> inquiry
 *   - "status"/"update"/"fyi" -> status
 *   - default -> ambient
 */
export function enrichHeuristic(content: string, detected: DetectedSignal): EnrichmentExtras {
  const text = String(content || "").toLowerCase();

  let urgency: SignalUrgency = "informational";
  if (detected.risk === "high" || /\b(asap|now|immediately|urgent|p0|sev[01])\b/i.test(text)) {
    urgency = "immediate";
  } else if (detected.risk === "medium") {
    urgency = "soon";
  } else if (
    /\b(today|tomorrow|this week|by friday|by monday|by eod|by tomorrow|next week)\b/i.test(text)
  ) {
    urgency = "scheduled";
  }

  let op_classification: OpClassification = "ambient";
  if (/\b(outage|down|broken|incident|sev|degraded|failing|failure)\b/i.test(text)) {
    op_classification = "incident";
  } else if (/\b(deploy|deployed|release|shipped|merge|merged|rollout|rolling out)\b/i.test(text)) {
    op_classification = "change";
  } else if (/\?|^\s*(how|what|why|where|when|who|can we|should we)\b/i.test(text)) {
    op_classification = "inquiry";
  } else if (/\b(status|update|fyi|heads up|note that)\b/i.test(text)) {
    op_classification = "status";
  } else if (detected.signal_type === "execution") {
    op_classification = "commitment";
  }

  const affected = new Set<string>();
  for (const [system, keywords] of Object.entries(SYSTEM_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) affected.add(system);
  }

  return {
    urgency,
    op_classification,
    affected_systems: Array.from(affected),
  };
}

/** Coerce an LLM JSON object to a valid EnrichmentExtras, falling back per-field. */
export function coerceEnrichment(
  raw: unknown,
  fallback: EnrichmentExtras,
): EnrichmentExtras {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;

  const u = String(o.urgency ?? "").toLowerCase() as SignalUrgency;
  const urgency: SignalUrgency = VALID_URGENCY.has(u) ? u : fallback.urgency;

  const c = String(o.op_classification ?? "").toLowerCase() as OpClassification;
  const op_classification: OpClassification = VALID_OP_CLASS.has(c) ? c : fallback.op_classification;

  let affected_systems: string[];
  if (Array.isArray(o.affected_systems)) {
    affected_systems = o.affected_systems
      .map((x) => String(x || "").trim().toLowerCase())
      .filter((x) => x.length > 0 && x.length <= 32)
      .slice(0, 8);
  } else {
    affected_systems = fallback.affected_systems;
  }

  return { urgency, op_classification, affected_systems };
}

/**
 * Apply both detector + enrichment fields in a single DB write. Caller MUST
 * have already produced both (typically from one combined LLM call). Pass
 * `error` to record an enrichment-side failure without nuking the detector
 * fields that did succeed.
 */
export function applyEnrichment(
  signalId: string,
  detected: DetectedSignal,
  extras: EnrichmentExtras,
  error: string | null = null,
) {
  db.enrichSignal(signalId, {
    intent: detected.intent,
    risk: detected.risk,
    confidence: detected.confidence,
    relatedDecisionId: detected.related_decision_id,
    error,
    urgency: extras.urgency,
    affectedSystems: extras.affected_systems,
    opClassification: extras.op_classification,
  });
}

/** Schema fragment to splice into the detector LLM prompt. */
export const ENRICHMENT_SCHEMA_HINT = [
  `"urgency":"immediate"|"soon"|"scheduled"|"informational"`,
  `"affected_systems":["billing"|"auth"|"frontend"|"backend"|"database"|"infra"|"ads"|"legal"|"hiring"|"customer"|...other lowercase tokens, max 8]`,
  `"op_classification":"incident"|"change"|"inquiry"|"status"|"ambient"|"commitment"|"blocker"|"constraint"|"decision_signal"|"disagreement"`,
].join(",");

export const ENRICHMENT_POLICY = [
  "urgency=immediate iff risk=high OR explicit time pressure (asap/now/sev0).",
  "op_classification=incident only for outages/breakage/sev events.",
  "op_classification=commitment for promises (\"I'll ship X by Y\").",
  "affected_systems is a SHORT array of system tokens, lowercase, no proper nouns.",
].join(" ");
