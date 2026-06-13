import { db } from "../database.js";

/**
 * Context Engine — the "always fetch decision context before reasoning" layer.
 *
 * Hustronix already enforces "one ACTIVE decision per tenant" in the database
 * layer, so the Context Engine returns at most one active decision plus its
 * live execution surface and a small recent-signals window. Everything here is
 * synchronous SQLite reads — the engine is on the hot path of every agent
 * turn and every signal write, so no LLM, no remote calls.
 *
 * The output is consumed in two places:
 *   1. {@link formatForPrompt} — embedded into the supervisor system prompt
 *      so the LLM sees the actual ledger state before reasoning.
 *   2. The auto-linker — uses the same active-decision + active-executions
 *      slice to score candidate signal→execution links.
 */

export interface DecisionContext {
  userId: string;
  activeDecision: {
    id: string;
    vow: string;
    expectedOutcomes: unknown;
    constraints: string[];
    reversalConditions: string | null;
    confidence: number;
    createdAt: string;
  } | null;
  activeExecutions: {
    taskId: string;
    decisionId: string;
    decisionVow: string;
    owner: string;
    type: string;
    weight: number;
    status: string;
    successCondition: string | null;
    failureCondition: string | null;
    lastUpdate: string;
  }[];
  recentSignals: {
    id: string;
    source: string;
    content: string;
    owner: string;
    state: string;
    detectedAt: string;
    intent: string | null;
    risk: string | null;
    relatedDecisionId: string | null;
    linkedExecutionId: string | null;
  }[];
  /** True when there is at least one ACTIVE decision; false means "no enforcement floor right now". */
  hasActiveCommitment: boolean;
  fetchedAt: string;
}

function safeJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String);
  } catch {
    /* fall through */
  }
  return [];
}

/**
 * Pure read. Cheap enough to call on every agent turn and every signal write.
 * `userId === "system"` returns the system tenant's view (which is also the
 * "everything" view per the multi-tenant rules in `database.ts`).
 */
export function fetchDecisionContext(userId: string, recentLimit = 12): DecisionContext {
  const decision = db.getActiveDecision(userId);
  const executions = db.getActiveExecutions(userId, 50);
  const signals = db.getRecentSignals(userId, recentLimit);

  return {
    userId,
    activeDecision: decision
      ? {
          id: decision.id,
          vow: decision.vow,
          expectedOutcomes: parseExpectedOutcomes(decision.expected_outcomes),
          constraints: safeJsonArray(decision.constraints),
          reversalConditions: decision.reversal_conditions ?? null,
          confidence: decision.confidence,
          createdAt: decision.created_at,
        }
      : null,
    activeExecutions: executions.map((e) => ({
      taskId: e.task_id,
      decisionId: e.decision_id,
      decisionVow: e.decision_vow,
      owner: e.owner,
      type: e.type,
      weight: e.weight,
      status: e.status,
      successCondition: e.success_condition ?? null,
      failureCondition: e.failure_condition ?? null,
      lastUpdate: e.last_update,
    })),
    recentSignals: signals.map((s) => ({
      id: String(s.id),
      source: String(s.source),
      content: String(s.content),
      owner: String(s.owner),
      state: String(s.state),
      detectedAt: String(s.detected_at),
      intent: (s.intent as string | null) ?? null,
      risk: (s.risk as string | null) ?? null,
      relatedDecisionId: (s.related_decision_id as string | null) ?? null,
      linkedExecutionId: (s.linked_execution_id as string | null) ?? null,
    })),
    hasActiveCommitment: !!decision,
    fetchedAt: new Date().toISOString(),
  };
}

/** `expected_outcomes` is JSON-stringified; it can be either an array of strings or array of objects. */
function parseExpectedOutcomes(raw: unknown): unknown {
  if (raw == null) return [];
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Renders a compact, deterministic block for the LLM supervisor prompt.
 * Designed to be cheap on tokens — execution list is capped, signal content
 * is truncated. The shape stays stable so the model can rely on positional
 * cues (e.g. "ACTIVE DECISION" header) instead of hunting through prose.
 */
export function formatForPrompt(
  ctx: DecisionContext,
  opts: {
    maxExecutions?: number;
    maxSignals?: number;
    maxVowChars?: number;
    maxExpectedOutcomesChars?: number;
    signalContentChars?: number;
  } = {},
): string {
  const maxExecutions = opts.maxExecutions ?? 12;
  const maxSignals = opts.maxSignals ?? 8;
  const maxVowChars = opts.maxVowChars ?? 480;
  const maxExpectedOutcomesChars = opts.maxExpectedOutcomesChars ?? 560;
  const signalContentChars = opts.signalContentChars ?? 140;

  const decisionBlock = ctx.activeDecision
    ? [
        `### ACTIVE DECISION (id=${ctx.activeDecision.id})`,
        `VOW: ${
          ctx.activeDecision.vow.length > maxVowChars
            ? `${ctx.activeDecision.vow.slice(0, maxVowChars)}…`
            : ctx.activeDecision.vow
        }`,
        `EXPECTED_OUTCOMES: ${(() => {
          let s = JSON.stringify(ctx.activeDecision.expectedOutcomes);
          if (s.length > maxExpectedOutcomesChars) s = `${s.slice(0, maxExpectedOutcomesChars)}…`;
          return s;
        })()}`,
        `CONSTRAINTS (NO list): ${JSON.stringify(ctx.activeDecision.constraints)}`,
        ctx.activeDecision.reversalConditions
          ? `REVERSAL_CONDITIONS: ${
              ctx.activeDecision.reversalConditions.length > 320
                ? `${ctx.activeDecision.reversalConditions.slice(0, 320)}…`
                : ctx.activeDecision.reversalConditions
            }`
          : null,
        `CONFIDENCE: ${ctx.activeDecision.confidence}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "### ACTIVE DECISION\n(none — no enforcement floor right now; new tracked work requires log_strategic_decision first)";

  const execLines = ctx.activeExecutions.slice(0, maxExecutions).map((e) => {
    const cond = (e.successCondition || "").slice(0, 120);
    return `- ${e.taskId.slice(0, 8)} [${e.status}] (decision=${e.decisionId.slice(0, 8)}) owner=${e.owner} type=${e.type} weight=${e.weight} :: ${cond}`;
  });
  const execBlock =
    execLines.length > 0
      ? `### LIVE EXECUTIONS (${ctx.activeExecutions.length} total, showing ${execLines.length})\n${execLines.join("\n")}`
      : "### LIVE EXECUTIONS\n(none active)";

  const sigLines = ctx.recentSignals.slice(0, maxSignals).map((s) => {
    const enrichment = [
      s.intent ? `intent="${s.intent}"` : null,
      s.risk ? `risk=${s.risk}` : null,
      s.relatedDecisionId ? `→decision=${s.relatedDecisionId.slice(0, 8)}` : null,
      s.linkedExecutionId ? `→execution=${s.linkedExecutionId.slice(0, 8)}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const content =
      s.content.length > signalContentChars ? `${s.content.slice(0, signalContentChars)}…` : s.content;
    return `- ${s.id.slice(0, 8)} [${s.state}] ${s.source} (${s.owner}): "${content}"${enrichment ? `  ⟶ ${enrichment}` : ""}`;
  });
  const sigBlock =
    sigLines.length > 0
      ? `### RECENT SIGNALS (showing ${sigLines.length})\n${sigLines.join("\n")}`
      : "### RECENT SIGNALS\n(none in window)";

  return [
    "## DECISION CONTEXT (ledger snapshot — ground truth)",
    decisionBlock,
    execBlock,
    sigBlock,
    "## END CONTEXT",
  ].join("\n\n");
}
