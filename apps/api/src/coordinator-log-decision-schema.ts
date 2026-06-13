/**
 * Tool JSON Schema for `log_strategic_decision.institutional_reasoning`.
 * Coordinator tools are **v3-only** to cut prompt tokens; legacy v2 memos are still accepted via REST.
 */

const E = {
  type: "object",
  properties: {
    source: { type: "string" },
    description: { type: "string" },
    strength_0_1: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["source", "description", "strength_0_1"],
};

const CV = {
  type: "object",
  properties: {
    complete: { type: "boolean" },
    checklist_completed: { type: "array", items: { type: "string" } },
    instrumentation_integrity_verified: { type: "boolean" },
    exact_abandonment_or_dropoff_step_documented: { type: "string" },
  },
  required: [
    "complete",
    "checklist_completed",
    "instrumentation_integrity_verified",
    "exact_abandonment_or_dropoff_step_documented",
  ],
};

const EQ = {
  type: "object",
  properties: {
    feature_adoption_plan: { type: "string" },
    monetization_impact: { type: "string" },
    onboarding_learning_system: { type: "string" },
    future_experimentation_model: { type: "string" },
  },
  required: [
    "feature_adoption_plan",
    "monetization_impact",
    "onboarding_learning_system",
    "future_experimentation_model",
  ],
};

const REL = {
  type: "object",
  properties: {
    reliability_confidence_0_1: { type: "number", minimum: 0, maximum: 1 },
    known_blind_spots: { type: "array", minItems: 1, items: { type: "string" } },
  },
  required: ["reliability_confidence_0_1", "known_blind_spots"],
};

const V3_ACTION = {
  type: "object",
  properties: {
    label: { type: "string" },
    expected_impact_range: {
      type: "object",
      properties: { min: { type: "number" }, max: { type: "number" } },
      required: ["min", "max"],
    },
    execution_cost: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    strategic_risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    operational_risk: { type: "string" },
    time_to_signal: { type: "string" },
    reversibility_0_1: { type: "number", minimum: 0, maximum: 1 },
    decision_confidence_0_1: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "label",
    "expected_impact_range",
    "execution_cost",
    "strategic_risk",
    "operational_risk",
    "time_to_signal",
    "reversibility_0_1",
    "decision_confidence_0_1",
  ],
};

/** Epistemic memo v3 — sole shape exposed on coordinator `log_strategic_decision` (server attaches epistemic_derivation). */
export const institutionalReasoningToolSchema = {
  type: "object",
  properties: {
    institutional_version: { type: "integer", enum: [3] },
    confidence_0_1: { type: "number", minimum: 0, maximum: 1 },
    ranked_hypotheses: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          probability_0_1: { type: "number", minimum: 0, maximum: 1 },
          supporting_evidence: { type: "array", minItems: 2, items: E },
          counter_signals: { type: "array", items: { type: "string" } },
        },
        required: ["id", "statement", "probability_0_1", "supporting_evidence", "counter_signals"],
      },
    },
    evidence_graph: { type: "array", minItems: 2, items: E },
    validation_requirements: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          status: { type: "string", enum: ["PENDING", "SATISFIED"] },
          impact_on_confidence_0_1: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["description", "status", "impact_on_confidence_0_1"],
      },
    },
    secondary_effects_structured: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          effect: { type: "string" },
          probability_0_1: { type: "number", minimum: 0, maximum: 1 },
          severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        },
        required: ["effect", "probability_0_1", "severity"],
      },
    },
    missing_validation: { type: "array", minItems: 1, items: { type: "string" } },
    unverified_assumptions: { type: "array", minItems: 1, items: { type: "string" } },
    causal_validation: CV,
    second_order_effects: { type: "array", minItems: 1, items: { type: "string" } },
    recommended_actions: { type: "array", minItems: 1, items: V3_ACTION },
    post_recovery_equilibrium: EQ,
    reasoning_reliability: REL,
  },
  required: [
    "institutional_version",
    "confidence_0_1",
    "ranked_hypotheses",
    "evidence_graph",
    "validation_requirements",
    "secondary_effects_structured",
    "missing_validation",
    "unverified_assumptions",
    "causal_validation",
    "second_order_effects",
    "recommended_actions",
    "post_recovery_equilibrium",
    "reasoning_reliability",
  ],
};
