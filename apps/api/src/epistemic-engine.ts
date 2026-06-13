/**
 * Deterministic epistemic derivation and external-tone hygiene.
 * Backend-enforced reasoning structure (not model size).
 */

export type EpistemicOrgContext = {
  completed_decisions: number;
  learning_log_entries: number;
  /** Small boost when org has prior structured outcomes (bounded). */
  memory_confidence_boost_0_1: number;
  memory_note: string;
};

export const MIN_ACTIVATION_COMPUTED_CONFIDENCE = 0.52;
export const IRREVERSIBILITY_THRESHOLD = 0.35;
export const HIGH_RISK_OPTIONAL_CONFIDENCE = 0.72;

/** Memo slice used for derivation (avoids circular imports with institutional-reasoning). */
export type MemoDerivationInput = {
  confidence_0_1: number;
  evidence_graph: { strength_0_1: number }[];
  validation_requirements: { status: string; impact_on_confidence_0_1: number }[];
  ranked_hypotheses: { counter_signals?: string[] }[];
};

/** Strip theatrical / judicial phrasing from user-visible assistant text (external layer). */
export function sanitizeInstitutionalTone(text: string): string {
  if (!text || typeof text !== "string") return text;
  let t = text;
  const replacers: [RegExp, string][] = [
    [/\bROOT\s+CAUSE\s*—\s*CONFIRMED\b/gi, "Primary hypothesis (calibrated)"],
    [/\bROOT\s+CAUSE\b\s*[:\-—]\s*\bCONFIRMED\b/gi, "Primary hypothesis"],
    [/\bBOTH\s+AGENTS\s+RETURNED\b/gi, "Sub-agent runs completed"],
    [/\bVOW\s+LOCKED\b/gi, "Decision recorded"],
    [/\bSYNTHESIZING\s+NOW\b/gi, ""],
  ];
  for (const [re, s] of replacers) t = t.replace(re, s);
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function meanEvidenceStrength(evidence: { strength_0_1: number }[]): number {
  if (!evidence.length) return 0.45;
  const m = evidence.reduce((s, e) => s + clamp01(e.strength_0_1), 0) / evidence.length;
  return clamp01(m);
}

function validationCompleteness(reqs: { status: string }[]): number {
  if (!reqs.length) return 0;
  const sat = reqs.filter((r) => r.status === "SATISFIED").length;
  return sat / reqs.length;
}

function historicalAccuracyFactor(completedDecisions: number, learningEntries: number): number {
  const x = Math.min(20, completedDecisions) / 20;
  const y = Math.min(15, learningEntries) / 15;
  return clamp01(0.82 + 0.12 * (0.6 * x + 0.4 * y));
}

/**
 * Structural confidence: evidence × validation completeness × historical track × contradiction penalty.
 * Blended with asserted primary confidence so the prior is not discarded entirely.
 */
export function computeDerivedConfidence(
  assertedPrimary: number,
  memo: MemoDerivationInput,
  org: EpistemicOrgContext,
): { computed_confidence_0_1: number; factors: Record<string, number> } {
  const signalStrength = meanEvidenceStrength(memo.evidence_graph || []);
  const valComplete = validationCompleteness(memo.validation_requirements || []);
  const hist = historicalAccuracyFactor(org.completed_decisions, org.learning_log_entries);
  const counterN = (memo.ranked_hypotheses || []).reduce((n, h) => n + (h.counter_signals?.length || 0), 0);
  const contradictionPenalty = Math.min(0.22, 0.035 * counterN);
  const structural = clamp01(signalStrength * valComplete * hist * (1 - contradictionPenalty));
  const blended = clamp01(0.42 * clamp01(assertedPrimary) + 0.58 * structural + org.memory_confidence_boost_0_1);
  return {
    computed_confidence_0_1: blended,
    factors: {
      asserted_primary: clamp01(assertedPrimary),
      signal_strength: signalStrength,
      validation_completeness: valComplete,
      historical_accuracy_factor: hist,
      contradiction_penalty: contradictionPenalty,
      org_memory_boost: org.memory_confidence_boost_0_1,
    },
  };
}

/** Mutates memo to attach epistemic_derivation (call before JSON.stringify). Does not overwrite hypothesis probabilities. */
export function attachEpistemicDerivation(memo: MemoDerivationInput & Record<string, unknown>, org: EpistemicOrgContext): void {
  const { computed_confidence_0_1, factors } = computeDerivedConfidence(memo.confidence_0_1, memo, org);
  memo.epistemic_derivation = {
    computed_at: new Date().toISOString(),
    computed_confidence_0_1,
    asserted_confidence_0_1: memo.confidence_0_1,
    factors,
    organization_memory: {
      completed_decisions: org.completed_decisions,
      learning_log_entries: org.learning_log_entries,
      note: org.memory_note,
      confidence_boost_applied_0_1: org.memory_confidence_boost_0_1,
    },
  };
}
