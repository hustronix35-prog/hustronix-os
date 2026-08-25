/**
 * Talk V2.1 understanding — speech acts + semantic operations.
 * Architecture frozen; this strengthens routing only.
 */
import { extractEntities } from "../entity-resolver.js";
import { classifySituationIntent } from "../situation-chat.js";
import type { TalkContext } from "./talk-context.js";

export type TalkMode =
  | "GENERAL"
  | "LEARN"
  | "COMPANY_QA"
  | "SITUATION_INVESTIGATION"
  | "BRAINSTORM"
  | "STRATEGY"
  | "CUSTOMER_ANALYSIS"
  | "EXECUTION"
  | "OUTCOME"
  | "COMPARISON"
  | "CASUAL"
  | "COUNTERFACTUAL"
  | "DECISION"
  | "FOLLOWUP";

/** How heavily Company Brain should shape the answer. ACTION = governed kernel. */
export type ContextMode = "GENERAL" | "COMPANY" | "HYBRID" | "ACTION";

export type TalkScope = "COMPANY" | "CUSTOMER" | "SITUATION" | "CURRENT_CONTEXT" | "TEAM" | "NONE";

export type TalkIntent = {
  mode: TalkMode;
  contextMode: ContextMode;
  scope: TalkScope;
  objective?: string;
  entity?: string;
  topic?: string;
  requiresCompanyContext: boolean;
  requiresCurrentState: boolean;
  isCounterfactual: boolean;
  counterfactualAssumption?: string;
  optionSelect?: number;
  deepen?: "why" | "evidence" | "all" | "cost" | "missing" | "aggressive" | "wrong" | "test" | "then";
  turnIntoDecision: boolean;
  governedAction: boolean;
  /** Hard topic switch away from sticky investigation focus. */
  clearFocus?: boolean;
  /** Suspend sticky customer entities for this turn's retrieval. */
  suspendStickyFocus?: boolean;
  needsClarification?: string;
};

const TEAM_OR_GENERIC = new Set([
  "sales",
  "engineering",
  "security",
  "finance",
  "product",
  "support",
  "executive",
  "qa",
  "customer success",
]);

const BUSINESS_CONCEPTS =
  /\b(cac|ltv|nrr|grr|arr|mrr|aov|asp|sql|mql|churn|retention|pipeline|coverage|forecast|quota|funnel|win rate|conversion rate|conversion|sales|revenue|gross margin|burn|runway|icp|tam|sam|som)\b/i;

export function isAnaphora(question: string): boolean {
  const low = String(question || "").toLowerCase().trim();
  return /^(why\??|why is that\??|why do you think that\??|how\??|and\??|that\??|this\??|and then\??|explain that|say that differently|what do you mean|how much would this cost\??|what evidence\??|what else\??|how would we test that\??|can we actually do (this|that)\??|what happened after that\??|did it work\??|what did we learn\??)$/.test(
    low,
  );
}

export function isGovernedActionMode(mode: TalkMode): boolean {
  return mode === "DECISION" || mode === "EXECUTION" || mode === "OUTCOME";
}

function namedCustomer(question: string): string | undefined {
  const hits = extractEntities(question).filter((e) => !TEAM_OR_GENERIC.has(e.label.toLowerCase()));
  const preferred = hits.find((e) => e.type === "customer" || e.type === "product" || e.type === "project");
  return (preferred || hits[0])?.label;
}

/** Prefer conversation subject over weak/generic entity extracts. */
function conversationFocus(ctx: TalkContext | null | undefined): string | undefined {
  return ctx?.activeCustomerId || ctx?.currentEntities?.customers?.[0] || ctx?.recentEntities?.[0];
}

function optionSelect(low: string): number | undefined {
  const m =
    low.match(/\b(?:let'?s do|go with|choose|pick)\s+(?:option\s*)?(\d{1,2})\b/) ||
    low.match(/\boption\s*(\d{1,2})\b/) ||
    low.match(/^(\d{1,2})$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : undefined;
}

function wantsCompanyExample(low: string): boolean {
  return /\b(using (our|my) (company|data|pipeline|customers?)|use (our|my) company|with our (company|data|pipeline)|our company as (an )?example|apply (this|it|that) to (us|our|the company)|apply that to our situation|for (us|our company)|map (this|that|it) (to|onto) (us|our))\b/i.test(
    low,
  );
}

function isProductOrientation(low: string): boolean {
  return (
    /\bwhat is this( thing)?( actually)? for\b/.test(low) ||
    /\bwhat('s| is) this( thing)?\??$/.test(low) ||
    /\bwhat is hustronix\b/.test(low) ||
    /\bwhat (do|does) (you|this|hustronix) do\b/.test(low) ||
    /\bwhat can (this|you|hustronix) do\b/.test(low) ||
    /\bhow does (this|hustronix) help\b/.test(low) ||
    /\bwhy would i use (this|hustronix)\b/.test(low) ||
    /\bwhat am i looking at\b/.test(low) ||
    /\bwhat is this (product|tool|app|system)\b/.test(low)
  );
}

function isEvidenceAsk(low: string): boolean {
  return (
    /\bwhat evidence\b/.test(low) ||
    /\bshow me the evidence\b/.test(low) ||
    /\bwhat are you basing that on\b/.test(low) ||
    /\bwhere did (this|that) come from\b/.test(low) ||
    /\bcan you show me the proof\b/.test(low) ||
    /\bprove (it|that)\b/.test(low) ||
    /\bwhy do you think that\b/.test(low)
  );
}

function isTemporalAsk(low: string): boolean {
  return (
    /\bwhat changed\b/.test(low) ||
    /\bwhat('s| is) changed\b/.test(low) ||
    /\bwhat('s| is) different (this|last)?\s*(week|month|quarter)?\b/.test(low) ||
    /\bwhat happened recently\b/.test(low) ||
    /\bwhat('s| is) getting worse\b/.test(low) ||
    /\bwhat('s| is) improving\b/.test(low) ||
    /\bwhat('s| is) new\b/.test(low) ||
    /\bwhat should i know about today\b/.test(low) ||
    /\bwhat happened since\b/.test(low) ||
    /\brecently\b/.test(low) && /\b(change|happened|different|worse|improved)\b/.test(low)
  );
}

function isDecisionOutcomeAsk(low: string): boolean {
  return (
    /\bdid (our |the |that |my )?(last )?decision\b/.test(low) ||
    /\bdid (that|it|the decision) (work|help|improve)\b/.test(low) ||
    /\bwas the decision effective\b/.test(low) ||
    /\bwhat happened after (we |the |that )?decision\b/.test(low) ||
    /\bwhat happened after we decided\b/.test(low) ||
    /\bdid we make the right call\b/.test(low) ||
    /\bwhat did we learn\b/.test(low) ||
    /\bwhat happened because of that decision\b/.test(low)
  );
}

function possessiveCompany(low: string): boolean {
  return /\b(our|my|we|us)\b/.test(low) && !/\b(teach|basics|fundamentals|what is a |what are a )\b/.test(low);
}

function detectTopic(low: string): string | undefined {
  if (/\bcac\b/.test(low)) return "cac";
  if (/\bconversion(\s+rate)?\b/.test(low)) return "conversion";
  if (/\bfunnel\b/.test(low)) return "funnel";
  if (/\bpipeline\b/.test(low)) return "pipeline";
  if (/\bchurn|retention\b/.test(low)) return "retention";
  if (/\blaunch\b/.test(low)) return "launch";
  if (/\bsales\b/.test(low)) return "sales";
  if (/\brevenue\b/.test(low)) return "revenue";
  return undefined;
}

function isCompanyOverview(low: string): boolean {
  return (
    /\bwhat('s| is|s) going on\b/.test(low) ||
    /\bwhat('s| is) happening (in|with|at) (the |our |my )?company\b/.test(low) ||
    /\bhow is (the |our |my )?company (doing|looking)\b/.test(low) ||
    /\bgive me (a |an )?(company )?(overview|status|snapshot)\b/.test(low) ||
    /\bwhat('s| is) the (current )?state of (the |our |my )?company\b/.test(low)
  );
}

function isCustomerRisk(low: string): boolean {
  return (
    /\bwhich customers?\b/.test(low) ||
    /\bwho (should i|should we|do i|do we) (worry|be worried|be concerned)\b/.test(low) ||
    /\b(customers?|accounts?) (i |we )?(should |to )?(worry|be worried|be concerned) about\b/.test(low) ||
    /\b(at risk|in trouble|unhealthy|red flags?|might churn|could lose|needs? attention)\b/.test(low) &&
      /\b(customer|account|who|which)\b/.test(low)
  );
}

function isChallenge(low: string): boolean {
  return (
    /\bare (you|we) sure\b/.test(low) ||
    /\bcould it (be|also be)\b/.test(low) ||
    /\bwhat if (we('re| are) wrong|that('s| is) wrong)\b/.test(low) ||
    /\bwhat else could (explain|be true|be going on|cause)\b/.test(low) ||
    /\bcould there be another (reason|explanation)\b/.test(low) ||
    /\bis there another explanation\b/.test(low) ||
    /\bmaybe .{0,40} isn'?t the problem\b/.test(low) ||
    /\bwhat are we missing\b/.test(low) ||
    /\bis it (just )?(a )?pric/.test(low) ||
    /\b(product|pricing).{0,40}(not|vs|versus|or).{0,40}(pricing|product)\b/.test(low) ||
    /\bsure it('s| is) .{0,40} and not\b/.test(low)
  );
}

function isExplore(low: string): boolean {
  return (
    /\bbrainstorm\b/.test(low) ||
    /\bwhat could we try\b/.test(low) ||
    /\bwhat can we try\b/.test(low) ||
    /\bgive me (some )?options\b/.test(low) ||
    /\bwhat are (our |some )?options\b/.test(low) ||
    /\bhow could we approach\b/.test(low) ||
    /\bhow should we tackle\b/.test(low) ||
    /\bwhat are some ways\b/.test(low) ||
    /\bwhat can we do (about|here)?\b/.test(low) ||
    /\bgive me (?:(?:five|5|\d+)\s+)?(?:ideas|ways)\b/.test(low)
  );
}

function isRecommendation(low: string): boolean {
  return (
    /\bwhat would you do\b/.test(low) ||
    /\bif you were me\b/.test(low) ||
    /\bwhat should (i|we) do\b/.test(low) ||
    /\bwhat would you recommend\b/.test(low) ||
    /\bhow would you prioritize\b/.test(low)
  );
}

function isTopicOverrideBottleneck(low: string): boolean {
  return (
    /\bwhat('s| is) blocking\b/.test(low) ||
    /\bwho('s| is) blocking\b/.test(low) ||
    /\bwhat('s| is) the (upstream )?blocker\b/.test(low) ||
    /\b(blocked on|waiting on)\b/.test(low) ||
    /\blaunch\b/.test(low) && /\b(block|blocked|blocker|waiting|dependency)\b/.test(low)
  );
}

function withContext(
  mode: TalkMode,
  scope: TalkScope,
  contextMode: ContextMode,
  extra?: Partial<TalkIntent>,
): TalkIntent {
  const requiresCompany =
    extra?.requiresCompanyContext ?? (contextMode !== "GENERAL" && scope !== "NONE");
  return {
    mode,
    contextMode,
    scope,
    entity: extra?.entity,
    topic: extra?.topic,
    requiresCompanyContext: requiresCompany,
    requiresCurrentState: contextMode !== "GENERAL",
    isCounterfactual: false,
    turnIntoDecision: false,
    governedAction: false,
    ...extra,
    contextMode: extra?.contextMode ?? contextMode,
    mode: extra?.mode ?? mode,
    scope: extra?.scope ?? scope,
  };
}

/**
 * Classify what the founder wants and whether Company Brain should participate.
 */
export function classifyTalkIntent(
  question: string,
  opts?: { action?: string | null; context?: TalkContext | null },
): TalkIntent {
  const q = String(question || "").trim();
  const low = q.toLowerCase();
  const ctx = opts?.context || null;
  const hasConvo = Boolean(ctx?.lastAnswer || (ctx?.recentMessages?.length || 0) > 0);
  const extracted = namedCustomer(q);
  const convoFocus = conversationFocus(ctx);
  const topic = detectTopic(low);
  const kernel = classifySituationIntent(q);

  if (opts?.action) {
    if (opts.action === "execute" || opts.action === "complete" || opts.action === "feasibility") {
      return withContext("EXECUTION", "SITUATION", "ACTION", { governedAction: true, entity: convoFocus });
    }
    if (opts.action === "outcome" || opts.action === "learn" || opts.action === "reverse") {
      return withContext("OUTCOME", "SITUATION", "ACTION", { governedAction: true, entity: convoFocus });
    }
    return withContext("DECISION", "SITUATION", "ACTION", { governedAction: true, entity: convoFocus });
  }

  if (/^(hi|hey|hello|yo|thanks|thank you|ok|okay|cool|got it|gm|good morning|good evening)[\s!.?]*$/i.test(q)) {
    return withContext("CASUAL", "NONE", "GENERAL", {
      requiresCompanyContext: false,
      requiresCurrentState: false,
    });
  }

  // Product orientation — never company dump
  if (isProductOrientation(low)) {
    return withContext("GENERAL", "NONE", "GENERAL", {
      objective: "product_orientation",
      requiresCompanyContext: false,
      requiresCurrentState: false,
      clearFocus: false,
    });
  }

  const opt = optionSelect(low);
  if (opt && hasConvo) {
    return withContext("STRATEGY", ctx?.activeSituationId ? "CURRENT_CONTEXT" : "COMPANY", "HYBRID", {
      optionSelect: opt,
      turnIntoDecision: /\b(let'?s do|go with|choose|pick|make it a decision|turn this into)\b/.test(low),
      objective: "select_option",
      entity: convoFocus || extracted,
    });
  }

  if (/\b(turn this into a decision|make (this|it) a decision|let'?s do it|let'?s go with that|let'?s act on this|assign this to)\b/.test(low) && hasConvo) {
    return withContext("DECISION", "CURRENT_CONTEXT", "ACTION", {
      turnIntoDecision: true,
      governedAction: true,
      entity: convoFocus || extracted,
    });
  }

  // Explicit commit (not "what else could be true")
  if (
    /\b(create the decision|create a decision|draft the decision|instrumentation is|validate next)\b/i.test(low) ||
    kernel === "create" ||
    kernel === "instrumentation" ||
    kernel === "validate"
  ) {
    return withContext("DECISION", "SITUATION", "ACTION", { governedAction: true, entity: convoFocus || extracted });
  }

  // Governed reverse only — conversational outcome evaluation is separate
  if (/\breverse (this|the) decision\b/i.test(low) || kernel === "reverse") {
    return withContext("OUTCOME", "SITUATION", "ACTION", { governedAction: true, entity: convoFocus || extracted });
  }

  if (
    /\b(execute (it|this|the recommended)|commit|approve and execute|can we (actually )?execute|mark as done|complete the decision|execute this immediately|delete the decision)\b/i.test(
      low,
    ) ||
    kernel === "execute" ||
    kernel === "complete" ||
    kernel === "feasibility"
  ) {
    return withContext("EXECUTION", "SITUATION", "ACTION", { governedAction: true, entity: convoFocus || extracted });
  }

  // Conversational decision outcome / learning (not mutation)
  if (isDecisionOutcomeAsk(low) || kernel === "outcome" || kernel === "learn") {
    return withContext("COMPANY_QA", hasConvo || convoFocus || extracted ? "CURRENT_CONTEXT" : "COMPANY", "COMPANY", {
      objective: "decision_outcome",
      entity: extracted || convoFocus,
      governedAction: false,
    });
  }

  // Focused evidence follow-up — preserve conversation subject
  if (isEvidenceAsk(low) && (hasConvo || convoFocus)) {
    return withContext("FOLLOWUP", "CURRENT_CONTEXT", "COMPANY", {
      deepen: "evidence",
      objective: "focused_evidence",
      entity: convoFocus || extracted,
      requiresCompanyContext: true,
    });
  }

  // Temporal delta
  if (isTemporalAsk(low)) {
    return withContext("COMPANY_QA", "COMPANY", "COMPANY", {
      objective: "temporal_delta",
      suspendStickyFocus: true,
      entity: undefined,
    });
  }

  // Metric — before overview / sticky paths
  if (
    (/\bwhat (is|are) (our|my)\b/i.test(low) || /\bwhat('s| is) our\b/i.test(low)) &&
    BUSINESS_CONCEPTS.test(low)
  ) {
    return withContext("COMPANY_QA", "COMPANY", "COMPANY", {
      objective: "company_metric",
      topic: topic || "metric",
      suspendStickyFocus: true,
      clearFocus: false,
    });
  }

  // Explicit topic override (launch / blocker) — before sticky customer
  if (isTopicOverrideBottleneck(low) || kernel === "blocked") {
    return withContext("COMPANY_QA", "TEAM", "COMPANY", {
      objective: "bottleneck",
      topic: topic || "launch",
      entity: undefined,
      suspendStickyFocus: true,
      clearFocus: true,
      governedAction: false,
    });
  }

  // Challenge / alternative hypotheses — conversation focus wins
  if (isChallenge(low) || kernel === "hypotheses") {
    const focus = convoFocus || (hasConvo ? extracted : undefined);
    return withContext("COUNTERFACTUAL", focus ? "CURRENT_CONTEXT" : "COMPANY", "HYBRID", {
      isCounterfactual: true,
      counterfactualAssumption: q,
      objective: /\bwhat else\b/.test(low) ? "alternative_hypotheses" : "challenge",
      entity: focus,
      suspendStickyFocus: false,
    });
  }

  if (/\bwhat if\b|\bif we (ignore|double|had half|focus entirely)|problem isn'?t\b/i.test(low)) {
    const focus = convoFocus || extracted;
    return withContext("COUNTERFACTUAL", focus ? "CURRENT_CONTEXT" : "COMPANY", "HYBRID", {
      isCounterfactual: true,
      counterfactualAssumption: q,
      objective: "counterfactual",
      entity: focus,
    });
  }

  // Company overview — entity NONE means company-wide retrieve
  if (isCompanyOverview(low)) {
    return withContext("COMPANY_QA", "COMPANY", "COMPANY", {
      objective: "company_overview",
      suspendStickyFocus: true,
      entity: undefined,
    });
  }

  // Customer risk scan
  if (isCustomerRisk(low)) {
    return withContext("COMPANY_QA", "COMPANY", "COMPANY", {
      objective: "customer_risk",
      suspendStickyFocus: true,
      entity: undefined,
    });
  }

  // Explore / brainstorm synonyms
  if (isExplore(low)) {
    const deepen = /\bmissing\b/.test(low) ? "missing" : /\baggressive\b/.test(low) ? "aggressive" : undefined;
    return withContext("BRAINSTORM", hasConvo || convoFocus ? "CURRENT_CONTEXT" : "COMPANY", "HYBRID", {
      objective: /churn|retention/.test(low) ? "reduce_churn" : /sales|revenue/.test(low) ? "increase_sales" : "ideate",
      deepen,
      entity: convoFocus || extracted,
      requiresCompanyContext: true,
    });
  }

  // Recommendation / strategy voice
  if (isRecommendation(low)) {
    return withContext("STRATEGY", hasConvo || convoFocus ? "CURRENT_CONTEXT" : "COMPANY", "HYBRID", {
      objective: "recommendation",
      entity: convoFocus || extracted,
      topic,
    });
  }

  // Learning / teaching
  const learnAsk =
    /\b(teach me|basics? of|fundamentals? of|overview of|give me (?:the )?basics|tell me (?:the )?basics|explain (?:the )?(basics?|fundamentals?)|how does .{0,40} work)\b/i.test(
      low,
    ) ||
    /\bwhat (is|are) (a |an |the )?(sales funnel|funnel|pipeline|cac|ltv|nrr|churn rate)\b/i.test(low) ||
    (/\bwhat (is|are)\b/i.test(low) && BUSINESS_CONCEPTS.test(low) && !possessiveCompany(low));

  if (learnAsk) {
    const hybrid = wantsCompanyExample(low);
    return withContext("LEARN", hybrid ? "COMPANY" : "NONE", hybrid ? "HYBRID" : "GENERAL", {
      objective: hybrid ? "learn_with_company" : "basics",
      topic,
      entity: hybrid ? extracted || convoFocus : undefined,
      requiresCompanyContext: hybrid,
      requiresCurrentState: hybrid,
      clearFocus: !hybrid,
    });
  }

  // LEARN → apply concepts to company (before overview default)
  if (wantsCompanyExample(low) || /\buse (our|my) company\b/i.test(low)) {
    const priorTopic =
      topic ||
      ctx?.currentTopic ||
      detectTopic(String(ctx?.lastUserQuestion || "").toLowerCase()) ||
      (ctx?.lastMode === "LEARN" || ctx?.lastMode === "GENERAL" ? "sales" : undefined) ||
      "sales";
    const customerFocus =
      extracted && !TEAM_OR_GENERIC.has(extracted.toLowerCase())
        ? extracted
        : convoFocus && !TEAM_OR_GENERIC.has(String(convoFocus).toLowerCase())
          ? convoFocus
          : undefined;
    return withContext("LEARN", "COMPANY", "HYBRID", {
      objective: "learn_with_company",
      topic: priorTopic,
      entity: customerFocus,
      requiresCompanyContext: true,
      requiresCurrentState: true,
      suspendStickyFocus: !customerFocus,
    });
  }

  if (/\bwhat (is|are)\b/i.test(low) && BUSINESS_CONCEPTS.test(low) && !/\b(our|my)\b/.test(low)) {
    return withContext("GENERAL", "NONE", "GENERAL", {
      objective: "define",
      topic,
      requiresCompanyContext: false,
      requiresCurrentState: false,
    });
  }

  if (/\b(compare|versus|\bvs\.?\b|which (is|are) better|trade-?off)\b/i.test(low)) {
    return withContext("COMPARISON", "COMPANY", "HYBRID", { objective: "compare", entity: extracted || convoFocus });
  }

  // Anaphora / deepen — after challenge so "what else?" short form still works via isChallenge when longer
  if (
    isAnaphora(q) ||
    /^(how much would this cost\??|show me everything|what evidence|why is that wrong|how would we test that\??)$/i.test(low)
  ) {
    const deepen: TalkIntent["deepen"] = /\bevidence|everything\b/.test(low)
      ? "evidence"
      : /\bcost\b/.test(low)
        ? "cost"
        : /\bwrong\b/.test(low)
          ? "wrong"
          : /\btest\b/.test(low)
            ? "test"
            : /\bthen\b/.test(low)
              ? "then"
              : "why";
    const priorMode = ctx?.lastMode || "";
    const priorCm = ctx?.lastContextMode || "";
    let cm: ContextMode = "HYBRID";
    if (priorMode === "LEARN" || priorMode === "GENERAL" || priorCm === "GENERAL") {
      cm = deepen === "evidence" ? "COMPANY" : "GENERAL";
    } else if (priorMode === "CUSTOMER_ANALYSIS" || priorMode === "SITUATION_INVESTIGATION") {
      cm = "COMPANY";
    }
    const followEntity = cm === "GENERAL" ? undefined : convoFocus || extracted;
    if (kernel === "evidence" || deepen === "evidence") {
      return withContext("FOLLOWUP", hasConvo ? "CURRENT_CONTEXT" : "COMPANY", "COMPANY", {
        deepen: "evidence",
        entity: followEntity,
      });
    }
    return withContext("FOLLOWUP", hasConvo ? "CURRENT_CONTEXT" : "COMPANY", cm, {
      deepen,
      entity: followEntity,
      requiresCompanyContext: cm !== "GENERAL",
    });
  }

  if (/^how can (i|we) grow\??$/i.test(low) || /^how (do|should) (i|we) grow\??$/i.test(low)) {
    return withContext("COMPANY_QA", "NONE", "GENERAL", {
      objective: "clarify_growth",
      needsClarification:
        "Do you mean revenue growth, customer growth, or overall company growth? I can look at your current data for whichever you mean.",
      requiresCompanyContext: false,
      requiresCurrentState: false,
    });
  }

  if (
    /\b(why is \w+|what('s| is) going wrong with|are we sure .{0,60}at risk|struggling with)\b/i.test(low) ||
    (extracted && /\b(at risk|going wrong|why is|what happened|problem)\b/i.test(low))
  ) {
    return withContext(extracted ? "CUSTOMER_ANALYSIS" : "SITUATION_INVESTIGATION", extracted ? "CUSTOMER" : "SITUATION", "COMPANY", {
      objective: "investigate",
      entity: extracted,
    });
  }

  if (extracted && /\b(customer|account|renewal|churn|health)\b/i.test(low)) {
    return withContext("CUSTOMER_ANALYSIS", "CUSTOMER", "COMPANY", { objective: "customer", entity: extracted });
  }

  if (
    /\b(how can (i|we) (increase|improve|reduce)|where should we focus|what should we prioritize|this month|30-day)\b/i.test(
      low,
    ) ||
    /\b(increase (sales|revenue)|reduce churn|improve retention|focus this (week|month)|grow (sales|revenue|customers?|pipeline))\b/i.test(
      low,
    ) ||
    (/\bstrategy\b/i.test(low) && /\b(sales|revenue|churn|retention|growth|go-?to-?market|gtm)\b/i.test(low))
  ) {
    const objective = /churn|retention/.test(low)
      ? "reduce_churn"
      : /sales|revenue/.test(low)
        ? "increase_sales"
        : "focus";
    return withContext("STRATEGY", extracted ? "CUSTOMER" : "COMPANY", "HYBRID", {
      objective,
      entity: extracted || convoFocus,
      topic,
    });
  }

  if (/\b(what should (i|we) focus|this week|biggest (risk|worry)|needs attention|what matters|what worries you|how are (our|my) sales)\b/i.test(low)) {
    return withContext("COMPANY_QA", "COMPANY", "COMPANY", {
      objective: "attention",
      suspendStickyFocus: true,
      entity: undefined,
    });
  }

  if (extracted) {
    return withContext("CUSTOMER_ANALYSIS", "CUSTOMER", "COMPANY", { objective: "customer", entity: extracted });
  }

  if (BUSINESS_CONCEPTS.test(low) && !possessiveCompany(low) && !extracted) {
    return withContext("GENERAL", "NONE", "GENERAL", {
      objective: "general_business",
      topic,
      requiresCompanyContext: false,
      requiresCurrentState: false,
    });
  }

  // Narrow / unmatched company ask — do NOT treat as company-wide overview.
  if (/\b(europe|european|asia|latam|expansion strategy|middle east)\b/i.test(low)) {
    return withContext("COMPANY_QA", "COMPANY", "COMPANY", {
      objective: "company",
      topic: topic || "expansion",
      suspendStickyFocus: true,
      entity: undefined,
    });
  }

  return withContext("COMPANY_QA", "COMPANY", "COMPANY", {
    objective: "company_overview",
    suspendStickyFocus: true,
    entity: undefined,
  });
}

/** @deprecated alias — prefer classifyTalkIntent */
export function understandTalkQuery(
  question: string,
  opts?: { action?: string | null; context?: TalkContext | null },
): TalkIntent {
  return classifyTalkIntent(question, opts);
}
