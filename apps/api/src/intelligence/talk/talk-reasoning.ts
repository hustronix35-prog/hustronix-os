/**

 * Talk reasoning — evidence vs inference vs recommendation.

 * Does not mint decisions or mutate the ledger.

 */

import type { TalkIntent } from "./talk-understanding.js";

import type { TalkContext, TalkOption } from "./talk-context.js";

import type { CompanyContext } from "./talk-retrieval.js";

import { evidenceFacts, evidenceIds, situationFact } from "./talk-evidence.js";



export type TalkProvenance = {

  recommendation: string;

  supportingEvidence: string[];

  relatedSituations: string[];

  priorOutcomes: string[];

  confidence: number;

};



export type TalkReasoning = {

  evidence: string[];

  reasoning: string[];

  recommendations: string[];

  uncertainties: string[];

  ideas: TalkOption[];

  provenance: TalkProvenance;

};



function salesLevers(ctx: CompanyContext): TalkOption[] {

  const retain = ctx.situations.filter((s) => /renewal|churn|forecast/i.test(`${s.title} ${s.explanation || ""}`));

  const pipeline = ctx.situations.filter((s) => /pipeline|coverage|forecast|deal/i.test(`${s.title} ${s.explanation || ""}`));

  return [

    {

      n: 1,

      label: "Retain at-risk accounts",

      summary: retain[0]

        ? `Protect existing revenue. ${situationFact(retain[0])}`

        : "Protect existing revenue before adding volume.",

    },

    {

      n: 2,

      label: "Improve pipeline quality",

      summary: pipeline[0]

        ? `The forecast issue suggests the problem may be reliability of the pipeline, not simply volume. ${pipeline[0].title}.`

        : "Tighten conversion and coverage before pouring more leads in.",

    },

    {

      n: 3,

      label: "Expand healthy accounts",

      summary: "Look for expansion among accounts that are not currently worsening.",

    },

    {

      n: 4,

      label: "Increase qualified pipeline",

      summary: "Only after retention and coverage are stable — otherwise new volume hides the same leak.",

    },

    {

      n: 5,

      label: "Change sales allocation",

      summary: ctx.people.some((p) => p.blocked)

        ? "Reallocate from blocked work onto the accounts already showing risk."

        : "Put coverage on the accounts the Company Brain already flagged.",

    },

  ];

}



function churnLevers(_ctx: CompanyContext): TalkOption[] {

  return [

    { n: 1, label: "Stabilize product reliability", summary: "Fix the reliability issues showing up in customer evidence before offering concessions." },

    { n: 2, label: "Weekly exec rhythm on live renewals", summary: "Give CS an exec update tied to live renewal threads, not a generic health score." },

    { n: 3, label: "Pull engineering onto the hottest account", summary: "If a connector or SLA thread is already on the ledger, staff it." },

    { n: 4, label: "Honor failed-outcome priors", summary: "If discounting already failed, do not lower the evidence bar and try it again." },

    { n: 5, label: "Isolate implementation vs renewal", summary: "Do not treat billing or implementation threads as the same churn story." },

  ];

}



function wantsLevers(intent: TalkIntent, question: string): boolean {

  if (intent.contextMode === "GENERAL") return false;

  if (intent.mode === "LEARN" || intent.mode === "GENERAL") return false;

  if (intent.objective === "basics" || intent.objective === "define") return false;

  if (intent.mode === "BRAINSTORM") return true;

  if (intent.mode === "STRATEGY") return true;

  if (intent.objective === "increase_sales" || intent.objective === "reduce_churn") return true;

  return /brainstorm|ways to|how can (i|we) (increase|improve|grow|reduce)/i.test(question);

}



export function reasonAboutCompany(opts: {

  question: string;

  intent: TalkIntent;

  ctx: CompanyContext;

  conversation?: TalkContext | null;

}): TalkReasoning {

  const { intent, ctx, conversation } = opts;

  const deep = intent.mode === "FOLLOWUP" && intent.deepen === "evidence";

  const evidence = intent.contextMode === "GENERAL" ? [] : evidenceFacts(ctx, deep ? 8 : 4);

  const failed = ctx.outcomes.filter((o) => o.result === "failed");

  const ideas = wantsLevers(intent, opts.question)

    ? intent.objective === "reduce_churn" || /churn|retention/.test(opts.question)

      ? churnLevers(ctx)

      : salesLevers(ctx)

    : [];



  const reasoning: string[] = [];

  const hasRetention = ctx.situations.some((s) => /renewal|churn/i.test(s.title));

  const hasPipeline = ctx.situations.some((s) => /pipeline|forecast|coverage/i.test(s.title));



  if (intent.mode === "LEARN" || intent.mode === "GENERAL" || intent.objective === "basics" || intent.objective === "define") {

    if (intent.contextMode === "HYBRID" && ctx.situations[0]) {

      reasoning.push(

        `Your live board already shows ${ctx.situations[0].title} — useful as a concrete example of how this shows up here.`,

      );

    } else {

      reasoning.push("This is general operating knowledge — not a claim about your ledger.");

    }

  } else if (hasRetention && hasPipeline && intent.mode === "STRATEGY") {

    reasoning.push("This suggests retention and pipeline quality may be more urgent than simply increasing lead volume.");

  } else if (ctx.situations[0]) {

    reasoning.push(

      `The strongest live thread is ${ctx.situations[0].title}, and it is ${

        ctx.situations[0].trajectory === "WORSENING" ? "getting worse" : "not improving"

      }.`,

    );

  }

  if (failed.length && intent.contextMode !== "GENERAL" && intent.mode !== "LEARN") {

    reasoning.push(

      "We tried a similar approach previously and it didn't improve the underlying outcome. I'd be cautious about repeating it.",

    );

  }

  if (intent.isCounterfactual) {

    reasoning.push(

      "If we take that assumption seriously, the current evidence still has to be explained — ignoring it does not make the signals go away.",

    );

  }



  const recommendations: string[] = [];

  if (intent.mode === "LEARN" || intent.mode === "GENERAL" || intent.objective === "basics" || intent.objective === "define") {

    if (intent.contextMode === "HYBRID" && ctx.situations[0]) {

      recommendations.push(`Use ${ctx.situations[0].title} as the working example when you want to go deeper.`);

    }

  } else if (intent.objective === "increase_sales" || (intent.mode === "STRATEGY" && /sales|revenue/.test(opts.question))) {

    recommendations.push("Prioritize retention → pipeline quality → expansion.");

  } else if (intent.objective === "reduce_churn") {

    recommendations.push("Stabilize the hottest renewal before running a broad retention campaign.");

  } else if (ctx.situations[0] && intent.mode !== "COMPANY_QA") {

    recommendations.push(`Investigate ${ctx.situations[0].title} before committing the ledger.`);

  } else if (ctx.situations[0]) {

    recommendations.push(`Dig into ${ctx.situations[0].title} if you want the next concrete move.`);

  }



  const uncertainties: string[] = [];

  if (intent.contextMode !== "GENERAL" && intent.mode !== "LEARN" && intent.mode !== "GENERAL") {

    if (ctx.evidence.length < 2) {

      uncertainties.push("We don't currently have enough evidence to know the root cause.");

    } else {

      uncertainties.push(

        "The strongest thread I'm seeing is the live customer and pipeline work. I'm less confident we know a single cause.",

      );

    }

    if (!ctx.people.length && intent.mode === "STRATEGY") {

      uncertainties.push("I'd want to check sales capacity before committing to this.");

    }

  }



  if (intent.optionSelect && conversation?.lastOptions.length) {

    const picked =

      conversation.lastOptions.find((o) => o.n === intent.optionSelect) ||

      conversation.lastOptions[intent.optionSelect - 1];

    if (picked) {

      recommendations.unshift(`Option ${picked.n} is to ${picked.label.toLowerCase()}. ${picked.summary}`);

    }

  }



  const rec = recommendations[0] || ideas[0]?.label || "Stay with the evidence before acting.";

  return {

    evidence,

    reasoning,

    recommendations,

    uncertainties,

    ideas,

    provenance: {

      recommendation: rec,

      supportingEvidence: intent.contextMode === "GENERAL" ? [] : evidenceIds(ctx),

      relatedSituations: intent.contextMode === "GENERAL" ? [] : ctx.situations.map((s) => s.id),

      priorOutcomes: intent.contextMode === "GENERAL" ? [] : ctx.outcomes.map((o) => o.decision_id),

      confidence:

        intent.contextMode === "GENERAL"

          ? 0.7

          : ctx.insufficient

            ? 0.2

            : Math.min(0.86, 0.45 + ctx.situations.length * 0.1 + ctx.evidence.length * 0.04),

    },

  };

}


