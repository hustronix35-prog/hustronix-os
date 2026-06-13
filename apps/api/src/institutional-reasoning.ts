/**
 * Structured reasoning on `decision_ledger.decision_reasoning` (JSON).
 * v2 = legacy activation shape; v3 = epistemic graph, validation stage, economics enums, derived confidence.
 */
import {
  MIN_ACTIVATION_COMPUTED_CONFIDENCE,
  IRREVERSIBILITY_THRESHOLD,
  HIGH_RISK_OPTIONAL_CONFIDENCE,
} from "./epistemic-engine.js";

export const INSTITUTIONAL_REASONING_VERSION_LATEST = 3;

export type EvidenceItem = {
  source: string;
  description: string;
  strength_0_1: number;
};

export type ValidationRequirement = {
  description: string;
  status: "PENDING" | "SATISFIED";
  /** How much resolving this item moves structural confidence (used for audit, not auto-math). */
  impact_on_confidence_0_1: number;
};

export type SecondaryEffectStructured = {
  effect: string;
  probability_0_1: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
};

export type RankedHypothesis = {
  id: string;
  statement: string;
  probability_0_1: number;
  supporting_evidence: EvidenceItem[];
  counter_signals: string[];
};

export type DecisionOptionV3 = {
  label: string;
  expected_impact_range: { min: number; max: number };
  execution_cost: "LOW" | "MEDIUM" | "HIGH";
  strategic_risk: "LOW" | "MEDIUM" | "HIGH";
  operational_risk: string;
  time_to_signal: string;
  reversibility_0_1: number;
  decision_confidence_0_1: number;
};

export type PostRecoveryEquilibrium = {
  feature_adoption_plan: string;
  monetization_impact: string;
  onboarding_learning_system: string;
  future_experimentation_model: string;
};

export type ReasoningReliability = {
  reliability_confidence_0_1: number;
  known_blind_spots: string[];
};

export type CausalValidationBlock = {
  complete: boolean;
  checklist_completed: string[];
  instrumentation_integrity_verified: boolean;
  exact_abandonment_or_dropoff_step_documented: string;
};

export type AlternativeHypothesis = {
  hypothesis: string;
  relative_plausibility_0_1: number;
  what_would_disconfirm: string;
};

/** v2 memo (still activatable with legacy validator). */
export type InstitutionalReasoningV2 = {
  institutional_version?: 2;
  primary_hypothesis: string;
  confidence_0_1: number;
  supporting_evidence: string[];
  missing_validation: string[];
  unverified_assumptions: string[];
  alternative_hypotheses: AlternativeHypothesis[];
  causal_validation: CausalValidationBlock;
  second_order_effects: string[];
  recommended_actions: Array<{
    label: string;
    expected_impact: string;
    execution_complexity: string;
    strategic_risk: string;
    operational_risk: string;
    time_to_signal: string;
    reversible: boolean;
    decision_confidence_0_1: number;
  }>;
  post_recovery_equilibrium: PostRecoveryEquilibrium;
  reasoning_reliability: ReasoningReliability;
};

export type InstitutionalReasoningV3 = {
  institutional_version: 3;
  epistemic_derivation?: {
    computed_at: string;
    computed_confidence_0_1: number;
    asserted_confidence_0_1: number;
    factors: Record<string, number>;
    organization_memory: {
      completed_decisions: number;
      learning_log_entries: number;
      note: string;
      confidence_boost_applied_0_1: number;
    };
  };
  /** Calibrated primary mass (should match max-probability ranked row before server derivation). */
  confidence_0_1: number;
  ranked_hypotheses: RankedHypothesis[];
  evidence_graph: EvidenceItem[];
  validation_requirements: ValidationRequirement[];
  secondary_effects_structured: SecondaryEffectStructured[];
  missing_validation: string[];
  unverified_assumptions: string[];
  causal_validation: CausalValidationBlock;
  second_order_effects: string[];
  recommended_actions: DecisionOptionV3[];
  post_recovery_equilibrium: PostRecoveryEquilibrium;
  reasoning_reliability: ReasoningReliability;
};

export type InstitutionalReasoning = InstitutionalReasoningV2 | InstitutionalReasoningV3;

export function parseInstitutionalReasoning(raw: unknown): InstitutionalReasoning | null {
  if (raw == null || raw === "") return null;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") return null;
    return o as InstitutionalReasoning;
  } catch {
    return null;
  }
}

function isV3(m: InstitutionalReasoning): m is InstitutionalReasoningV3 {
  return Number((m as InstitutionalReasoningV3).institutional_version) === 3;
}

function nonEmptyStrings(arr: unknown, minLen: number, label: string): string[] {
  if (!Array.isArray(arr) || arr.length < minLen) {
    throw new Error(`Commit blocked: ${label} must be a string array with at least ${minLen} entr${minLen === 1 ? "y" : "ies"}.`);
  }
  const out = arr.map((x) => String(x ?? "").trim());
  if (out.some((s) => !s)) {
    throw new Error(`Commit blocked: ${label} entries must be non-empty strings.`);
  }
  return out;
}

function assertHypothesisLanguage(primaryHypothesis: string) {
  const h = primaryHypothesis.trim();
  if (!h) throw new Error("Commit blocked: primary hypothesis statement is empty.");
  if (
    /\broot\s*cause\b.*\bconfirmed\b|\bconfirmed\b.*\broot\s*cause\b/i.test(h) ||
    /\bprimary\s*cause\b.*\bconfirmed\b|\bconfirmed\b.*\bprimary\s*cause\b/i.test(h) ||
    /\bculprit\b/i.test(h)
  ) {
    throw new Error(
      "Commit blocked: hypotheses must use calibrated language, not judicial certainty (ROOT CAUSE CONFIRMED, culprit).",
    );
  }
}

function validateEvidenceGraph(items: EvidenceItem[], label: string) {
  if (!Array.isArray(items) || items.length < 2) {
    throw new Error(`Commit blocked: ${label} requires at least two evidence items with source, description, strength_0_1.`);
  }
  for (let i = 0; i < items.length; i++) {
    const e = items[i];
    if (!e || typeof e.source !== "string" || !e.source.trim() || typeof e.description !== "string" || !e.description.trim()) {
      throw new Error(`Commit blocked: ${label}[${i}] requires source and description.`);
    }
    if (typeof e.strength_0_1 !== "number" || e.strength_0_1 < 0 || e.strength_0_1 > 1) {
      throw new Error(`Commit blocked: ${label}[${i}].strength_0_1 must be in [0, 1].`);
    }
  }
}

export function validateInstitutionalV2ForActivation(memo: InstitutionalReasoningV2): void {
  assertHypothesisLanguage(memo.primary_hypothesis);

  if (typeof memo.confidence_0_1 !== "number" || memo.confidence_0_1 < 0 || memo.confidence_0_1 > 1) {
    throw new Error("Commit blocked: confidence_0_1 must be a number in [0, 1].");
  }

  nonEmptyStrings(memo.supporting_evidence, 1, "supporting_evidence");
  nonEmptyStrings(memo.missing_validation, 1, "missing_validation");
  nonEmptyStrings(memo.unverified_assumptions, 1, "unverified_assumptions");
  nonEmptyStrings(memo.second_order_effects, 1, "second_order_effects");

  const alts = memo.alternative_hypotheses;
  if (!Array.isArray(alts) || alts.length < 2) {
    throw new Error("Commit blocked: alternative_hypotheses must include at least two distinct hypotheses.");
  }
  for (let i = 0; i < alts.length; i++) {
    const a = alts[i];
    if (!a || typeof a.hypothesis !== "string" || !a.hypothesis.trim()) {
      throw new Error(`Commit blocked: alternative_hypotheses[${i}].hypothesis required.`);
    }
    if (typeof a.relative_plausibility_0_1 !== "number" || a.relative_plausibility_0_1 < 0 || a.relative_plausibility_0_1 > 1) {
      throw new Error(`Commit blocked: alternative_hypotheses[${i}].relative_plausibility_0_1 must be in [0, 1].`);
    }
    if (!String(a.what_would_disconfirm || "").trim()) {
      throw new Error(`Commit blocked: alternative_hypotheses[${i}].what_would_disconfirm required.`);
    }
  }

  const cv = memo.causal_validation;
  if (!cv || typeof cv !== "object") {
    throw new Error("Commit blocked: causal_validation object required.");
  }
  if (cv.instrumentation_integrity_verified !== true) {
    throw new Error(
      "Commit blocked: causal_validation.instrumentation_integrity_verified must be true before activation.",
    );
  }
  const step = String(cv.exact_abandonment_or_dropoff_step_documented ?? "").trim();
  if (step.length < 3) {
    throw new Error(
      "Commit blocked: exact_abandonment_or_dropoff_step_documented must name the validated funnel or drop-off step (non-trivial string).",
    );
  }
  const checklist = cv.checklist_completed;
  if (!Array.isArray(checklist) || checklist.length < 1 || !checklist.every((c) => String(c).trim())) {
    throw new Error("Commit blocked: causal_validation.checklist_completed must list completed checks (non-empty strings).");
  }

  const eq = memo.post_recovery_equilibrium;
  if (!eq || typeof eq !== "object") {
    throw new Error("Commit blocked: post_recovery_equilibrium required.");
  }
  for (const k of [
    "feature_adoption_plan",
    "monetization_impact",
    "onboarding_learning_system",
    "future_experimentation_model",
  ] as const) {
    if (!String(eq[k] ?? "").trim()) {
      throw new Error(`Commit blocked: post_recovery_equilibrium.${k} must be non-empty (long-term equilibrium).`);
    }
  }

  const rel = memo.reasoning_reliability;
  if (!rel || typeof rel !== "object") {
    throw new Error("Commit blocked: reasoning_reliability required.");
  }
  if (typeof rel.reliability_confidence_0_1 !== "number" || rel.reliability_confidence_0_1 < 0 || rel.reliability_confidence_0_1 > 1) {
    throw new Error("Commit blocked: reasoning_reliability.reliability_confidence_0_1 must be in [0, 1].");
  }
  nonEmptyStrings(rel.known_blind_spots, 1, "reasoning_reliability.known_blind_spots");

  const actions = memo.recommended_actions;
  if (!Array.isArray(actions) || actions.length < 1) {
    throw new Error("Commit blocked: recommended_actions must include at least one option with full decision economics.");
  }
  for (let i = 0; i < actions.length; i++) {
    const ac = actions[i];
    const need = [
      "label",
      "expected_impact",
      "execution_complexity",
      "strategic_risk",
      "operational_risk",
      "time_to_signal",
    ] as const;
    for (const key of need) {
      if (!String(ac?.[key] ?? "").trim()) {
        throw new Error(`Commit blocked: recommended_actions[${i}].${key} required.`);
      }
    }
    if (typeof ac.reversible !== "boolean") {
      throw new Error(`Commit blocked: recommended_actions[${i}].reversible must be boolean.`);
    }
    if (typeof ac.decision_confidence_0_1 !== "number" || ac.decision_confidence_0_1 < 0 || ac.decision_confidence_0_1 > 1) {
      throw new Error(`Commit blocked: recommended_actions[${i}].decision_confidence_0_1 must be in [0, 1].`);
    }
  }
}

export function validateInstitutionalV3ForActivation(memo: InstitutionalReasoningV3): void {
  if (!memo.epistemic_derivation || typeof memo.epistemic_derivation.computed_confidence_0_1 !== "number") {
    throw new Error(
      "Commit blocked: v3 decisions require server epistemic_derivation (computed confidence). Re-save the decision from an authorized path.",
    );
  }
  if (memo.epistemic_derivation.computed_confidence_0_1 < MIN_ACTIVATION_COMPUTED_CONFIDENCE) {
    throw new Error(
      `Commit blocked: derived confidence ${memo.epistemic_derivation.computed_confidence_0_1.toFixed(3)} is below activation floor ${MIN_ACTIVATION_COMPUTED_CONFIDENCE}. Improve evidence strength, satisfy validation requirements, or reduce contradiction signals.`,
    );
  }

  const ranked = memo.ranked_hypotheses;
  if (!Array.isArray(ranked) || ranked.length < 3) {
    throw new Error("Commit blocked: ranked_hypotheses must include at least three competing explanations.");
  }
  let sum = 0;
  for (let i = 0; i < ranked.length; i++) {
    const h = ranked[i];
    if (!h?.id || !String(h.statement).trim()) throw new Error(`Commit blocked: ranked_hypotheses[${i}] requires id and statement.`);
    assertHypothesisLanguage(h.statement);
    if (typeof h.probability_0_1 !== "number" || h.probability_0_1 < 0 || h.probability_0_1 > 1) {
      throw new Error(`Commit blocked: ranked_hypotheses[${i}].probability_0_1 must be in [0, 1].`);
    }
    sum += h.probability_0_1;
    validateEvidenceGraph(h.supporting_evidence || [], `ranked_hypotheses[${i}].supporting_evidence`);
    if (!Array.isArray(h.counter_signals)) {
      throw new Error(`Commit blocked: ranked_hypotheses[${i}].counter_signals must be an array (may be empty).`);
    }
  }
  if (Math.abs(sum - 1) > 0.08) {
    throw new Error(
      `Commit blocked: ranked_hypotheses probabilities must approximately sum to 1 (within 0.08); got ${sum.toFixed(4)}.`,
    );
  }

  const top = ranked.reduce((a, b) => (a.probability_0_1 >= b.probability_0_1 ? a : b));
  if (typeof memo.confidence_0_1 === "number" && Math.abs(memo.confidence_0_1 - top.probability_0_1) > 0.02) {
    throw new Error(
      "Commit blocked: confidence_0_1 must align with the highest-probability ranked hypothesis (within 0.02).",
    );
  }

  validateEvidenceGraph(memo.evidence_graph, "evidence_graph");

  const reqs = memo.validation_requirements;
  if (!Array.isArray(reqs) || reqs.length < 2) {
    throw new Error("Commit blocked: validation_requirements must list at least two requirements.");
  }
  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i];
    if (!r || !String(r.description).trim()) throw new Error(`Commit blocked: validation_requirements[${i}].description required.`);
    if (r.status !== "PENDING" && r.status !== "SATISFIED") {
      throw new Error(`Commit blocked: validation_requirements[${i}].status must be PENDING or SATISFIED.`);
    }
    if (typeof r.impact_on_confidence_0_1 !== "number" || r.impact_on_confidence_0_1 < 0 || r.impact_on_confidence_0_1 > 1) {
      throw new Error(`Commit blocked: validation_requirements[${i}].impact_on_confidence_0_1 must be in [0, 1].`);
    }
  }
  if (reqs.some((r) => r.status !== "SATISFIED")) {
    throw new Error(
      "Commit blocked: all validation_requirements must be SATISFIED before activation (pipeline: signal → hypotheses → validation → economics → enforcement).",
    );
  }

  const sec = memo.secondary_effects_structured;
  if (!Array.isArray(sec) || sec.length < 1) {
    throw new Error("Commit blocked: secondary_effects_structured must include at least one modeled downstream effect.");
  }
  for (let i = 0; i < sec.length; i++) {
    const s = sec[i];
    if (!s?.effect?.trim()) throw new Error(`Commit blocked: secondary_effects_structured[${i}].effect required.`);
    if (typeof s.probability_0_1 !== "number" || s.probability_0_1 < 0 || s.probability_0_1 > 1) {
      throw new Error(`Commit blocked: secondary_effects_structured[${i}].probability_0_1 must be in [0, 1].`);
    }
    if (!["LOW", "MEDIUM", "HIGH"].includes(s.severity)) {
      throw new Error(`Commit blocked: secondary_effects_structured[${i}].severity must be LOW, MEDIUM, or HIGH.`);
    }
  }

  nonEmptyStrings(memo.missing_validation, 1, "missing_validation");
  nonEmptyStrings(memo.unverified_assumptions, 1, "unverified_assumptions");
  nonEmptyStrings(memo.second_order_effects, 1, "second_order_effects");

  const cv = memo.causal_validation;
  if (!cv || cv.instrumentation_integrity_verified !== true) {
    throw new Error("Commit blocked: causal_validation.instrumentation_integrity_verified must be true.");
  }
  const step = String(cv.exact_abandonment_or_dropoff_step_documented ?? "").trim();
  if (step.length < 3) {
    throw new Error("Commit blocked: exact_abandonment_or_dropoff_step_documented required.");
  }
  const checklist = cv.checklist_completed;
  if (!Array.isArray(checklist) || checklist.length < 1 || !checklist.every((c) => String(c).trim())) {
    throw new Error("Commit blocked: causal_validation.checklist_completed required.");
  }
  if (cv.complete !== true) {
    throw new Error("Commit blocked: causal_validation.complete must be true for activation.");
  }

  const eq = memo.post_recovery_equilibrium;
  if (!eq || typeof eq !== "object") throw new Error("Commit blocked: post_recovery_equilibrium required.");
  for (const k of [
    "feature_adoption_plan",
    "monetization_impact",
    "onboarding_learning_system",
    "future_experimentation_model",
  ] as const) {
    if (!String(eq[k] ?? "").trim()) throw new Error(`Commit blocked: post_recovery_equilibrium.${k} required.`);
  }

  const rel = memo.reasoning_reliability;
  if (!rel || typeof rel.reliability_confidence_0_1 !== "number" || rel.reliability_confidence_0_1 < 0 || rel.reliability_confidence_0_1 > 1) {
    throw new Error("Commit blocked: reasoning_reliability.reliability_confidence_0_1 must be in [0, 1].");
  }
  nonEmptyStrings(rel.known_blind_spots, 1, "reasoning_reliability.known_blind_spots");

  const opts = memo.recommended_actions;
  if (!Array.isArray(opts) || opts.length < 1) {
    throw new Error("Commit blocked: recommended_actions must include at least one DecisionOption.");
  }
  const costSet = new Set(["LOW", "MEDIUM", "HIGH"]);
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    if (!o?.label?.trim()) throw new Error(`Commit blocked: recommended_actions[${i}].label required.`);
    const r = o.expected_impact_range;
    if (!r || typeof r.min !== "number" || typeof r.max !== "number" || r.min > r.max) {
      throw new Error(`Commit blocked: recommended_actions[${i}].expected_impact_range requires numeric min <= max.`);
    }
    if (!costSet.has(o.execution_cost) || !costSet.has(o.strategic_risk)) {
      throw new Error(`Commit blocked: recommended_actions[${i}].execution_cost and strategic_risk must be LOW|MEDIUM|HIGH.`);
    }
    if (!String(o.operational_risk).trim() || !String(o.time_to_signal).trim()) {
      throw new Error(`Commit blocked: recommended_actions[${i}].operational_risk and time_to_signal required.`);
    }
    if (typeof o.reversibility_0_1 !== "number" || o.reversibility_0_1 < 0 || o.reversibility_0_1 > 1) {
      throw new Error(`Commit blocked: recommended_actions[${i}].reversibility_0_1 must be in [0, 1].`);
    }
    if (typeof o.decision_confidence_0_1 !== "number" || o.decision_confidence_0_1 < 0 || o.decision_confidence_0_1 > 1) {
      throw new Error(`Commit blocked: recommended_actions[${i}].decision_confidence_0_1 must be in [0, 1].`);
    }
    if (
      o.reversibility_0_1 < IRREVERSIBILITY_THRESHOLD &&
      o.decision_confidence_0_1 < HIGH_RISK_OPTIONAL_CONFIDENCE
    ) {
      throw new Error(
        `Commit blocked: recommended_actions[${i}] is low-reversibility (${o.reversibility_0_1.toFixed(2)}) but option confidence ${o.decision_confidence_0_1.toFixed(2)} is below ${HIGH_RISK_OPTIONAL_CONFIDENCE}. Raise evidence or defer.`,
      );
    }
  }
}

/** Commit to ACTIVE: institutional JSON must pass causal flag plus version-specific schema. */
export function requireCausalValidationForActivation(reasoningRaw: unknown): void {
  if (reasoningRaw == null || reasoningRaw === "") return;
  if (typeof reasoningRaw === "string" && reasoningRaw.trim() === "") return;
  const memo = parseInstitutionalReasoning(reasoningRaw);
  if (memo === null) {
    throw new Error(
      "Commit blocked: decision_reasoning is set but is not valid JSON. Repair the record before activation.",
    );
  }
  const ver = Number((memo as { institutional_version?: number }).institutional_version) || 2;

  if (ver >= 3) {
    if (!isV3(memo)) {
      throw new Error("Commit blocked: institutional_version indicates v3 but payload is not a v3 memo.");
    }
    if (memo.causal_validation?.complete !== true) {
      throw new Error(
        "Commit blocked: CAUSAL_VALIDATION_REQUIRED. causal_validation.complete must be true for v3 activation.",
      );
    }
    validateInstitutionalV3ForActivation(memo);
    return;
  }

  if (memo.causal_validation?.complete !== true) {
    throw new Error(
      "Commit blocked: CAUSAL_VALIDATION_REQUIRED. Set causal_validation.complete to true only after validation work is satisfied.",
    );
  }
  validateInstitutionalV2ForActivation(memo as InstitutionalReasoningV2);
}

export const COORDINATOR_INSTITUTIONAL_CONTRACT = `
## INSTITUTIONAL REASONING CONTRACT (NON-DISCRETIONARY)

Reasoning is **architecture-bound**, not prompt-bound. The ledger enforces epistemic structure on activation.

### Pipeline (v3 — preferred)
\`signals → ranked_hypotheses → evidence_graph → validation_requirements (all SATISFIED) → secondary_effects_structured → decision economics → derived confidence → enforcement\`

### v3 \`log_strategic_decision\` (institutional_version: 3)
- **ranked_hypotheses**: ≥3 items; each has id, statement, **probability_0_1** (masses sum ≈ 1), **supporting_evidence** as evidence objects (\`source\`, \`description\`, \`strength_0_1\`), **counter_signals** (may be empty).
- **evidence_graph**: ≥2 global evidence objects linking claims to observable signals.
- **validation_requirements**: ≥2 rows; each \`SATISFIED\` before activation; include abandonment / instrumentation / segment checks as appropriate.
- **secondary_effects_structured**: downstream effects with probability and LOW|MEDIUM|HIGH severity.
- **recommended_actions**: each option includes **expected_impact_range** \`{min,max}\`, **execution_cost** and **strategic_risk** enums (LOW|MEDIUM|HIGH), **reversibility_0_1**, **decision_confidence_0_1**. Low-reversibility options require higher option confidence (enforced server-side).
- **post_recovery_equilibrium** + **reasoning_reliability** + **causal_validation** as in v2.

The server attaches **epistemic_derivation** with **computed_confidence_0_1** from evidence strength, validation completeness, historical track, and contradiction penalty. Activation requires computed confidence ≥ ${MIN_ACTIVATION_COMPUTED_CONFIDENCE}.

### v2 (legacy)
institutional_version 2 retains the prior flat schema; new work should use v3.

### Tone (external)
No emoji, no self-narration, no "ROOT CAUSE CONFIRMED". Internal exploration may be verbose; user-visible text stays calm and evidence-linked.

### Execution task types
Use **VERIFY** (not VALIDATE) for verification tasks.
`.trim();
