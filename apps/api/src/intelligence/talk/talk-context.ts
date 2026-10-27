/**
 * Talk V2 conversation state — memory for topics/entities, not company truth.
 */
export type TalkMessage = { role: "user" | "assistant"; text: string };

export type TalkOption = { n: number; label: string; summary: string };

export type TalkConversationEntities = {
  customers: string[];
  projects: string[];
  teams: string[];
  people: string[];
  products: string[];
};

export type TalkHypothesis = { text: string; source: "user" | "assistant"; at: string };

export type TalkContext = {
  conversationId: string;
  activeSituationId?: string;
  activeDecisionId?: string;
  activeCustomerId?: string;
  activeTeamId?: string;
  currentTopic?: string;
  currentEntities: TalkConversationEntities;
  currentSituationIds: string[];
  currentDecisionIds: string[];
  conversationMode?: "GENERAL" | "COMPANY" | "HYBRID" | "ACTION";
  recentTopics: string[];
  recentEntities: string[];
  recentContext: string[];
  lastUserIntent?: string;
  lastUserQuestion?: string;
  lastAnswer?: string;
  lastMode?: string;
  lastContextMode?: string;
  lastOptions: TalkOption[];
  lastHypotheses: TalkHypothesis[];
  lastProvenance?: {
    recommendation: string;
    supportingEvidence: string[];
    relatedSituations: string[];
    priorOutcomes: string[];
    confidence: number;
  };
  recentMessages: TalkMessage[];
  referencedSituations: string[];
};

/** @deprecated shape used by older Talk helpers */
export type ConversationState = TalkContext & {
  referencedEntities: string[];
  pendingAction?: string;
};

/** Alias for V2 naming */
export type TalkConversationState = TalkContext;

const store = new Map<string, TalkContext>();

function emptyEntities(): TalkConversationEntities {
  return { customers: [], projects: [], teams: [], people: [], products: [] };
}

export function emptyTalkContext(conversationId = "default"): TalkContext {
  return {
    conversationId,
    currentEntities: emptyEntities(),
    currentSituationIds: [],
    currentDecisionIds: [],
    recentTopics: [],
    recentEntities: [],
    recentContext: [],
    lastOptions: [],
    lastHypotheses: [],
    recentMessages: [],
    referencedSituations: [],
  };
}

function keyFor(userId: string, conversationId?: string | null): string {
  return `${userId}::${conversationId || "default"}`;
}

export function getTalkContext(userId: string, conversationId?: string | null): TalkContext {
  const existing = store.get(keyFor(userId, conversationId));
  if (!existing) return emptyTalkContext(conversationId || "default");
  // Migrate older in-memory shapes safely
  return {
    ...emptyTalkContext(existing.conversationId),
    ...existing,
    currentEntities: existing.currentEntities || emptyEntities(),
    currentSituationIds: existing.currentSituationIds || existing.referencedSituations || [],
    currentDecisionIds: existing.currentDecisionIds || [],
    recentContext: existing.recentContext || [],
    lastHypotheses: existing.lastHypotheses || [],
  };
}

/** Clear sticky investigation focus when the user hard-switches topic (e.g. LEARN). */
export function clearTalkInvestigationFocus(userId: string, conversationId?: string | null): TalkContext {
  const prev = getTalkContext(userId, conversationId);
  const next: TalkContext = {
    ...prev,
    activeSituationId: undefined,
    activeDecisionId: undefined,
    activeCustomerId: undefined,
    currentSituationIds: [],
    currentDecisionIds: [],
    referencedSituations: [],
    conversationMode: "GENERAL",
  };
  store.set(keyFor(userId, conversationId), next);
  return next;
}

export function rememberTalkTurn(
  userId: string,
  question: string,
  answer: string,
  extras?: {
    conversationId?: string | null;
    topic?: string;
    entities?: string[];
    situationIds?: string[];
    decisionId?: string | null;
    customer?: string;
    mode?: string;
    contextMode?: string;
    intent?: string;
    options?: TalkOption[];
    provenance?: TalkContext["lastProvenance"];
    hypotheses?: TalkHypothesis[];
    clearFocus?: boolean;
  },
): TalkContext {
  const conversationId = extras?.conversationId || "default";
  let prev = getTalkContext(userId, conversationId);
  if (extras?.clearFocus) {
    prev = clearTalkInvestigationFocus(userId, conversationId);
  }

  const entities = unique([...(extras?.entities || []), ...prev.recentEntities]).slice(0, 12);
  const sits =
    extras?.clearFocus
      ? unique(extras?.situationIds || []).slice(0, 8)
      : unique([...(extras?.situationIds || []), ...prev.currentSituationIds, ...prev.referencedSituations]).slice(0, 8);
  const decisions = unique(
    [extras?.decisionId || "", ...(prev.currentDecisionIds || [])].filter(Boolean) as string[],
  ).slice(0, 6);

  const customers = unique([
    extras?.customer || "",
    ...(extras?.entities || []),
    ...prev.currentEntities.customers,
  ]).slice(0, 8);

  const next: TalkContext = {
    conversationId,
    activeSituationId: extras?.clearFocus
      ? extras?.situationIds?.[0]
      : extras?.situationIds?.[0] || prev.activeSituationId,
    activeDecisionId: extras?.decisionId || (extras?.clearFocus ? undefined : prev.activeDecisionId),
    activeCustomerId: extras?.customer || extras?.entities?.[0] || (extras?.clearFocus ? undefined : prev.activeCustomerId),
    activeTeamId: prev.activeTeamId,
    currentTopic: extras?.topic || prev.currentTopic,
    currentEntities: {
      ...prev.currentEntities,
      customers,
    },
    currentSituationIds: sits,
    currentDecisionIds: decisions,
    conversationMode: (extras?.contextMode as TalkContext["conversationMode"]) || prev.conversationMode,
    recentTopics: unique([extras?.topic || "", ...prev.recentTopics]).filter(Boolean).slice(0, 8),
    recentEntities: entities,
    recentContext: unique([extras?.topic || "", question.slice(0, 120), ...prev.recentContext]).filter(Boolean).slice(0, 10),
    lastUserIntent: extras?.intent || extras?.mode || prev.lastUserIntent,
    lastUserQuestion: question,
    lastAnswer: answer,
    lastMode: extras?.mode || prev.lastMode,
    lastContextMode: extras?.contextMode || prev.lastContextMode,
    lastOptions: extras?.options?.length ? extras.options : prev.lastOptions,
    lastHypotheses: extras?.hypotheses?.length
      ? [...extras.hypotheses, ...prev.lastHypotheses].slice(0, 8)
      : prev.lastHypotheses,
    lastProvenance: extras?.provenance || prev.lastProvenance,
    recentMessages: [
      ...prev.recentMessages,
      { role: "user" as const, text: question },
      { role: "assistant" as const, text: answer },
    ].slice(-12),
    referencedSituations: sits,
  };
  store.set(keyFor(userId, conversationId), next);
  return next;
}

export function getConversation(userId: string, sessionId?: string | null): ConversationState {
  const ctx = getTalkContext(userId, sessionId);
  return {
    ...ctx,
    currentTopic: ctx.currentTopic || ctx.recentTopics[0],
    referencedEntities: ctx.recentEntities,
  };
}

export function rememberTurn(
  userId: string,
  question: string,
  answer: string,
  extras?: {
    sessionId?: string | null;
    topic?: string;
    entities?: string[];
    situationIds?: string[];
    mode?: string;
  },
): ConversationState {
  const ctx = rememberTalkTurn(userId, question, answer, {
    conversationId: extras?.sessionId,
    topic: extras?.topic,
    entities: extras?.entities,
    situationIds: extras?.situationIds,
    mode: extras?.mode,
  });
  return { ...ctx, currentTopic: ctx.currentTopic || ctx.recentTopics[0], referencedEntities: ctx.recentEntities };
}

function unique(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const k = String(x || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
