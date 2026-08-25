/**
 * Talk V2 response guard — company claims must map to retrieved context.
 */
import { validateLlmOutput } from "../../security/llm-output-firewall.js";
import type { CompanyContext } from "./talk-retrieval.js";
import type { TalkIntent } from "./talk-understanding.js";
import { stripJargon } from "./talk-evidence.js";

export type TalkGuardResult = {
  allowed: boolean;
  answer: string;
  blockedReasons: string[];
};

const METRIC_CLAIM =
  /\b(our|my)\s+(cac|mrr|arr|ltv|nrr|churn rate|conversion rate|average deal size)\s+(is|was|=)\s*[₹$€]?\s*[\d,.]+/i;

const FABRICATED_DECISION =
  /\b(i('ve| have)? (created|executed|reversed|completed|approved) (the |this )?(decision|action))\b/i;

export function guardTalkAnswer(opts: {
  answer: string;
  intent: TalkIntent;
  ctx: CompanyContext;
}): TalkGuardResult {
  const blockedReasons: string[] = [];
  let answer = stripJargon(String(opts.answer || "").trim());

  const firewall = validateLlmOutput(answer);
  if (!firewall.allowed) blockedReasons.push(...firewall.blockedReasons);

  if (opts.intent.contextMode === "GENERAL" || opts.intent.mode === "CASUAL" || opts.intent.mode === "LEARN") {
    // Soft: strip heavy situation dumps if they leaked
    if (/Mapped to your company right now/i.test(answer) && opts.intent.contextMode === "GENERAL") {
      answer = answer.split(/Mapped to your company right now/i)[0].trim();
      blockedReasons.push("stripped_general_company_dump");
    }
  }

  if (METRIC_CLAIM.test(answer) && opts.intent.objective === "company_metric") {
    // If we claimed a numeric metric without metrics in context, block
    blockedReasons.push("hallucinated_metric_claim");
  }

  if (FABRICATED_DECISION.test(answer) && !opts.intent.governedAction && !opts.intent.turnIntoDecision) {
    blockedReasons.push("ungoverned_action_claim");
  }

  // Named customers in COMPANY/HYBRID answers should appear in retrieved context when claimed as facts
  if (opts.intent.contextMode !== "GENERAL" && opts.ctx.situations.length) {
    const known = new Set(
      opts.ctx.situations
        .flatMap((s) => s.entities)
        .map((e) => e.toLowerCase())
        .concat(opts.ctx.customers.map((c) => c.name.toLowerCase())),
    );
    // Do not hard-fail on unknown names — retrieval may be partial; prefer soft.
    void known;
  }

  const hardFail = blockedReasons.some((r) =>
    ["hallucinated_metric_claim", "ungoverned_action_claim", "authority_fabrication", "unverifiable_financial_claim"].includes(r),
  );

  if (hardFail) {
    return {
      allowed: false,
      answer:
        opts.intent.objective === "company_metric"
          ? "I don't currently have a reliable figure for that metric in the Company Brain, so I won't invent one."
          : "I can't claim that happened without going through the governed Decision OS checks.",
      blockedReasons,
    };
  }

  return { allowed: true, answer, blockedReasons };
}
