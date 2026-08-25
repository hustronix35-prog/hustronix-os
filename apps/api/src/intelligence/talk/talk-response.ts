/**
 * Founder-facing Talk answers.
 * GENERAL → teach/define without company dumps.
 * COMPANY → grounded Company Brain.
 * HYBRID → general judgment + selective company context.
 */
import type { TalkIntent } from "./talk-understanding.js";
import type { TalkContext } from "./talk-context.js";
import type { CompanyContext } from "./talk-retrieval.js";
import type { TalkReasoning } from "./talk-reasoning.js";
import { humanTrajectory, stripJargon, provenanceLines } from "./talk-evidence.js";
import { nextThought } from "./talk-followups.js";

function joinBlocks(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p && String(p).trim()).join("\n\n");
}

/** Dedupe situation lines by customer/title so we don't list Northstar 4 times. */
function distinctiveThreads(ctx: CompanyContext, limit = 3): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of ctx.situations) {
    const who =
      s.entities.filter((e) => !/^(sales|engineering|security|finance|product|support)$/i.test(e))[0] || "";
    const key = (who || s.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`• ${who ? `${who} — ` : ""}${s.title} (${humanTrajectory(s.trajectory)})`);
    if (lines.length >= limit) break;
  }
  return lines.join("\n");
}

function evidenceBullets(reasoned: TalkReasoning, limit = 3): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of reasoned.evidence) {
    const k = l.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(`• ${l}`);
    if (out.length >= limit) break;
  }
  return out.join("\n");
}

function productOrientation(): string {
  return [
    "Hustronix helps you understand what's happening inside your company, figure out what matters, challenge your assumptions, and turn the things worth acting on into governed decisions and execution.",
    "Think of it as a place to think through the business with the company's actual information behind the conversation.",
    "Ask what's going on, dig into a customer, challenge a take, or teach yourself a concept — and when you want, apply it to your real situation.",
  ].join("\n\n");
}

function pricingish(text: string): boolean {
  return /\b(price|pricing|discount|expensive|cheaper|cost|fee|quote)\b/i.test(text);
}

function productish(text: string): boolean {
  return /\b(product|reliability|outage|bug|latency|error|broken|complaint|health|quality|feature|incident)\b/i.test(
    text,
  );
}

function contradictsCurrent(text: string, pricingChallenge: boolean): boolean {
  // Only treat as against the product hypothesis when the source itself pushes the other way.
  if (pricingChallenge) {
    return (
      /\b(not (a )?product|works fine|happy with (the )?product|only .{0,24}pric|pricing (is|was) the (only |main )?issue)\b/i.test(
        text,
      ) || (pricingish(text) && !productish(text) && /\b(only|just|mainly|purely)\b/i.test(text))
    );
  }
  return /\b(not (the )?case|opposite|contradict|disprove|no evidence of)\b/i.test(text);
}

function challengeAnswer(opts: {
  question: string;
  intent: TalkIntent;
  ctx: CompanyContext;
  reasoned: TalkReasoning;
  conversation?: TalkContext | null;
  next: string;
}): string {
  const { intent, ctx, conversation, next } = opts;
  const who = intent.entity || ctx.situations[0]?.entities[0] || "this account";
  const current =
    ctx.situations[0]?.explanation ||
    conversation?.lastAnswer?.split("\n").filter(Boolean)[0] ||
    `${who} shows a live risk thread.`;
  const pricingChallenge = /\bpric/i.test(opts.question) || /\bnot just a pricing\b/i.test(opts.question);
  const lines = provenanceLines(ctx, 8);
  const forLines = lines.filter((l) => (pricingChallenge ? productish(l) || !pricingish(l) : true)).slice(0, 3);
  const againstLines = lines.filter((l) => contradictsCurrent(l, pricingChallenge)).slice(0, 3);
  const altSupport = pricingChallenge ? lines.filter((l) => pricingish(l) && !contradictsCurrent(l, true)).slice(0, 2) : [];

  const forBlock =
    forLines.length > 0
      ? `Evidence for the current view:\n${forLines.map((l) => `• ${l}`).join("\n")}`
      : `Evidence for: ${who} still shows a live risk pattern on the board — treat that as support for paying attention, not as a proven root cause.`;

  const againstBlock =
    againstLines.length > 0
      ? `Evidence against:\n${againstLines.map((l) => `• ${l}`).join("\n")}`
      : pricingChallenge
        ? "I don't currently have strong evidence against the product explanation. The pricing hypothesis is possible, but I don't see information in your company data that establishes it."
        : "I don't currently have strong evidence against the current explanation.";

  const altBlock = pricingChallenge
    ? joinBlocks([
        altSupport.length
          ? `What could support pricing instead:\n${altSupport.map((l) => `• ${l}`).join("\n")}`
          : "I don't see pricing objections tied to this account in the current sources.",
        "What would distinguish them:\n- pricing objections from the account\n- similar pricing complaints from comparable customers\n- product complaints independent of price",
      ])
    : intent.objective === "alternative_hypotheses" || /what else|another|missing/i.test(opts.question)
      ? "Alternative hypothesis: pricing, coverage, or account management could also explain the same symptoms.\n\nWhat would distinguish them: whether the account is objecting to price, and whether similar-priced accounts show the same product friction."
      : "Alternative hypothesis: this could be coverage or implementation rather than a true commercial collapse.";

  return stripJargon(
    joinBlocks([
      `Current view: ${current}`,
      forBlock,
      againstBlock,
      altBlock,
      "Uncertainty: a worsening pattern is not the same as a proven single root cause.",
      next,
    ]),
  );
}

function temporalAnswer(ctx: CompanyContext, reasoned: TalkReasoning, next: string): string {
  const changes: string[] = [];
  for (const s of ctx.situations.slice(0, 4)) {
    const who = s.entities.find((e) => !/^(sales|engineering|security|finance|product|support|legal)$/i.test(e));
    changes.push(
      `${who || s.title} — ${s.title} is ${humanTrajectory(s.trajectory)}${
        s.explanation ? ` (${s.explanation.slice(0, 100)})` : ""
      }`,
    );
  }
  if (ctx.bottleneckTalk) {
    const first = ctx.bottleneckTalk.split("\n")[0];
    if (first) changes.push(first);
  }
  for (const o of ctx.outcomes.slice(0, 2)) {
    changes.push(`A recent decision evaluated as ${o.result}${o.notes ? ` — ${String(o.notes).slice(0, 80)}` : ""}.`);
  }
  if (!changes.length) {
    return stripJargon(
      joinBlocks([
        "I don't have enough timestamped changes yet to say what moved recently.",
        "Once newer updates land in your company data, I can summarize the delta.",
        next,
      ]),
    );
  }
  const numbered = changes.slice(0, 3).map((c, i) => `${i + 1}. ${c}`).join("\n");
  return stripJargon(
    joinBlocks([
      `Three things changed recently:\n${numbered}`,
      changes[0] ? `The most important change is ${changes[0].split(" — ")[0] || changes[0]}.` : null,
      provenanceLines(ctx, 2).length
        ? `Recent sources:\n${provenanceLines(ctx, 2)
            .map((l) => `• ${l}`)
            .join("\n")}`
        : null,
      next,
    ]),
  );
}

function decisionOutcomeAnswer(opts: {
  intent: TalkIntent;
  ctx: CompanyContext;
  next: string;
}): string {
  const { ctx, intent, next } = opts;
  const who = intent.entity || ctx.situations[0]?.entities[0];
  const decision = ctx.decisions[0];
  const outcome = ctx.outcomes[0];
  const sit = ctx.situations[0];

  if (!decision && !outcome) {
    return stripJargon(
      joinBlocks([
        who
          ? `There's not enough evidence yet to say whether the last decision on ${who} worked.`
          : "There's not enough evidence yet to say whether the last decision worked.",
        sit
          ? `I can see the current thread (${sit.title} is ${humanTrajectory(sit.trajectory)}), but current status alone is not proof the decision failed or succeeded.`
          : null,
        "If you point me at the decision, I can compare what was intended with what happened afterward.",
        next,
      ]),
    );
  }

  const after: string[] = [];
  if (outcome) after.push(`Measured result: ${outcome.result}${outcome.notes ? ` — ${outcome.notes}` : ""}.`);
  if (sit) after.push(`Since then, ${sit.title} is ${humanTrajectory(sit.trajectory)}.`);
  for (const t of ctx.tasks.slice(0, 2)) {
    after.push(`Follow-through: ${t.work || "related work"} is ${t.status}${t.owner ? ` (owner ${t.owner})` : ""}.`);
  }

  const verdict = outcome
    ? outcome.result === "failed"
      ? "So far the measured result looks unsuccessful."
      : outcome.result === "succeeded" || outcome.result === "success"
        ? "So far the measured result looks positive."
        : `So far I'd call the result ${outcome.result} — not a full success/failure call.`
    : "So far I'd call the result inconclusive because we don't have a direct outcome metric.";

  return stripJargon(
    joinBlocks([
      decision
        ? `The decision was${who ? ` on ${who}` : ""}: ${decision.vow} (status: ${decision.status}).`
        : who
          ? `Looking at the last decision path for ${who}:`
          : "Looking at the last decision path:",
      after.length ? `Afterward:\n${after.map((a) => `• ${a}`).join("\n")}` : null,
      verdict,
      "Important: the current thread status is not by itself proof that the decision failed.",
      next,
    ]),
  );
}

function focusedEvidenceAnswer(ctx: CompanyContext, intent: TalkIntent, reasoned: TalkReasoning, next: string): string {
  const who = intent.entity || ctx.situations[0]?.entities[0] || "this";
  const lines = provenanceLines(ctx, 6);
  if (!lines.length) {
    return stripJargon(
      joinBlocks([
        `I don't have strong source-backed evidence lines for ${who} yet — only the live thread summary.`,
        ctx.situations[0] ? `${ctx.situations[0].title} is ${humanTrajectory(ctx.situations[0].trajectory)}.` : null,
        "I won't invent proof from the title alone.",
        next,
      ]),
    );
  }
  return stripJargon(
    joinBlocks([
      "Here's what I'm basing that on:",
      lines.map((l) => `• ${l}`).join("\n"),
      ctx.situations[0]
        ? `Together these support the ${ctx.situations[0].title.toLowerCase()} reading because they are tied to that account's live trail — not because the title itself is evidence.`
        : null,
      next,
    ]),
  );
}

function teachSales(): string {
  return [
    "Absolutely. At a basic level, sales is the process of turning demand into revenue — and then keeping and growing that revenue.",
    "Think in three layers:",
    "1. Demand — finding and attracting people who might buy.",
    "2. Conversion — qualifying opportunities, moving them through stages, and closing with a trustworthy forecast.",
    "3. Retention & expansion — renewing what you closed and growing healthy accounts.",
    "Volume alone is not a strategy. If renewals are leaking or the forecast is unreliable, pouring more leads into the funnel usually hides the problem.",
  ].join("\n\n");
}

function teachTopic(topic: string | undefined, question: string): string {
  const low = question.toLowerCase();
  if (topic === "cac" || /\bcac\b/.test(low)) {
    return [
      "CAC is Customer Acquisition Cost — what you spend to win a new customer.",
      "In practice: sales + marketing spend over a period, divided by new customers won in that period.",
      "It only becomes useful next to LTV (or payback period). A rising CAC is not automatically bad if customers stay longer and expand.",
    ].join("\n\n");
  }
  if (topic === "funnel" || /\bfunnel\b/.test(low)) {
    return [
      "A sales funnel is the path from awareness to closed revenue: lead → qualified opportunity → proposal → close.",
      "What matters is not how many names are in the funnel, but stage conversion and whether the forecast at each stage is honest.",
    ].join("\n\n");
  }
  if (topic === "pipeline" || /\bpipeline\b/.test(low)) {
    return [
      "Pipeline is the set of open opportunities weighted by stage.",
      "Healthy pipeline has enough coverage of your target, clean stage definitions, and a forecast you can trust — not just a long list of deals.",
    ].join("\n\n");
  }
  if (topic === "retention" || /churn|retention/.test(low)) {
    return [
      "Retention is keeping customers who already bought. Churn is the opposite.",
      "Basics: spot accounts that are worsening early, understand whether the issue is product, support, or commercial, then intervene before renewal — not after.",
    ].join("\n\n");
  }
  if (topic === "sales" || /\bsales\b/.test(low) || /teach|basics|fundamentals/.test(low)) {
    return teachSales();
  }
  return [
    "Happy to walk through that.",
    "In operating companies, the useful move is to separate what we can observe, what we infer from that, and what we still don't know — then decide what to do next.",
  ].join("\n\n");
}

function hybridCompanySketch(ctx: CompanyContext, reasoned: TalkReasoning): string | null {
  if (!ctx.situations.length) return null;
  const threads = distinctiveThreads(ctx, 3);
  const bullets = evidenceBullets(reasoned, 2);
  const names = [
    ...new Set(
      ctx.situations
        .flatMap((s) => s.entities)
        .filter((e) => !/^(sales|engineering|security|finance|product|support)$/i.test(e)),
    ),
  ].slice(0, 3);
  const nameList = names.length ? names.join(", ") : "a few live accounts";
  return joinBlocks([
    `Looking at your company, I'd map this onto ${nameList} first — here's why:`,
    threads,
    bullets || null,
  ]);
}

function strategyHybrid(opts: {
  intent: TalkIntent;
  ctx: CompanyContext;
  reasoned: TalkReasoning;
  next: string;
}): string {
  const { intent, ctx, reasoned, next } = opts;
  if (intent.objective === "reduce_churn") {
    const hot =
      ctx.situations.find((s) => /renewal|churn|retention/i.test(`${s.title} ${s.explanation || ""}`)) ||
      ctx.situations[0];
    return stripJargon(
      joinBlocks([
        "On retention, start from what's already worsening — not a generic campaign.",
        hot
          ? `Hottest thread: ${hot.title} is ${humanTrajectory(hot.trajectory)}${
              hot.explanation ? ` — ${hot.explanation.slice(0, 140)}` : ""
            }.`
          : null,
        evidenceBullets(reasoned, 3) || null,
        reasoned.recommendations[0] ? `I'd prioritize: ${reasoned.recommendations[0]}` : null,
        next,
      ]),
    );
  }

  const sketch = hybridCompanySketch(ctx, reasoned);
  const judgment =
    ctx.situations.some((s) => /renewal|churn/i.test(s.title)) &&
    ctx.situations.some((s) => /pipeline|forecast|coverage/i.test(s.title))
      ? "That makes me cautious about simply pouring more leads into the funnel. I'd first separate insufficient qualified pipeline, poor stage conversion, and revenue leaking from existing customers."
      : reasoned.reasoning[0] || null;

  return stripJargon(
    joinBlocks([
      "Yes. I'd look at this from three angles: retention, conversion, and new demand.",
      sketch,
      judgment,
      reasoned.recommendations[0]
        ? `My first move would be: ${reasoned.recommendations[0].replace(/^Prioritize /i, "").replace(/\.$/, "")}.`
        : null,
      reasoned.reasoning.find((r) => /tried a similar/i.test(r)) || null,
      next,
    ]),
  );
}

function learnAnswer(opts: {
  question: string;
  intent: TalkIntent;
  ctx: CompanyContext;
  reasoned: TalkReasoning;
  next: string;
}): string {
  const primer = teachTopic(opts.intent.topic, opts.question);

  if (opts.intent.contextMode === "GENERAL" || opts.intent.objective === "basics") {
    return stripJargon(
      joinBlocks([
        primer,
        "If you want, I can use your actual pipeline and customers as examples next.",
        opts.next,
      ]),
    );
  }

  // learn_with_company / HYBRID
  const sketch = hybridCompanySketch(opts.ctx, opts.reasoned);
  const topic = opts.intent.topic || "sales";
  return stripJargon(
    joinBlocks([
      primer,
      sketch
        ? joinBlocks([
            `Sure. If we apply the ${topic === "sales" ? "three layers" : "ideas"} we just discussed to your company:`,
            sketch,
            "So the biggest lesson in your actual situation is: treat renewal and forecast quality as part of sales — not as a separate afterthought.",
          ])
        : "I don't have enough live company threads yet to map this onto your company — the concepts above still hold.",
      opts.next,
    ]),
  );
}

export function renderTalkAnswer(opts: {
  question: string;
  intent: TalkIntent;
  ctx: CompanyContext;
  reasoned: TalkReasoning;
  conversation?: TalkContext | null;
}): string {
  const { intent, ctx, reasoned, conversation } = opts;
  const next = nextThought(intent, ctx, reasoned);

  if (intent.mode === "CASUAL") {
    if (/good morning/i.test(opts.question)) return "Good morning. What's on your mind?";
    if (/hello/i.test(opts.question)) return "Hello. What are you thinking through?";
    return "Hey. What are you thinking through?";
  }

  if (intent.objective === "product_orientation") {
    return stripJargon(productOrientation());
  }

  if (intent.mode === "GENERAL" || (intent.mode === "LEARN" && intent.contextMode === "GENERAL")) {
    return learnAnswer({ question: opts.question, intent, ctx, reasoned, next });
  }

  if (intent.mode === "LEARN") {
    return learnAnswer({ question: opts.question, intent, ctx, reasoned, next });
  }

  if (intent.objective === "focused_evidence" || (intent.mode === "FOLLOWUP" && intent.deepen === "evidence")) {
    return focusedEvidenceAnswer(ctx, intent, reasoned, next);
  }

  if (intent.mode === "FOLLOWUP" && conversation?.lastAnswer) {
    if (intent.deepen === "test") {
      return stripJargon(
        joinBlocks([
          "To test that, I'd pick the cheapest falsifiable check first — usually one instrumented update or one account conversation, not a full reorg.",
          reasoned.recommendations[0] || null,
          distinctiveThreads(ctx, 2) || null,
          next,
        ]),
      );
    }
    if (intent.contextMode === "GENERAL") {
      return stripJargon(
        joinBlocks([
          "Building on what we just covered:",
          conversation.lastAnswer.split("\n").filter(Boolean).slice(0, 5).join("\n"),
          reasoned.reasoning[0] || "The core idea still holds — demand, conversion, then retention.",
          next,
        ]),
      );
    }
    if (intent.deepen === "wrong" || intent.deepen === "missing") {
      return stripJargon(
        joinBlocks([
          "If that's wrong, another reading is that this is a coverage or implementation issue rather than a true commercial collapse.",
          reasoned.uncertainties[0],
          distinctiveThreads(ctx, 2) || null,
          next,
        ]),
      );
    }
    const excerpt = conversation.lastAnswer.split("\n").filter(Boolean).slice(0, 4).join("\n");
    return stripJargon(
      joinBlocks([
        "Because of what we just covered:",
        excerpt,
        reasoned.reasoning[0],
        reasoned.evidence[0] ? `The extra detail: ${reasoned.evidence[0]}` : null,
        next,
      ]),
    );
  }

  if (intent.objective === "clarify_growth") {
    return stripJargon(
      intent.needsClarification ||
        "Do you mean revenue growth, customer growth, or overall company growth? I can look at your current data for whichever you mean.",
    );
  }

  // Metric path must never fall through to attention / insufficient-generic.
  if (intent.objective === "company_metric") {
    const label = (intent.topic || "metric").toUpperCase();
    const needs =
      label === "CAC"
        ? "- sales/marketing spend for a defined period\n- number of new customers acquired in that period"
        : label === "CONVERSION"
          ? "- stage-to-stage counts for the funnel period you care about\n- a clear definition of what counts as converted"
          : "- the numerator and denominator for that metric over a defined period";
    return stripJargon(
      joinBlocks([
        `I don't have a reliable ${label} figure yet.`,
        `To calculate it, I need:\n${needs}`,
        "If those are connected, I can calculate it from the company data.",
      ]),
    );
  }

  if (intent.objective === "temporal_delta") {
    return temporalAnswer(ctx, reasoned, next);
  }

  if (intent.objective === "decision_outcome") {
    return decisionOutcomeAnswer({ intent, ctx, next });
  }

  if (intent.objective === "company_overview" || intent.objective === "attention") {
    if (!ctx.situations.length && !ctx.bottleneckTalk) {
      return stripJargon(
        "I don't see live company threads yet. Once situations and updates are in your company data, I can summarize what needs attention.",
      );
    }
    const top = ctx.situations.slice(0, 3);
    const names = top
      .map((s) => s.entities.find((e) => !/^(sales|engineering|security|finance|product|support|legal)$/i.test(e)))
      .filter(Boolean);
    const lead =
      top[0]
        ? `${names[0] || "One live thread"} stands out: ${top[0].title.toLowerCase()} is ${humanTrajectory(top[0].trajectory)}.`
        : "A few operational threads are active.";
    return stripJargon(
      joinBlocks([
        `A few things deserve attention. ${lead}`,
        distinctiveThreads(ctx, 3) || null,
        ctx.bottleneckTalk || null,
        evidenceBullets(reasoned, 2) || null,
        top.length > 1
          ? "I'd start with those threads rather than trying to fix everything at once."
          : "If you want, we can dig into the top thread.",
      ]),
    );
  }

  if (intent.objective === "customer_risk" || intent.objective === "at_risk_customers") {
    const worsening = ctx.customers.filter((c) => c.worsening);
    const fromSits = ctx.situations
      .filter((s) => s.trajectory === "WORSENING" || /risk|renewal|churn/i.test(s.title))
      .flatMap((s) => s.entities.filter((e) => !/^(sales|engineering|security|finance|product|support|legal)$/i.test(e)));
    const names = [...new Set([...(worsening.map((c) => c.name) || []), ...fromSits])].slice(0, 5);
    if (!names.length && !ctx.situations.length) {
      return stripJargon("I don't currently see clearly worsening customer threads in your company data.");
    }
    return stripJargon(
      joinBlocks([
        names.length
          ? `The customers I'd watch first: ${names.join(", ")}.`
          : "A few account threads look elevated:",
        distinctiveThreads(ctx, 4) || null,
        evidenceBullets(reasoned, 2) || null,
        "I'd start with the worsening ones before adding more acquisition pressure.",
      ]),
    );
  }

  if (intent.objective === "bottleneck") {
    return stripJargon(
      joinBlocks([
        ctx.bottleneckTalk ||
          (ctx.dependencies[0]
            ? `${ctx.dependencies[0].fromTeam} is waiting on ${ctx.dependencies[0].toTeam}${
                ctx.dependencies[0].work ? ` for ${ctx.dependencies[0].work}` : ""
              }.`
            : null) ||
          (ctx.situations.find((s) => /launch|block|security|legal|engineering/i.test(`${s.title} ${s.explanation || ""}`))
            ?.explanation
            ? ctx.situations.find((s) => /launch|block|security|legal|engineering/i.test(`${s.title} ${s.explanation || ""}`))!
                .explanation
            : null) ||
          distinctiveThreads(ctx, 2) ||
          "I don't have a clear dependency chain for that blocker yet.",
        evidenceBullets(reasoned, 2) || null,
        "If you want, we can walk the chain step by step.",
      ]),
    );
  }

  if (ctx.insufficient && intent.requiresCompanyContext && intent.contextMode !== "GENERAL") {
    return stripJargon(
      "I don't have enough company evidence to answer that from your company data. I can see other live work, but nothing currently connects to that question.",
    );
  }

  if (intent.optionSelect && reasoned.recommendations[0]) {
    return stripJargon(
      joinBlocks([
        `Okay. ${reasoned.recommendations[0]}`,
        "I'll turn that into a decision and check the evidence, owners, dependencies and capacity before anything is executed.",
        "Nothing is ACTIVE until those checks pass.",
      ]),
    );
  }

  if (intent.mode === "COUNTERFACTUAL" || intent.objective === "challenge" || intent.objective === "alternative_hypotheses") {
    return challengeAnswer({ question: opts.question, intent, ctx, reasoned, conversation, next });
  }

  if (intent.mode === "BRAINSTORM") {
    const known = evidenceBullets(reasoned, 3);
    const ideas = reasoned.ideas
      .slice(0, 5)
      .map((o) => `${o.n}. ${o.label} — ${o.summary}`)
      .join("\n");
    return stripJargon(
      joinBlocks([
        known ? `Given what we know right now:\n${known}` : null,
        `I see ${reasoned.ideas.length || 5} possible levers:`,
        ideas || "1. Protect at-risk accounts\n2. Tighten conversion\n3. Improve follow-up\n4. Narrow ICP\n5. Fix packaging",
        reasoned.recommendations[0] ? `I'd investigate the top options first — that's a recommendation, not a decision.` : null,
        "Those are possibilities, not decisions. Want to pursue one?",
        next,
      ]),
    );
  }

  if (intent.mode === "CUSTOMER_ANALYSIS" || intent.mode === "SITUATION_INVESTIGATION") {
    const sit = ctx.situations[0];
    const who = sit?.entities[0] || intent.entity || "This account";
    const forLine = provenanceLines(ctx, 1)[0] || reasoned.evidence[0];
    return stripJargon(
      joinBlocks([
        sit
          ? `${who}'s situation looks like this: ${humanTrajectory(sit.trajectory)}. ${sit.explanation || sit.title}`
          : "The relevant customer thread is thin.",
        forLine ? `Here's a key source: ${forLine}.` : null,
        "I'm not treating a single root cause as proven yet.",
        next,
      ]),
    );
  }

  if (intent.mode === "COMPARISON") {
    const a = ctx.situations[0];
    const b = ctx.situations[1];
    return stripJargon(
      joinBlocks([
        "Comparing the live threads on the board:",
        a ? `• ${a.title} — ${humanTrajectory(a.trajectory)}` : null,
        b ? `• ${b.title} — ${humanTrajectory(b.trajectory)}` : null,
        reasoned.reasoning[0] || null,
        reasoned.recommendations[0] ? `I'd lean toward: ${reasoned.recommendations[0]}` : null,
        next,
      ]),
    );
  }

  if (intent.mode === "STRATEGY" || intent.objective === "recommendation") {
    if (intent.objective === "recommendation") {
      const who =
        intent.entity ||
        ctx.situations[0]?.entities.find((e) => !/^(sales|engineering|security|finance|product|support)$/i.test(e)) ||
        "the clearest risk thread";
      return stripJargon(
        joinBlocks([
          `If I were prioritizing this, I'd address ${who} before pushing more acquisition.`,
          ctx.situations[0]
            ? `Why: ${ctx.situations[0].explanation || ctx.situations[0].title} (${humanTrajectory(ctx.situations[0].trajectory)}).`
            : null,
          evidenceBullets(reasoned, 2) || null,
          "Trade-off: more pipeline can hide retention or conversion problems. I'd verify the cause before committing the company to a big motion.",
          "That's a recommendation, not a decision — say if you want options or a governed next step.",
        ]),
      );
    }
    return strategyHybrid({ intent, ctx, reasoned, next });
  }

  return stripJargon(joinBlocks([reasoned.evidence[0], reasoned.reasoning[0], reasoned.recommendations[0], next]));
}
