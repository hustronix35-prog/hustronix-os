/**
 * Talk orchestrator — reasoning interface over the Company Brain.
 * Situation/Decision/Execution remain the governed kernel.
 * Architecture freeze: only observability wiring added here.
 */
import { extractEntities } from "../entity-resolver.js";
import {
  talkSituationKernel,
  classifySituationIntent,
  type TalkAction,
  type TalkTurn,
  type TalkActionId,
} from "../situation-chat.js";
import {
  classifyTalkIntent,
  isGovernedActionMode,
  type ContextMode,
  type TalkIntent,
  type TalkMode,
} from "./talk-understanding.js";
import { getTalkContext, rememberTalkTurn, clearTalkInvestigationFocus } from "./talk-context.js";
import { retrieveTalkContext } from "./talk-retrieval.js";
import { planTalkRetrieval } from "./talk-retrieval-plan.js";
import { reasonAboutCompany } from "./talk-reasoning.js";
import { renderTalkAnswer } from "./talk-response.js";
import { followupActions } from "./talk-followups.js";
import { stripJargon } from "./talk-evidence.js";
import { synthesizeTalkAnswer } from "./talk-synthesis.js";
import { guardTalkAnswer } from "./talk-guard.js";
import {
  buildTalkTrace,
  recordTalkTurnTrace,
  type TalkTurnTrace,
} from "./talk-observability.js";

export type { TalkMode, TalkIntent, ContextMode };

export type TalkApiResponse = TalkTurn & {
  mode: TalkMode;
  contextMode: ContextMode;
  followUps: string[];
  context: {
    situations: string[];
    customers: string[];
    evidence: string[];
  };
  /** Internal diagnosis — not for founder UI copy. */
  trace?: TalkTurnTrace;
};

function toCards(ctx: ReturnType<typeof retrieveTalkContext>, intent: TalkIntent): TalkTurn["situations"] {
  if (intent.contextMode === "GENERAL") return [];
  return ctx.situations.map((s) => ({
    id: s.id,
    title: s.title,
    stage: s.stage,
    confidence: s.confidence,
    trajectory: s.trajectory,
    first_observed_day: null,
    explanation: s.explanation,
    facets: [],
    evidence: [],
    decision_id: s.decision_id,
    answer: s.explanation || s.title,
  }));
}

function attachKernel(
  turn: TalkTurn,
  intent: TalkIntent,
  conversationId: string,
  userId: string,
  q: string,
  timing: { understandingMs: number; totalMs: number },
): TalkApiResponse {
  rememberTalkTurn(userId, q, turn.answer, {
    conversationId,
    topic: turn.situations[0]?.title,
    entities: extractEntities(q).map((e) => e.label),
    situationIds: turn.focus_id ? [turn.focus_id] : [],
    decisionId: turn.decision_id,
    mode: intent.mode,
    contextMode: intent.contextMode,
    intent: intent.objective,
  });
  const trace = buildTalkTrace({
    conversationId,
    intent,
    plan: null,
    ctx: null,
    understandingMs: timing.understandingMs,
    retrievalMs: 0,
    reasoningMs: 0,
    llmMs: null,
    totalMs: timing.totalMs,
    guardOk: true,
    guardReasons: [],
    fallbackUsed: false,
    path: "kernel",
  });
  recordTalkTurnTrace(userId, trace);
  return {
    ...turn,
    answer: stripJargon(turn.answer),
    mode: intent.mode,
    contextMode: intent.contextMode,
    followUps: turn.actions.filter((a) => a.kind === "followup").map((a) => a.label),
    context: {
      situations: turn.situations.map((s) => s.id),
      customers: extractEntities(q).map((e) => e.label),
      evidence: [],
    },
    trace,
  };
}

type BrainTurnCore = {
  kind: "brain";
  q: string;
  conversationId: string;
  userId: string;
  intent: TalkIntent;
  kernelIntent: ReturnType<typeof classifySituationIntent>;
  ctx: ReturnType<typeof retrieveTalkContext>;
  reasoned: ReturnType<typeof reasonAboutCompany>;
  templateAnswer: string;
  kernelTurn: TalkTurn | null;
  focus: string | null;
  actions: TalkAction[];
  named: string[];
  plan: ReturnType<typeof planTalkRetrieval>;
  understandingMs: number;
  retrievalMs: number;
  reasoningMs: number;
  guardOk: boolean;
  guardReasons: string[];
};

function resolveTalkIntentAndKernel(
  userId: string,
  question: string,
  opts?: { focusId?: string | null; action?: TalkActionId | null; sessionId?: string | null; conversationId?: string | null },
) {
  const started = Date.now();
  const q = String(question || "").trim();
  const conversationId = opts?.conversationId || opts?.sessionId || "default";
  const conversation = getTalkContext(userId, conversationId);
  const intent = classifyTalkIntent(q, { action: opts?.action || null, context: conversation });
  const kernelIntent = classifySituationIntent(q);
  return { q, conversationId, conversation, intent, kernelIntent, opts, understandingMs: Date.now() - started };
}

function shouldUseKernel(
  intent: TalkIntent,
  kernelIntent: ReturnType<typeof classifySituationIntent>,
  opts: { focusId?: string | null; action?: TalkActionId | null; conversation: ReturnType<typeof getTalkContext> },
): boolean {
  // Conversational evidence / outcome stay on the Talk brain path.
  // Kernel is only for explicit governed actions (or an explicit UI focusId + action).
  if (intent.objective === "focused_evidence" || intent.objective === "decision_outcome") {
    return Boolean(opts.action) || intent.governedAction;
  }
  return (
    Boolean(opts.action) ||
    intent.governedAction ||
    isGovernedActionMode(intent.mode) ||
    (kernelIntent === "evidence" &&
      Boolean(opts.focusId) &&
      intent.deepen === "evidence" &&
      intent.mode !== "FOLLOWUP")
  );
}

function buildBrainTurn(
  userId: string,
  q: string,
  conversationId: string,
  conversation: ReturnType<typeof getTalkContext>,
  intent: TalkIntent,
  kernelIntent: ReturnType<typeof classifySituationIntent>,
  understandingMs: number,
  opts?: { focusId?: string | null; action?: TalkActionId | null },
): BrainTurnCore {
  if (intent.clearFocus) {
    clearTalkInvestigationFocus(userId, conversationId);
  }
  const liveConversation = getTalkContext(userId, conversationId);
  const named = extractEntities(q).map((e) => e.label);
  const plan = planTalkRetrieval({ question: q, intent, conversation: liveConversation });

  const tRet = Date.now();
  const ctx = retrieveTalkContext({ userId, question: q, intent, conversation: liveConversation });
  const retrievalMs = Date.now() - tRet;

  const tReason = Date.now();
  const reasoned = reasonAboutCompany({ question: q, intent, ctx, conversation: liveConversation });
  let templateAnswer = renderTalkAnswer({ question: q, intent, ctx, reasoned, conversation: liveConversation });
  const guarded = guardTalkAnswer({ answer: templateAnswer, intent, ctx });
  templateAnswer = guarded.answer;
  const reasoningMs = Date.now() - tReason;

  let kernelTurn: TalkTurn | null = null;
  if (intent.turnIntoDecision || intent.optionSelect) {
    const focusId = opts?.focusId || liveConversation.activeSituationId || ctx.situations[0]?.id || null;
    if (focusId) {
      kernelTurn = talkSituationKernel(userId, "Create the decision.", { focusId, action: "create_decision" });
      templateAnswer = `${templateAnswer}\n\n${stripJargon(kernelTurn.answer)}`;
    }
  }

  const focus =
    intent.mode === "CUSTOMER_ANALYSIS" || intent.mode === "SITUATION_INVESTIGATION" || intent.mode === "FOLLOWUP"
      ? ctx.situations[0]?.id || liveConversation.activeSituationId || null
      : null;

  const actions: TalkAction[] = kernelTurn?.actions?.length ? kernelTurn.actions : followupActions(intent, ctx);

  return {
    kind: "brain",
    q,
    conversationId,
    userId,
    intent,
    kernelIntent,
    ctx,
    reasoned,
    templateAnswer,
    kernelTurn,
    focus,
    actions,
    named,
    plan,
    understandingMs,
    retrievalMs,
    reasoningMs,
    guardOk: guarded.allowed,
    guardReasons: guarded.blockedReasons,
  };
}

function finalizeBrainTurn(
  core: BrainTurnCore,
  answer: string,
  extras?: { llmMs?: number | null; fallbackUsed?: boolean; totalMs?: number },
): TalkApiResponse {
  const { q, conversationId, userId, intent, kernelIntent, ctx, reasoned, kernelTurn, focus, actions, named } = core;
  const conversation = getTalkContext(userId, conversationId);

  rememberTalkTurn(userId, q, answer, {
    conversationId,
    topic: intent.topic || ctx.situations[0]?.title || q,
    entities: named.length ? named : conversation.recentEntities,
    situationIds: intent.contextMode === "GENERAL" ? [] : ctx.situations.map((s) => s.id),
    decisionId: kernelTurn?.decision_id || ctx.situations[0]?.decision_id,
    customer: intent.entity || named[0],
    mode: intent.mode,
    contextMode: intent.contextMode,
    intent: intent.objective,
    options: reasoned.ideas,
    provenance: reasoned.provenance,
    clearFocus: intent.clearFocus,
  });

  const totalMs =
    extras?.totalMs ??
    core.understandingMs + core.retrievalMs + core.reasoningMs + (extras?.llmMs || 0);

  const trace = buildTalkTrace({
    conversationId,
    intent,
    plan: core.plan,
    ctx: core.ctx,
    understandingMs: core.understandingMs,
    retrievalMs: core.retrievalMs,
    reasoningMs: core.reasoningMs,
    llmMs: extras?.llmMs ?? null,
    totalMs,
    guardOk: core.guardOk,
    guardReasons: core.guardReasons,
    fallbackUsed: extras?.fallbackUsed ?? true,
    path: "brain",
  });
  recordTalkTurnTrace(userId, trace);

  return {
    question: q,
    intent:
      intent.mode === "CUSTOMER_ANALYSIS" || intent.mode === "SITUATION_INVESTIGATION"
        ? "brief"
        : intent.governedAction
          ? kernelIntent
          : "company",
    grounded: intent.contextMode === "GENERAL" || intent.mode === "CASUAL" ? false : !ctx.insufficient,
    answer,
    focus_id: focus || kernelTurn?.focus_id || null,
    decision_id: kernelTurn?.decision_id || (intent.contextMode === "GENERAL" ? null : ctx.situations[0]?.decision_id) || null,
    situations: toCards(ctx, intent),
    actions,
    mode: intent.mode,
    contextMode: intent.contextMode,
    followUps: actions.map((a) => a.label),
    context: {
      situations: intent.contextMode === "GENERAL" ? [] : ctx.situations.map((s) => s.id),
      customers: intent.contextMode === "GENERAL" ? [] : ctx.customers.map((c) => c.name),
      evidence: reasoned.provenance.supportingEvidence,
    },
    trace,
  };
}

export function talkToHustronix(
  userId: string,
  question: string,
  opts?: { focusId?: string | null; action?: TalkActionId | null; sessionId?: string | null; conversationId?: string | null },
): TalkApiResponse {
  const totalStart = Date.now();
  const { q, conversationId, conversation, intent, kernelIntent, opts: resolvedOpts, understandingMs } =
    resolveTalkIntentAndKernel(userId, question, opts);

  if (shouldUseKernel(intent, kernelIntent, { ...resolvedOpts, conversation }) && !intent.optionSelect) {
    const focusId = resolvedOpts?.focusId || conversation.activeSituationId || conversation.referencedSituations[0] || null;
    const turn = talkSituationKernel(userId, q, { focusId, action: resolvedOpts?.action });
    return attachKernel(turn, intent, conversationId, userId, q, {
      understandingMs,
      totalMs: Date.now() - totalStart,
    });
  }

  const core = buildBrainTurn(userId, q, conversationId, conversation, intent, kernelIntent, understandingMs, resolvedOpts);
  return finalizeBrainTurn(core, core.templateAnswer, {
    llmMs: null,
    fallbackUsed: true,
    totalMs: Date.now() - totalStart,
  });
}

export async function talkToHustronixAsync(
  userId: string,
  question: string,
  opts?: { focusId?: string | null; action?: TalkActionId | null; sessionId?: string | null; conversationId?: string | null },
): Promise<TalkApiResponse> {
  const totalStart = Date.now();
  const { q, conversationId, conversation, intent, kernelIntent, opts: resolvedOpts, understandingMs } =
    resolveTalkIntentAndKernel(userId, question, opts);

  if (shouldUseKernel(intent, kernelIntent, { ...resolvedOpts, conversation }) && !intent.optionSelect) {
    const focusId = resolvedOpts?.focusId || conversation.activeSituationId || conversation.referencedSituations[0] || null;
    const turn = talkSituationKernel(userId, q, { focusId, action: resolvedOpts?.action });
    return attachKernel(turn, intent, conversationId, userId, q, {
      understandingMs,
      totalMs: Date.now() - totalStart,
    });
  }

  const core = buildBrainTurn(userId, q, conversationId, conversation, intent, kernelIntent, understandingMs, resolvedOpts);
  let answer = core.templateAnswer;

  const tLlm = Date.now();
  const synthesized = await synthesizeTalkAnswer({
    userId,
    question: q,
    intent: core.intent,
    ctx: core.ctx,
    reasoned: core.reasoned,
    conversation,
    templateFallback: core.templateAnswer,
  });
  const llmMs = Date.now() - tLlm;

  if (synthesized) {
    const guarded = guardTalkAnswer({ answer: synthesized.answer, intent: core.intent, ctx: core.ctx });
    answer = guarded.answer;
    core.guardOk = guarded.allowed;
    core.guardReasons = guarded.blockedReasons;
    if (intent.turnIntoDecision || intent.optionSelect) {
      const kernelSuffix = core.templateAnswer.includes("\n\n") ? core.templateAnswer.split("\n\n").slice(-1)[0] : null;
      if (kernelSuffix && /decision|ACTIVE|checks/i.test(kernelSuffix)) {
        answer = `${answer}\n\n${kernelSuffix}`;
      }
    }
    const response = finalizeBrainTurn(core, answer, {
      llmMs,
      fallbackUsed: false,
      totalMs: Date.now() - totalStart,
    });
    response.context.evidence = synthesized.evidenceIds;
    return response;
  }

  return finalizeBrainTurn(core, answer, {
    llmMs,
    fallbackUsed: true,
    totalMs: Date.now() - totalStart,
  });
}

export function runTalkTurn(
  userId: string,
  message: string,
  opts?: { conversationId?: string | null; focusId?: string | null; action?: TalkActionId | null },
): TalkApiResponse {
  return talkToHustronix(userId, message, opts);
}

export async function runTalkTurnAsync(
  userId: string,
  message: string,
  opts?: { conversationId?: string | null; focusId?: string | null; action?: TalkActionId | null },
): Promise<TalkApiResponse> {
  return talkToHustronixAsync(userId, message, opts);
}
