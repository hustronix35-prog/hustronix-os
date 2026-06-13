import { config } from "./config.js";
import * as llm from "./llm.js";
import { researchTools, memoryTools, marketingTools } from "./tools/index.js";
import { broadcast, type AgentWsReply } from "./server.js";
import { db } from "./database.js";
import { preservedLiteralEmail } from "./utils/identity.js";
import { sanitizeAgentErrorMessage } from "./utils/client-safe-errors.js";
import { marketingPrompt } from "./agents/marketingPrompt.js";
import { COORDINATOR_INSTITUTIONAL_CONTRACT } from "./institutional-reasoning.js";
import { sanitizeInstitutionalTone } from "./epistemic-engine.js";
import { institutionalReasoningToolSchema } from "./coordinator-log-decision-schema.js";
import { fetchDecisionContext, formatForPrompt } from "./intelligence/index.js";
import { formatOrganizationContextBlock } from "./org-context.js";
import { formatPlanModePrompt } from "./plan-mode.js";

export type RunAgentOptions = {
  /** Cursor-style plan turn: clarifying questions before mutating tools. */
  planMode?: boolean;
};

/** Normalize malformed model outputs where name and JSON were concatenated. */
function normalizeToolCalls(toolCalls: any[]): any[] {
  return toolCalls.map((tc: any) => {
    let cleanName = tc.name;
    let cleanArgs = tc.arguments;
    if (typeof cleanName === "string" && cleanName.includes(",") && cleanName.includes("{")) {
      const splitIdx = cleanName.indexOf(",");
      const potentialName = cleanName.substring(0, splitIdx).trim().replace(/['"]/g, "");
      const potentialJson = cleanName.substring(splitIdx + 1).trim();
      if (potentialJson.startsWith("{")) {
        cleanName = potentialName;
        cleanArgs = potentialJson;
      }
    }
    return { ...tc, name: cleanName, arguments: cleanArgs };
  });
}

function emitAgentWs(wsReply: AgentWsReply | undefined, type: string, data: Record<string, unknown>) {
  const payload = { type, ...data };
  if (wsReply) wsReply(payload);
  else broadcast(type, data);
}

/** Keeps coordinator system prompt JSON blobs under a token budget. */
function truncatePromptJson(value: unknown, maxChars: number): string {
  const s = JSON.stringify(value);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}… [truncated ${s.length - maxChars} chars]`;
}

function parseToolCallArgs(tc: any): Record<string, unknown> | null {
  const raw = tc.arguments ?? tc.function?.arguments;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function setToolCallArguments(tc: any, jsonStr: string): any {
  const next = { ...tc, arguments: jsonStr };
  if (tc.function) next.function = { ...tc.function, arguments: jsonStr };
  return next;
}

/**
 * Anthropic/OpenAI replay the full assistant `tool_use` / function-call payload on every later turn in the same request.
 * `log_strategic_decision` embeds institutional_reasoning → massive input repeat. Replace executed calls with minimal previews.
 * Mutates only the in-memory `messages` array (DB history remains full).
 */
function compactCoordinatorRoundAfterTools(
  messages: llm.Message[],
  toolResults: { tool_call_id: string; name: string; content: string }[],
): void {
  if (!toolResults.length) return;
  const assistantIdx = messages.length - toolResults.length - 1;
  if (assistantIdx < 0) return;
  const assistantMsg = messages[assistantIdx];
  if (assistantMsg.role !== "assistant" || !assistantMsg.tool_calls?.length) return;

  const cap = config.agent.coordinatorInflightAssistantAfterToolsCap;
  if (typeof assistantMsg.content === "string" && assistantMsg.content.length > cap) {
    assistantMsg.content = `${assistantMsg.content.slice(0, cap)}\n\n… [truncated for follow-up tool rounds — full reply saved in chat history]`;
  }

  const resultById = new Map(toolResults.map((tr) => [tr.tool_call_id, tr]));
  assistantMsg.tool_calls = assistantMsg.tool_calls.map((tc: any) => {
    const id = tc.id as string | undefined;
    const tr = id ? resultById.get(id) : undefined;
    const name = (tc.name ?? tc.function?.name) as string | undefined;

    if (name === "log_strategic_decision") {
      let decisionId: string | null = null;
      if (tr) {
        try {
          const j = JSON.parse(tr.content) as { decision_id?: string };
          if (typeof j.decision_id === "string") decisionId = j.decision_id;
        } catch {
          /* ignore */
        }
      }
      const args = parseToolCallArgs(tc);
      let vowPreview = "";
      if (args?.vow) vowPreview = String(args.vow).slice(0, 120);
      const slim = {
        _compact: true,
        decision_id: decisionId,
        vow_preview: vowPreview,
        note: "Full memo persisted server-side; use tool_result + ledger.",
      };
      return setToolCallArguments(tc, JSON.stringify(slim));
    }

    if (name === "delegate_to_marketing" || name === "delegate_to_research") {
      const args = parseToolCallArgs(tc);
      const q = args?.query;
      const slim = {
        _compact: true,
        query_preview: typeof q === "string" ? q.slice(0, 180) : "",
        note: "Delegate finished — detail in tool_result.",
      };
      return setToolCallArguments(tc, JSON.stringify(slim));
    }

    return tc;
  });
}

/**
 * Sub-agent: one system prompt, one tool set, bounded turns.
 */
async function runSubAgent(
  userId: string,
  agentName: string,
  query: string,
  tools: any[],
  systemPrompt: string,
): Promise<string> {
  console.log(`[Sub-Agent: ${agentName}] Starting task: "${query.slice(0, 50)}..."`);

  const messages: llm.Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ];

  for (let iter = 0; iter < 5; iter++) {
    const response = await llm.chat(userId, messages, tools, undefined, { modelTier: "fast" });

    const subText = sanitizeInstitutionalTone(response.text || "") || response.text || "";
    const assistantMessage: llm.Message = {
      role: "assistant",
      content: subText,
    };
    if (response.toolCalls?.length) assistantMessage.tool_calls = response.toolCalls;
    messages.push(assistantMessage);

    if (response.text) {
      db.log(userId, `Sub-Agent ${agentName}`, response.text);
    }

    if (!response.toolCalls?.length) {
      return subText || "Task completed.";
    }

    const cleaned = normalizeToolCalls(response.toolCalls);
    const valid = cleaned.filter((tc: any) => tools.some((t) => t.name === tc.name));
    if (valid.length === 0) {
      messages.push({ role: "assistant", content: "I attempted to call invalid tools. I will correct myself." });
      continue;
    }

    const last = messages[messages.length - 1];
    if (last.role === "assistant") last.tool_calls = valid;

    for (const tc of valid) {
      const tool = (tools as any[]).find((t: any) => t.name === tc.name);
      if (!tool) {
        messages.push({
          role: "tool",
          content: `Error: Tool "${tc.name}" not found.`,
          tool_call_id: tc.id,
          name: tc.name,
        });
        continue;
      }

      try {
        let args: any;
        try {
          args = typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments;
        } catch {
          args = {};
        }
        db.log(userId, `${agentName} Tool`, `${tc.name}`);
        const result = await (tool.handler || tool.execute)({ ...args, userId });
        let toolBody = JSON.stringify(result);
        const subCap = config.agent.subAgentToolResultMaxChars;
        if (toolBody.length > subCap) {
          toolBody = `${toolBody.slice(0, subCap)}… [Result Truncated]`;
        }
        messages.push({
          role: "tool",
          content: toolBody,
          tool_call_id: tc.id,
          name: tc.name,
        });
      } catch (err: any) {
        messages.push({
          role: "tool",
          content: `Error: ${err.message}`,
          tool_call_id: tc.id,
          name: tc.name,
        });
      }
    }
  }
  return `Agent ${agentName} timed out.`;
}

function buildSupervisorPrompt(
  userId: string,
  worldModel: Record<string, unknown>,
  options?: { planMode?: boolean },
): string {
  const pendingDecisions = db.getPendingDecisions(userId);
  const recentOutcomes = db.getRecentOutcomes(userId, config.agent.supervisorRecentAuditOutcomes);
  const jsonCap = config.agent.supervisorJsonBlobMaxChars;

  /**
   * Decision context block — implements the "always fetch decision context before reasoning" rule.
   * A deterministic snapshot of the active decision, live executions, and recent (already-enriched)
   * signals, positioned BEFORE operating principles so the model treats it as ground truth.
   */
  let decisionContextBlock = "";
  try {
    const ctx = fetchDecisionContext(userId, config.agent.decisionContextSignalLimit);
    decisionContextBlock = `\n${formatForPrompt(ctx, {
      maxExecutions: config.agent.decisionContextMaxExecutions,
      maxSignals: config.agent.decisionContextMaxSignalsInPrompt,
      maxVowChars: config.agent.decisionContextMaxVowChars,
      maxExpectedOutcomesChars: config.agent.decisionContextMaxOutcomesChars,
      signalContentChars: config.agent.decisionContextSignalContentChars,
    })}\n`;
  } catch (e) {
    console.warn("[agent] fetchDecisionContext failed; proceeding without context block:", e);
  }

  const organizationContextBlock = formatOrganizationContextBlock(userId);
  const planModeBlock = formatPlanModePrompt(Boolean(options?.planMode));

  return `
### HUX-COORDINATOR | LEDGER MODE
You align recorded decisions, execution capacity, and observed signals. You are infrastructure: evidence-first, uncertainty-aware, and gated on causal validation before any irreversible recommendation.
${organizationContextBlock}${decisionContextBlock}
${planModeBlock}

**Operating principles**
1. **Shadow work**: work outside the ledger without linkage is policy risk; surface it and recommend KILL or LINK per existing rules.
2. **Capacity**: published capacity is a hard budget; propose KILL or deferral before overload.
3. **Dependencies**: execution respects task dependencies; do not recommend bypass.
4. **Constraints**: breaching the stated "no list" degrades audit posture; report violations in neutral terms.
5. **Structural stress**: if most tasks for a decision fail or block, recommend UNDER_REVIEW—not narrative rescue.
6. **Decision context above is canonical for ledger facts.** Do not invent decisions, executions, or signals not listed there. If the user asks about ledger items not in that block, say so.
7. **Organization profile** (when present above) is canonical for company identity, ICP, north star, and decision culture. Use it when asked what you know about their company; do not say you have no company context while that block is populated.

**Ledger capture (log_strategic_decision)**
Supply vow, expected_outcomes, constraints, reversal_conditions, tasks, and **institutional_reasoning** as **v3 only** here (\`institutional_version: 3\`): ranked hypotheses (probabilities ≈ sum to 1), evidence per hypothesis + graph, validation_requirements (PENDING in DRAFT), secondary_effects_structured, recommended_actions with \`expected_impact_range\` and LOW|MEDIUM|HIGH costs/risks, reversibility_0_1, decision_confidence_0_1, causal_validation, second_order_effects, equilibrium, reasoning_reliability. Server attaches **epistemic_derivation**. Legacy **v2** memos are only for REST ingestion—not this tool schema. Never use judicial certainty language ("ROOT CAUSE CONFIRMED", "culprit"). Incomplete causal_validation → DRAFT; activation is gated server-side.

**Sequencing default**
When multiple interventions compete: (1) survival / activation-critical paths, (2) retention and active-user risk, (3) structural or onboarding change, (4) re-engagement and long-cycle recovery—unless evidence or constraints force a different order; state any override explicitly.

**Context**
Current status: ${truncatePromptJson(db.getUsageStats(userId), jsonCap)}
Pending strategic decisions: ${truncatePromptJson(pendingDecisions, jsonCap)}
Recent audit: ${truncatePromptJson(recentOutcomes, jsonCap)}
World model: ${truncatePromptJson(worldModel, jsonCap)}

${COORDINATOR_INSTITUTIONAL_CONTRACT}
`;
}

function buildCoordinatorTools(userId: string): any[] {
  return [
    {
      name: "ping",
      description: "Diagnostic tool to verify response.",
      parameters: { type: "object", properties: { message: { type: "string" } } },
      handler: async ({ message }: any) => ({
        status: "pong",
        received: message,
        timestamp: new Date().toISOString(),
      }),
    },
    {
      name: "delegate_to_marketing",
      description: "Call Marketing Agent for copywriting, CRO, or SEO.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      handler: async ({ query }: any) =>
        await runSubAgent(
          userId,
          "Marketing",
          query,
          marketingTools,
          `${marketingPrompt}\n\nFollow coordinator alignment: evidence-led copy, no theatrical framing.`,
        ),
    },
    {
      name: "delegate_to_research",
      description: "Call Research Agent for web searching or audits.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      handler: async ({ query }: any) =>
        await runSubAgent(
          userId,
          "Research",
          query,
          researchTools,
          "Research agent: prioritize sources, rank hypotheses by plausibility, list disconfirming evidence, and state what would falsify each read. Institutional tone only — no theatrical or hype prose.",
        ),
    },
    {
      name: "log_strategic_decision",
      description:
        "Persist decision: vow, outcomes, constraints, reversal, tasks, institutional_reasoning (v3 JSON only). Required for tracked work.",
      parameters: {
        type: "object",
        properties: {
          vow: { type: "string", description: "Explicit commitment statement." },
          expected_outcomes: {
            type: "array",
            items: { type: "string" },
            description: "Deterministic success metrics or targets.",
          },
          constraints: { type: "array", items: { type: "string" }, description: "Forbidden actions or behaviors." },
          reversal_conditions: {
            type: "string",
            description: "Measurable conditions that trigger abandonment or rollback.",
          },
          institutional_reasoning: institutionalReasoningToolSchema,
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                owner: { type: "string", description: "Function or person owning the task." },
                type: { type: "string", enum: ["ACTION", "KILL", "VERIFY", "BLOCK"] },
                priority: { type: "number", description: "1 (high) to 5 (low)" },
                weight: { type: "number", description: "Capacity cost (0.1 to 1.0)" },
                success_condition: { type: "string" },
                dependencies: {
                  type: "array",
                  items: { type: "string" },
                  description: "task_ids this task depends on",
                },
              },
              required: ["owner", "type", "priority", "weight", "success_condition"],
            },
          },
        },
        required: ["vow", "expected_outcomes", "constraints", "reversal_conditions", "tasks", "institutional_reasoning"],
      },
      handler: async (data: any) => {
        const id = db.saveDecisionEvent(userId, data);
        return {
          success: true,
          decision_id: id,
          message:
            "Decision recorded as DRAFT. Server attaches epistemic_derivation for v3. Activation requires causal_validation.complete, all validation_requirements SATISFIED, derived confidence ≥ floor, per institutional contract.",
        };
      },
    },
    {
      name: "transition_execution",
      description: "Manually transition a task state (e.g. to ACTIVE, DONE, or KILLED).",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          newState: { type: "string", enum: ["ACTIVE", "DONE", "KILLED"] },
          reason: { type: "string" },
        },
        required: ["task_id", "newState", "reason"],
      },
      handler: async (data: any) => db.transitionExecutionState(data.task_id, data.newState, data.reason),
    },
    ...memoryTools,
  ];
}

/**
 * Hustronix OS Coordinator — loads history, runs LLM + tools until done or cap.
 */
export async function runAgent(
  userId: string,
  userInput: string,
  _dataUri?: string,
  sessionId: string = "default",
  wsReply?: AgentWsReply,
  options?: RunAgentOptions,
): Promise<string> {
  if (!llm.hasLlmCredentials(userId)) {
    const msg =
      "No AI API key is configured on the server. Add ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY) to the `.env` file in the project folder, set ACTIVE_PROVIDER if needed, then restart the backend.";
    emitAgentWs(wsReply, "typing", { status: false });
    emitAgentWs(wsReply, "error", { message: msg });
    db.saveMessage(userId, "assistant", `[Error] ${msg}`, null, sessionId);
    return `Error: ${msg}`;
  }

  const rawHistory = db.getRecentMessages(userId, sessionId, config.agent.historyMessages);
  const msgCap = config.agent.chatMessageCharCap;
  const history = rawHistory.map((m: { role: string; content: string }) => {
    let content = m.content;
    if (content.length > msgCap) {
      content = `${content.slice(0, msgCap)}... [Content Truncated]`;
    }
    return { role: m.role as llm.Message["role"], content };
  });

  const coreSystemPrompt = db.getCoreMemory(userId, "system_prompt")?.trim() || config.agent.systemPrompt;

  let worldModel: Record<string, unknown>;
  try {
    const worldModelRaw = db.getCoreMemory(userId, "world_model");
    worldModel = worldModelRaw ? (JSON.parse(worldModelRaw) as Record<string, unknown>) : {};
  } catch {
    worldModel = {};
  }
  if (!worldModel.hypotheses) {
    worldModel = {
      hypotheses: {},
      confidence: 0.5,
      regime_timestamp: new Date().toISOString(),
      cds_score: 0,
    };
  }

  const planMode = Boolean(options?.planMode);
  const supervisorPrompt = buildSupervisorPrompt(userId, worldModel, { planMode });
  const coordinatorTools = buildCoordinatorTools(userId);

  const perfHint = planMode
    ? "\n\nPlan mode: prioritize clarifying questions over tool calls this turn; keep prose short."
    : "\n\nPerformance & cost: Prefer short user-visible prose (headline + bullets); put depth inside tools (e.g. institutional_reasoning), not long narrative before tool calls. Skip redundant tool rounds. When the request is ambiguous, ask clarifying questions before mutating tools.";

  let messages: llm.Message[] = [
    { role: "system", content: `${coreSystemPrompt}\n\n${supervisorPrompt}${perfHint}` },
    ...history,
    { role: "user", content: userInput },
  ];

  db.saveMessage(userId, "user", userInput, null, sessionId);
  console.log(`[Coordinator] user message: "${userInput.slice(0, 50)}..."`);
  emitAgentWs(wsReply, "typing", { status: true });

  let iterations = 0;
  const maxIterations = config.agent.maxIterations;
  let isAborted = false;
  const abortCtl = new AbortController();
  const globalMs = config.agent.globalTimeoutMs;

  const globalTimeout = setTimeout(() => {
    isAborted = true;
    abortCtl.abort();
    console.error(`GLOBAL AGENT TIMEOUT (${globalMs}ms); aborting in-flight LLM call.`);
    emitAgentWs(wsReply, "typing", { status: false });
    emitAgentWs(wsReply, "error", { message: "System timeout. Please try again." });
  }, globalMs);

  try {
    while (iterations < maxIterations && !isAborted) {
      iterations++;
      console.log(`[Coordinator] iteration ${iterations}`);

      let streamedThisRound = "";
      let response: Awaited<ReturnType<typeof llm.chat>>;
      try {
        response = await llm.chat(
          userId,
          messages,
          coordinatorTools,
          (chunk) => {
            streamedThisRound += chunk;
            emitAgentWs(wsReply, "text_chunk", { text: chunk });
          },
          { abortSignal: abortCtl.signal, modelTier: "premium" },
        );
      } catch (llmErr: unknown) {
        const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
        if (msg === "Aborted" || (llmErr instanceof Error && llmErr.name === "AbortError")) {
          clearTimeout(globalTimeout);
          emitAgentWs(wsReply, "typing", { status: false });
          return "";
        }
        if (streamedThisRound.trim().length >= 40) {
          clearTimeout(globalTimeout);
          emitAgentWs(wsReply, "typing", { status: false });
          const saved = sanitizeInstitutionalTone(
            `${streamedThisRound.trim()}\n\n_(Generation stopped early — your partial answer was saved.)_`,
          );
          db.saveMessage(userId, "assistant", saved, null, sessionId);
          emitAgentWs(wsReply, "text", { text: saved });
          return streamedThisRound;
        }
        throw llmErr;
      }

      if (isAborted) {
        clearTimeout(globalTimeout);
        emitAgentWs(wsReply, "typing", { status: false });
        return "";
      }

      console.log(`[Coordinator] LLM response received`);

      let sanitizedAssistant =
        sanitizeInstitutionalTone(response.text || "") || response.text || "";
      const hitOutputCap =
        response.stopReason === "max_tokens" || response.stopReason === "length";
      if (hitOutputCap && sanitizedAssistant.trim()) {
        sanitizedAssistant = `${sanitizedAssistant.trim()}\n\n_(Reply shortened: output length limit reached. Say **continue from Phase 4** or ask for a shorter plan.)_`;
      }

      const assistantMessage: llm.Message = {
        role: "assistant",
        content: sanitizedAssistant,
      };
      if (response.toolCalls?.length) {
        assistantMessage.tool_calls = response.toolCalls;
      }
      messages.push(assistantMessage);

      if (response.text) {
        db.saveMessage(userId, "assistant", sanitizedAssistant, null, sessionId);
        emitAgentWs(wsReply, "text", { text: sanitizedAssistant });
      }

      if (!response.toolCalls?.length) {
        emitAgentWs(wsReply, "typing", { status: false });
        clearTimeout(globalTimeout);
        return sanitizedAssistant;
      }

      const cleaned = normalizeToolCalls(response.toolCalls);
      const validToolCalls = cleaned.filter((tc: any) => coordinatorTools.some((t) => t.name === tc.name));
      if (validToolCalls.length === 0 && cleaned.length > 0) {
        messages.push({ role: "assistant", content: "I attempted to call invalid tools. I will correct myself." });
        continue;
      }

      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "assistant" && validToolCalls.length > 0) {
        lastMsg.tool_calls = validToolCalls;
      }

      const runOneTool = async (tc: any) => {
        if (isAborted) {
          return {
            tool_call_id: tc.id,
            name: tc.name,
            content: "Error: Aborted.",
          };
        }
        console.log(`[Coordinator -> tool] ${tc.name}`);
        const tool = (coordinatorTools as any[]).find((t: any) => t.name === tc.name);

        if (!tool) {
          return {
            tool_call_id: tc.id,
            name: tc.name,
            content: `Error: Tool "${tc.name}" not found.`,
          };
        }

        try {
          let args = typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments;

          if (tc.name === "log_strategic_decision" && typeof (args as any).expected_metrics === "string") {
            (args as any).expected_metrics = { description: (args as any).expected_metrics };
          }

          if (args.to) args.to = preservedLiteralEmail(args.to, userInput);
          if (args.email) args.email = preservedLiteralEmail(args.email, userInput);

          db.log(userId, "Coordinator Execute", `${tc.name}`);
          const result = await (tool.handler || tool.execute)({ ...args, userId });

          let resultStr = JSON.stringify(result);
          const coordCap = config.agent.coordinatorToolResultMaxChars;
          if (resultStr.length > coordCap) resultStr = `${resultStr.slice(0, coordCap)}... [Result Truncated]`;

          db.log(userId, "Coordinator Result", `${tc.name}: ${resultStr.slice(0, 200)}`);
          return {
            tool_call_id: tc.id,
            name: tc.name,
            content: resultStr,
          };
        } catch (err: any) {
          console.error(`Coordinator tool error (${tc.name}):`, err.message);
          return {
            tool_call_id: tc.id,
            name: tc.name,
            content: `Error: ${err.message}`,
          };
        }
      };

      const toolResults = await Promise.all(validToolCalls.map((tc) => runOneTool(tc)));
      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          content: tr.content,
          tool_call_id: tr.tool_call_id,
          name: tr.name,
        });
      }
      compactCoordinatorRoundAfterTools(messages, toolResults);
    }

    emitAgentWs(wsReply, "typing", { status: false });
    clearTimeout(globalTimeout);
    if (isAborted) {
      return "";
    }
    return "System: coordinator iteration limit reached without completion.";
  } catch (err: any) {
    const raw = err?.message ?? err;
    if (raw === "Aborted" || err?.name === "AbortError") {
      clearTimeout(globalTimeout);
      emitAgentWs(wsReply, "typing", { status: false });
      return "";
    }
    console.error(`Fatal agent error:`, err.message);
    clearTimeout(globalTimeout);
    emitAgentWs(wsReply, "typing", { status: false });
    const safe = sanitizeAgentErrorMessage(err?.message || err);
    emitAgentWs(wsReply, "error", { message: safe });
    db.saveMessage(userId, "assistant", `[Error] ${safe}`, null, sessionId);
    return `Error: ${safe}`;
  }
}
