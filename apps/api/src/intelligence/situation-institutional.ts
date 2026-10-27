/**
 * Build a completeable v3 institutional memo from a Situation object.
 * Talk fills validation in-chat; activation still uses validateInstitutionalV3ForActivation.
 */
import {
  parseInstitutionalReasoning,
  validateInstitutionalV3ForActivation,
  type InstitutionalReasoningV3,
  type EvidenceItem,
  type ValidationRequirement,
} from "../institutional-reasoning.js";
import { attachEpistemicDerivation } from "../epistemic-engine.js";
import { db } from "../database.js";

export type SituationMemoInput = {
  id: string;
  title: string;
  pattern_id: string;
  stage: string;
  confidence: number;
  trajectory: string;
  explanation: string | null;
  first_observed_day: number | null;
  facets: string[];
  entities: string[];
  recommended: string[];
  evidence: Array<{ sim_day: number | null; facet: string | null; snippet: string | null }>;
  competingTitles: string[];
  proposed_tasks?: unknown;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function evidenceItems(input: SituationMemoInput): EvidenceItem[] {
  const fromTrail = input.evidence
    .filter((e) => (e.snippet || "").trim())
    .slice(0, 8)
    .map((e) => ({
      source: e.facet ? `situation:${e.facet}` : e.sim_day != null ? `day:${e.sim_day}` : "situation_evidence",
      description: `Day ${e.sim_day ?? "?"}: ${(e.snippet || "").replace(/\s+/g, " ").slice(0, 220)}`,
      strength_0_1: clamp01(0.55 + (input.confidence || 0) * 0.3),
    }));
  if (fromTrail.length >= 2) return fromTrail;
  const fallback: EvidenceItem[] = [
    {
      source: "situation_object",
      description: `${input.title} — ${input.explanation || "clustered from connected signals"}.`.slice(0, 280),
      strength_0_1: clamp01(input.confidence || 0.55),
    },
    {
      source: input.facets[0] ? `facet:${input.facets[0]}` : "situation_facets",
      description: input.facets.length
        ? `Evidence dimensions: ${input.facets.slice(0, 8).join(", ")}.`
        : `Trajectory ${input.trajectory}; stage ${input.stage}.`,
      strength_0_1: clamp01((input.confidence || 0.5) * 0.9),
    },
  ];
  return [...fromTrail, ...fallback].slice(0, 8);
}

function pairEvidence(graph: EvidenceItem[], offset: number): EvidenceItem[] {
  if (graph.length >= 2) {
    return [graph[offset % graph.length]!, graph[(offset + 1) % graph.length]!];
  }
  return graph;
}

/** Completeable v3 memo. Validations start PENDING; causal_validation.complete is false. */
export function buildInstitutionalMemoFromSituation(input: SituationMemoInput): InstitutionalReasoningV3 {
  const graph = evidenceItems(input);
  const asserted = clamp01(Math.min(0.62, Math.max(0.42, input.confidence || 0.55)));
  const altMass = Number(((1 - asserted) / 2).toFixed(4));
  const remainder = Number((1 - asserted - altMass).toFixed(4));
  const competing = input.competingTitles.find((t) => t && t !== input.title);
  const recs = input.recommended.length
    ? input.recommended.slice(0, 3)
    : [`Address ${input.title} with linked evidence`];

  const memo: InstitutionalReasoningV3 = {
    institutional_version: 3,
    confidence_0_1: asserted,
    ranked_hypotheses: [
      {
        id: "h_primary",
        statement: `${input.title} is a real organizational issue that requires a governed decision.`,
        probability_0_1: asserted,
        supporting_evidence: pairEvidence(graph, 0),
        counter_signals: input.trajectory === "IMPROVING" ? ["Recent signals suggest improvement"] : [],
      },
      {
        id: "h_instrumentation",
        statement: "The observed signals may reflect instrumentation or process noise rather than the stated risk.",
        probability_0_1: altMass,
        supporting_evidence: pairEvidence(graph, 1),
        counter_signals: ["Multiple independent sources would make noise less likely"],
      },
      {
        id: "h_other",
        statement: competing
          ? `The same evidence may be better explained by ${competing}.`
          : "The cluster may be coincidental and not yet decision-worthy.",
        probability_0_1: remainder,
        supporting_evidence: pairEvidence(graph, 2),
        counter_signals: [],
      },
    ],
    evidence_graph: graph,
    validation_requirements: [
      {
        description: "Operator reviewed competing explanations (what else could be true).",
        status: "PENDING",
        impact_on_confidence_0_1: 0.35,
      },
      {
        description: "Operator confirmed evidence instrumentation is trustworthy.",
        status: "PENDING",
        impact_on_confidence_0_1: 0.4,
      },
    ],
    secondary_effects_structured: [
      {
        effect: `If unaddressed, ${input.title} continues on a ${input.trajectory.toLowerCase()} trajectory.`,
        probability_0_1: input.trajectory === "WORSENING" ? 0.7 : 0.4,
        severity: input.trajectory === "WORSENING" ? "HIGH" : "MEDIUM",
      },
    ],
    missing_validation: ["Operator has not yet confirmed competing hypotheses and instrumentation in Talk."],
    unverified_assumptions: [
      input.entities.length
        ? `Primary entities (${input.entities.slice(0, 4).join(", ")}) are correctly resolved.`
        : "Entity resolution on this cluster is still thin.",
    ],
    causal_validation: {
      complete: false,
      checklist_completed: [],
      instrumentation_integrity_verified: false,
      exact_abandonment_or_dropoff_step_documented: input.first_observed_day != null
        ? `Situation first observed on day ${input.first_observed_day}; decision-ready after evidence accumulated across ${input.facets.slice(0, 4).join(", ") || "linked signals"}.`
        : `Decision-ready after evidence accumulated for ${input.title}.`,
    },
    second_order_effects: [
      "Execution load on owning teams if the decision is committed.",
      "Customer or partner communication if the trajectory stays worsening.",
    ],
    recommended_actions: recs.map((label) => ({
      label: String(label).slice(0, 200),
      expected_impact_range: { min: 0.2, max: 0.8 },
      execution_cost: "MEDIUM" as const,
      strategic_risk: "MEDIUM" as const,
      operational_risk: "Requires owning-team hours after commit",
      time_to_signal: "Days to first execution update",
      reversibility_0_1: 0.62,
      decision_confidence_0_1: asserted,
    })),
    post_recovery_equilibrium: {
      feature_adoption_plan: "Keep Talk as the operating path; inspect Decide/Execute ledgers after commit.",
      monetization_impact: "Stabilizing this situation protects the related account or delivery commitment.",
      onboarding_learning_system: "Outcome evaluation (later wave) will record whether this decision worked.",
      future_experimentation_model: "Do not loosen readiness gates from this single commit.",
    },
    reasoning_reliability: {
      reliability_confidence_0_1: clamp01((input.confidence || 0.5) * 0.9),
      known_blind_spots: [
        "Talk validation is operator-confirmed, not an independent measurement audit.",
        input.facets.length < 2 ? "Facet coverage is still thin." : "Competing situations may share entities.",
      ],
    },
  };
  if (input.proposed_tasks) {
    (memo as InstitutionalReasoningV3 & { proposed_tasks?: unknown }).proposed_tasks = input.proposed_tasks;
  }
  return memo;
}

export function isCompleteableV3(memo: unknown): memo is InstitutionalReasoningV3 {
  if (!memo || typeof memo !== "object") return false;
  const m = memo as InstitutionalReasoningV3;
  return Number(m.institutional_version) === 3 && Array.isArray(m.ranked_hypotheses) && m.ranked_hypotheses.length >= 3;
}

export function loadDecisionMemo(decisionId: string): InstitutionalReasoningV3 | null {
  const row = db.getDecisionLedgerRow(decisionId);
  const parsed = parseInstitutionalReasoning(row?.decision_reasoning);
  if (isCompleteableV3(parsed)) return parsed;
  if (parsed && Number((parsed as { institutional_version?: number }).institutional_version) === 3) {
    return parsed as unknown as InstitutionalReasoningV3;
  }
  return null;
}

export function pendingValidations(memo: InstitutionalReasoningV3): ValidationRequirement[] {
  return (memo.validation_requirements || []).filter((r) => r.status !== "SATISFIED");
}

export function v3ActivationError(memo: InstitutionalReasoningV3): string | null {
  try {
    validateInstitutionalV3ForActivation(memo);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function appendChecklist(memo: InstitutionalReasoningV3, note: string) {
  const list = Array.isArray(memo.causal_validation.checklist_completed)
    ? [...memo.causal_validation.checklist_completed]
    : [];
  if (!list.includes(note)) list.push(note);
  memo.causal_validation.checklist_completed = list;
}

export function satisfyNextValidation(memo: InstitutionalReasoningV3): { did: boolean; description: string | null } {
  const next = pendingValidations(memo)[0];
  if (!next) return { did: false, description: null };
  next.status = "SATISFIED";
  appendChecklist(memo, `Satisfied: ${next.description}`);
  return { did: true, description: next.description };
}

export function confirmHypothesesReviewed(memo: InstitutionalReasoningV3): void {
  const req = memo.validation_requirements.find((r) => /competing|what else/i.test(r.description));
  if (req && req.status !== "SATISFIED") {
    req.status = "SATISFIED";
    appendChecklist(memo, "Competing explanations reviewed in Talk");
  } else if (!req) {
    satisfyNextValidation(memo);
  }
}

export function confirmInstrumentation(memo: InstitutionalReasoningV3): void {
  memo.causal_validation.instrumentation_integrity_verified = true;
  appendChecklist(memo, "Instrumentation integrity confirmed in Talk");
  const req = memo.validation_requirements.find((r) => /instrumentation|trustworthy/i.test(r.description));
  if (req && req.status !== "SATISFIED") req.status = "SATISFIED";
}

/** Set complete=true only when the real v3 activator would pass. */
export function sealCausalValidationIfReady(userId: string, memo: InstitutionalReasoningV3): {
  sealed: boolean;
  gap: string | null;
} {
  if (pendingValidations(memo).length > 0) {
    memo.causal_validation.complete = false;
    return { sealed: false, gap: `Still PENDING: ${pendingValidations(memo).map((r) => r.description).join("; ")}` };
  }
  if (memo.causal_validation.instrumentation_integrity_verified !== true) {
    memo.causal_validation.complete = false;
    return { sealed: false, gap: "Instrumentation integrity is not confirmed yet." };
  }
  if (String(memo.causal_validation.exact_abandonment_or_dropoff_step_documented || "").trim().length < 3) {
    memo.causal_validation.complete = false;
    return { sealed: false, gap: "Drop-off / decision-ready step is not documented." };
  }
  if (!memo.causal_validation.checklist_completed.length) {
    appendChecklist(memo, "Talk validation checklist");
  }
  memo.missing_validation = ["None remaining — operator completed Talk validation."];
  memo.causal_validation.complete = true;
  attachEpistemicDerivation(memo, db.getEpistemicOrgContext(userId));
  const gap = v3ActivationError(memo);
  if (gap) {
    memo.causal_validation.complete = false;
    return { sealed: false, gap };
  }
  return { sealed: true, gap: null };
}

export function describeValidationState(memo: InstitutionalReasoningV3): string {
  const pending = pendingValidations(memo);
  const inst = memo.causal_validation.instrumentation_integrity_verified === true;
  const complete = memo.causal_validation.complete === true;
  const lines = [
    complete
      ? "Validation is complete. You can execute — this will commit the decision and spawn governed tasks."
      : "This decision is still DRAFT. Talk must satisfy governance before execute.",
    "",
    ...memo.validation_requirements.map(
      (r) => `• ${r.status === "SATISFIED" ? "Done" : "Pending"} — ${r.description}`,
    ),
    `• Instrumentation: ${inst ? "confirmed" : "not confirmed"}`,
  ];
  if (pending.length) {
    lines.push("", `Next: ${pending[0]!.description}`);
  } else if (!inst) {
    lines.push("", "Next: confirm instrumentation is trustworthy.");
  }
  return lines.join("\n");
}
