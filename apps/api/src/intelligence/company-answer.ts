/**
 * Grounded Company Brain answers. Facts vs inferences vs ideas.
 * Does not mint decisions or mutate the ledger.
 */
import type { CompanyContext } from "./company-context.js";
import type { TalkMode } from "./talk-mode.js";
import { formatEvidenceLine } from "./evidence-reference.js";
import type { ConversationState } from "./talk-conversation.js";

function factLines(ctx: CompanyContext, limit = 4): string[] {
  const lines: string[] = [];
  for (const s of ctx.situations.slice(0, 3)) {
    lines.push(
      `${s.title} is ${s.stage.replace(/_/g, " ").toLowerCase()} (${s.trajectory.toLowerCase()}, ${Math.round((s.confidence || 0) * 100)}% confidence).`,
    );
  }
  for (const ev of ctx.evidence.slice(0, 3)) {
    lines.push(formatEvidenceLine(ev));
  }
  if (ctx.bottleneckTalk) {
    const first = ctx.bottleneckTalk.split("\n")[0];
    if (first) lines.push(first);
  }
  for (const o of ctx.outcomes.slice(0, 2)) {
    lines.push(`A prior ${o.pattern_id || "pattern"} decision evaluated as ${o.result}.`);
  }
  return lines.slice(0, limit);
}

export function generateCompanyAnswer(opts: {
  question: string;
  mode: TalkMode;
  ctx: CompanyContext;
  conversation?: ConversationState;
}): string {
  const { question, mode, ctx, conversation } = opts;

  if (mode === "GENERAL_CONVERSATION") {
    return "Hey. What are you thinking through? Ask about the company, a customer, or brainstorm — I will ground it in the Company Brain when there is evidence.";
  }

  if (mode === "CLARIFICATION") {
    const prev = conversation?.lastAnswer?.trim();
    if (prev) {
      const excerpt = prev.split("\n").filter(Boolean).slice(0, 6).join("\n");
      return [
        "That follows from the previous answer:",
        "",
        excerpt,
        "",
        "I can dig into evidence, who is affected, or whether we should open a governed decision.",
      ].join("\n");
    }
    return "I don't have a prior turn to unpack yet. Ask about a customer, a risk, or what to focus on this week.";
  }

  if (ctx.insufficient) {
    return `I don't have enough company evidence to tell you what the current strategy is. I can see other live work, but nothing currently connects to that question.`;
  }

  const known = factLines(ctx, mode === "BRAINSTORM" ? 4 : 5);
  if (mode === "BRAINSTORM") {
    const ideas = brainstormIdeas(question, ctx);
    return [
      "**What we know**",
      ...known.map((l) => `• ${l}`),
      "",
      "**Ideas (not company fact)**",
      ...ideas.map((l, i) => `${i + 1}. ${l}`),
      "",
      "Those suggestions are possibilities worth exploring. They are not decisions, and I will not execute them unless you ask and governance passes.",
    ].join("\n");
  }

  if (mode === "SITUATION_ANALYSIS") {
    const sit = ctx.situations[0];
    const forEv = ctx.evidence.slice(0, 2).map(formatEvidenceLine);
    const againstEv = ctx.evidence.slice(2, 4).map(formatEvidenceLine);
    const challenge = /\b(sure|actually|challenge|wrong|risk)\b/i.test(question);
    const lines = [
      sit
        ? `**What we know:** ${sit.title} — ${sit.trajectory.toLowerCase()}, impact still open, stage ${sit.stage.replace(/_/g, " ")}.`
        : "**What we know:** Relevant company evidence is thin.",
      "",
      ...known.slice(0, 4).map((l) => `• ${l}`),
    ];
    if (challenge || sit) {
      lines.push("");
      lines.push("**Evidence for:**");
      lines.push(forEv[0] ? `• ${forEv[0]}` : "• Live situation confidence and trajectory, without a sealed causal proof.");
      lines.push("");
      lines.push("**Evidence against:**");
      lines.push(
        againstEv[0]
          ? `• ${againstEv[0]}`
          : "• I do not have independent contradicting signals yet — treat the risk as supported but not proven.",
      );
      lines.push("");
      lines.push("**Uncertainty:** The Company Brain can show a worsening pattern without proving a single root cause.");
      lines.push("");
      lines.push(
        "**Alternative hypothesis:** This could be an implementation or coverage issue rather than a true account-risk story — worth checking before we commit.",
      );
    }
    lines.push("");
    lines.push(
      sit
        ? "**What I'd consider:** Inspect the evidence trail, then only create a governed decision if this is still worsening."
        : "**What I'd consider:** Keep gathering signals before committing the ledger.",
    );
    return lines.join("\n");
  }

  // COMPANY_QUESTION
  const top = ctx.situations.slice(0, 3);
  if (!top.length && known.length) {
    return ["**What we know**", ...known.map((l) => `• ${l}`), "", "I can dig into any of these."].join("\n");
  }
  if (!top.length) {
    return `I don't have enough company evidence to answer that confidently.`;
  }
  const blocks = top.map((s, i) => {
    return `${i + 1}. ${s.title} — ${s.trajectory.toLowerCase()}, ${s.stage.replace(/_/g, " ").toLowerCase()}. ${
      s.explanation ? s.explanation.slice(0, 140) : "Grounded in live signals."
    }`;
  });
  return [
    "**What we know** (top risks, not a decision):",
    "",
    ...blocks,
    "",
    known.length ? `Evidence: ${known[0]}` : "",
    "",
    "**What I infer:** These are the highest-impact live threads I can ground in the Company Brain — not a committed decision.",
    "",
    "I can dig into any of these, or brainstorm options without opening a decision.",
  ]
    .filter(Boolean)
    .join("\n");
}

function brainstormIdeas(question: string, ctx: CompanyContext): string[] {
  const q = question.toLowerCase();
  const churn = /churn|retention|renewal/.test(q) || ctx.situations.some((s) => /churn|renewal/i.test(s.pattern_id + s.title));
  const sales = /sales|revenue|pipeline|deal/.test(q);
  if (churn) {
    return [
      "A possibility worth exploring: stabilize the product reliability issues showing up in customer evidence before offering commercial concessions.",
      "A possibility worth exploring: give CS a weekly exec update tied to the live renewal situations rather than a generic health score.",
      "A possibility worth exploring: pull Engineering onto the hottest customer connector/SLA thread if one is already on the ledger.",
      "A possibility worth exploring: review prior failed retention decisions and keep the extra evidence bar those priors require.",
      "A possibility worth exploring: isolate billing or implementation threads so they are not treated as the same churn story.",
    ];
  }
  if (sales) {
    return [
      "A possibility worth exploring: protect coverage on accounts that already have worsening forecast or renewal situations.",
      "A possibility worth exploring: unblock the hottest sales dependency (legal, security, or product) before adding pipeline volume.",
      "A possibility worth exploring: convert decision-ready customer-risk situations into governed recovery work rather than discounting first.",
      "A possibility worth exploring: use recent failed outcomes on this pattern as a constraint — do not lower the evidence bar.",
      "A possibility worth exploring: pair Sales with the owning execution team on the accounts named in live situations.",
    ];
  }
  return [
    "A possibility worth exploring: start from the highest-impact worsening situation, not from a blank strategy.",
    "A possibility worth exploring: clear the current bottleneck team before starting parallel work.",
    "A possibility worth exploring: reuse a prior successful decision pattern only inside existing readiness gates.",
    "A possibility worth exploring: ask for the evidence trail on the top risk before committing.",
    "A possibility worth exploring: treat ideas as options until causal validation is sealed.",
  ];
}
