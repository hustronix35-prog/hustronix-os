/**
 * Talk V2.1 retrieval planning — selective Company Brain slices.
 */
import type { TalkIntent, ContextMode } from "./talk-understanding.js";
import type { TalkContext } from "./talk-context.js";

export type RetrievalPlan = {
  required: boolean;
  entities: string[];
  situations: boolean;
  decisions: boolean;
  execution: boolean;
  outcomes: boolean;
  signals: boolean;
  metrics: boolean;
  organization: boolean;
  customers: boolean;
  dependencies: boolean;
  maxSituations: number;
  maxEvidence: number;
  reason: string;
  focusEntity?: string;
  /** Company-wide: do not require topic match / do not filter to sticky entities. */
  companyWide?: boolean;
  /** Ignore sticky conversation entities for this turn. */
  suspendSticky?: boolean;
};

export function planTalkRetrieval(opts: {
  question: string;
  intent: TalkIntent;
  conversation?: TalkContext | null;
}): RetrievalPlan {
  const { intent, conversation } = opts;
  const low = opts.question.toLowerCase();
  const cm: ContextMode = intent.contextMode;

  if (cm === "GENERAL" || intent.mode === "CASUAL" || intent.mode === "GENERAL") {
    return {
      required: false,
      entities: [],
      situations: false,
      decisions: false,
      execution: false,
      outcomes: false,
      signals: false,
      metrics: false,
      organization: false,
      customers: false,
      dependencies: false,
      maxSituations: 0,
      maxEvidence: 0,
      reason: "general_or_casual_no_company_retrieval",
    };
  }

  const suspendSticky = Boolean(intent.suspendStickyFocus || intent.clearFocus);
  const stickyEntities = suspendSticky
    ? []
    : ([...(conversation?.currentEntities?.customers || []), ...(conversation?.recentEntities || [])].filter(
        Boolean,
      ) as string[]);

  const entities = unique([intent.entity, ...stickyEntities].filter(Boolean) as string[]).slice(0, 6);
  const focusEntity = suspendSticky ? intent.entity : intent.entity || conversation?.activeCustomerId;

  if (intent.objective === "company_metric") {
    return {
      required: true,
      entities: [],
      situations: false,
      decisions: false,
      execution: false,
      outcomes: false,
      signals: false,
      metrics: true,
      organization: false,
      customers: false,
      dependencies: false,
      maxSituations: 0,
      maxEvidence: 0,
      reason: "metric_lookup",
      companyWide: false,
      suspendSticky: true,
    };
  }

  if (intent.objective === "company_overview" || intent.objective === "attention") {
    return {
      required: true,
      entities: [],
      situations: true,
      decisions: true,
      execution: false,
      outcomes: true,
      signals: true,
      metrics: false,
      organization: true,
      customers: true,
      dependencies: true,
      maxSituations: 4,
      maxEvidence: 4,
      reason: "company_overview",
      companyWide: true,
      suspendSticky: true,
    };
  }

  if (intent.objective === "customer_risk" || intent.objective === "at_risk_customers") {
    return {
      required: true,
      entities: [],
      situations: true,
      decisions: false,
      execution: false,
      outcomes: false,
      signals: true,
      metrics: false,
      organization: false,
      customers: true,
      dependencies: false,
      maxSituations: 4,
      maxEvidence: 4,
      reason: "customer_risk_scan",
      companyWide: true,
      suspendSticky: true,
    };
  }

  if (intent.objective === "bottleneck") {
    return {
      required: true,
      entities: [],
      situations: true,
      decisions: false,
      execution: true,
      outcomes: false,
      signals: true,
      metrics: false,
      organization: true,
      customers: false,
      dependencies: true,
      maxSituations: 3,
      maxEvidence: 3,
      reason: "dependency_bottleneck",
      companyWide: true,
      suspendSticky: true,
    };
  }

  if (intent.objective === "temporal_delta") {
    return {
      required: true,
      entities: [],
      situations: true,
      decisions: true,
      execution: false,
      outcomes: true,
      signals: true,
      metrics: false,
      organization: true,
      customers: true,
      dependencies: true,
      maxSituations: 5,
      maxEvidence: 5,
      reason: "temporal_delta",
      companyWide: true,
      suspendSticky: true,
    };
  }

  if (intent.objective === "decision_outcome") {
    return {
      required: true,
      entities: focusEntity ? [focusEntity] : entities,
      situations: true,
      decisions: true,
      execution: true,
      outcomes: true,
      signals: true,
      metrics: false,
      organization: false,
      customers: Boolean(focusEntity),
      dependencies: false,
      maxSituations: 3,
      maxEvidence: 4,
      reason: "decision_outcome_eval",
      focusEntity,
      companyWide: !focusEntity,
      suspendSticky: !focusEntity,
    };
  }

  if (
    intent.objective === "focused_evidence" ||
    (intent.mode === "FOLLOWUP" && intent.deepen === "evidence" && focusEntity)
  ) {
    return {
      required: true,
      entities: focusEntity ? [focusEntity] : entities.slice(0, 2),
      situations: true,
      decisions: false,
      execution: false,
      outcomes: false,
      signals: true,
      metrics: false,
      organization: false,
      customers: true,
      dependencies: false,
      maxSituations: 2,
      maxEvidence: 8,
      reason: "focused_evidence",
      focusEntity,
      companyWide: false,
      suspendSticky: false,
    };
  }

  if (intent.objective === "learn_with_company") {
    return {
      required: true,
      entities: entities.slice(0, 3),
      situations: true,
      decisions: false,
      execution: false,
      outcomes: true,
      signals: true,
      metrics: false,
      organization: false,
      customers: true,
      dependencies: false,
      maxSituations: 3,
      maxEvidence: 4,
      reason: "learn_apply_company",
      focusEntity,
      companyWide: !focusEntity,
      suspendSticky: !focusEntity,
    };
  }

  const investigate = intent.mode === "CUSTOMER_ANALYSIS" || intent.mode === "SITUATION_INVESTIGATION";
  const temporal =
    intent.objective === "temporal_delta" ||
    /\b(this month|last (month|quarter|week)|changed|getting worse|improving|after the decision|last 30 days)\b/i.test(
      low,
    );
  const learning =
    intent.objective === "decision_outcome" ||
    intent.mode === "OUTCOME" ||
    /\b(did (it|that) work|what did we learn|have we seen|previous decisions?)\b/i.test(low);
  const decisionsAsk = /\b(active decisions?|what decisions|decision ledger)\b/i.test(low);

  if (investigate && focusEntity) {
    return {
      required: true,
      entities: [focusEntity, ...entities.filter((e) => e.toLowerCase() !== focusEntity.toLowerCase())].slice(0, 3),
      situations: true,
      decisions: true,
      execution: false,
      outcomes: true,
      signals: true,
      metrics: false,
      organization: false,
      customers: true,
      dependencies: false,
      maxSituations: 2,
      maxEvidence: 6,
      reason: "focused_customer_investigation",
      focusEntity,
    };
  }

  if (learning || decisionsAsk) {
    return {
      required: true,
      entities,
      situations: true,
      decisions: true,
      execution: decisionsAsk,
      outcomes: true,
      signals: false,
      metrics: false,
      organization: false,
      customers: false,
      dependencies: false,
      maxSituations: 3,
      maxEvidence: 3,
      reason: learning ? "outcome_learning" : "active_decisions",
      focusEntity,
    };
  }

  if (intent.mode === "COUNTERFACTUAL" || intent.objective === "challenge" || intent.objective === "alternative_hypotheses") {
    return {
      required: true,
      entities: focusEntity ? [focusEntity] : entities.slice(0, 2),
      situations: true,
      decisions: false,
      execution: false,
      outcomes: true,
      signals: true,
      metrics: false,
      organization: false,
      customers: Boolean(focusEntity),
      dependencies: false,
      maxSituations: 2,
      maxEvidence: 4,
      reason: "counterfactual_focused",
      focusEntity,
    };
  }

  if (intent.mode === "STRATEGY" || intent.mode === "BRAINSTORM" || cm === "HYBRID") {
    const wide = !focusEntity;
    return {
      required: true,
      entities: wide ? [] : entities,
      situations: true,
      decisions: false,
      execution: false,
      outcomes: true,
      signals: true,
      metrics: false,
      organization: intent.mode === "STRATEGY" || intent.objective === "recommendation",
      customers: true,
      dependencies: false,
      maxSituations: temporal ? 4 : 3,
      maxEvidence: 4,
      reason: intent.objective === "recommendation" ? "recommendation_slice" : "hybrid_strategy_slice",
      focusEntity,
      companyWide: wide,
      suspendSticky: wide && !focusEntity,
    };
  }

  return {
    required: true,
    entities,
    situations: true,
    decisions: decisionsAsk,
    execution: false,
    outcomes: false,
    signals: true,
    metrics: false,
    organization: false,
    customers: true,
    dependencies: false,
    maxSituations: 3,
    maxEvidence: 4,
    reason: "company_qa_slice",
    focusEntity,
    // Only explicit overview/risk/bottleneck are company-wide; generic asks keep topic filter.
    companyWide: false,
  };
}

function unique(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const k = String(x || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}
