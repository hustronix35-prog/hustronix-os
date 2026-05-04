import { config } from "./config.js";
import * as llm from "./llm.js";
import { researchTools, memoryTools, marketingTools } from "./tools/index.js";
import { broadcast, type AgentWsReply } from "./server.js";
import { db } from "./database.js";
import { preservedLiteralEmail } from "./utils/identity.js";
import { sanitizeAgentErrorMessage } from "./utils/client-safe-errors.js";
import { marketingPrompt } from "./agents/marketingPrompt.js";

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
  console.log(`🤖 [Sub-Agent: ${agentName}] Starting task: "${query.slice(0, 50)}..."`);

  const messages: llm.Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ];

  for (let iter = 0; iter < 5; iter++) {
    const response = await llm.chat(userId, messages, tools);

    const assistantMessage: llm.Message = {
      role: "assistant",
      content: response.text || "",
    };
    if (response.toolCalls?.length) assistantMessage.tool_calls = response.toolCalls;
    messages.push(assistantMessage);

    if (response.text) {
      db.log(userId, `Sub-Agent ${agentName}`, response.text);
    }

    if (!response.toolCalls?.length) {
      return response.text || "Task completed.";
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
        messages.push({
          role: "tool",
          content: JSON.stringify(result),
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

function buildSupervisorPrompt(userId: string, worldModel: Record<string, unknown>): string {
  const pendingDecisions = db.getPendingDecisions(userId);
  const recentOutcomes = db.getRecentOutcomes(userId, 5);

  return `
### HUX-OPERATOR | V1.0 [PRD-HARDENED]
You are the **Sovereign Operator**. You do not consult. You enforce structural alignment between decisions and reality.

**THE 6 HARDENED RULES (NON-NEGOTIABLE)**:
1. **KILL SHADOW WORK**: Any work detected outside this system without a link is KILLED immediately after grace (2h Slack, 12h GitHub).
2. **CAPACITY IS ABSOLUTE**: Max capacity = 3.0. If load > capacity, you MUST suggest a KILL before starting anything new.
3. **DEPENDENCY LOCK**: Tasks are BLOCKED until all dependencies are DONE. No "starting early".
4. **INTEGRITY IS REPUTATION**: Every KILLED task or breached grace reduces your reputation (-0.1). 3 successes recover it.
5. **THE "NO" LIST**: Every decision MUST have a list of forbidden behaviors (constraints). Violation = Instant Block.
6. **STRUCTURAL COLLAPSE**: If >50% of tasks for a decision fail/block, the decision is structurally invalid and is UNDER_REVIEW.

**STRATEGIC LEDGER STRUCTURE**:
1. **THE VOW**: "We choose [X] over [Y]". No nuance.
2. **EXPECTED OUTCOMES**: Deterministic metrics.
3. **CONSTRAINTS (NO LIST)**: What we will NOT do to protect capacity.
4. **EXECUTION CHAIN**: Weighted, prioritized sequential tasks.

**CONTEXT**:
Current Status: ${JSON.stringify(db.getUsageStats(userId))}
Pending strategic decisions: ${JSON.stringify(pendingDecisions)}
Recent Audit: ${JSON.stringify(recentOutcomes)}
World model: ${JSON.stringify(worldModel)}
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
          `${marketingPrompt}\n\nOperate under PRD V1.0 strict enforcement.`,
        ),
    },
    {
      name: "delegate_to_research",
      description: "Call Research Agent for web searching or audits.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      handler: async ({ query }: any) =>
        await runSubAgent(userId, "Research", query, researchTools, "Research Agent V1.0. Find signals, ignore noise."),
    },
    {
      name: "log_strategic_decision",
      description: "Log a Strategic Vow and its child Execution Chain. This is the only way to authorize work.",
      parameters: {
        type: "object",
        properties: {
          vow: { type: "string", description: "The explicit commitment: We choose X over Y." },
          expected_outcomes: { type: "array", items: { type: "string" }, description: "Deterministic success metrics." },
          constraints: { type: "array", items: { type: "string" }, description: "THE NO LIST: Forbidden actions/behaviors." },
          reversal_conditions: { type: "string", description: "When we abandon this vow." },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                owner: { type: "string", description: "Function or person owning the task." },
                type: { type: "string", enum: ["ACTION", "KILL", "VALIDATE"] },
                priority: { type: "number", description: "1 (High) to 5 (Low)" },
                weight: { type: "number", description: "Capacity cost (0.1 to 1.0)" },
                success_condition: { type: "string" },
                dependencies: { type: "array", items: { type: "string" }, description: "List of task_ids this depends on." },
              },
              required: ["owner", "type", "priority", "weight", "success_condition"],
            },
          },
        },
        required: ["vow", "expected_outcomes", "constraints", "tasks"],
      },
      handler: async (data: any) => {
        const id = db.saveDecisionEvent(userId, data);
        return { success: true, decision_id: id, message: "Strategic Vow logged. Status: DRAFT. Activation gate pending." };
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
  const history = rawHistory.map((m: { role: string; content: string }) => {
    let content = m.content;
    if (content.length > 2000) {
      content = `${content.slice(0, 2000)}... [Content Truncated]`;
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

  const supervisorPrompt = buildSupervisorPrompt(userId, worldModel);
  const coordinatorTools = buildCoordinatorTools(userId);

  const perfHint =
    "\n\nPerformance: Optimize for low latency — concise replies, avoid unnecessary tool rounds, and only invoke tools that materially change the answer.";

  let messages: llm.Message[] = [
    { role: "system", content: `${coreSystemPrompt}\n\n${supervisorPrompt}${perfHint}` },
    ...history,
    { role: "user", content: userInput },
  ];

  db.saveMessage(userId, "user", userInput, null, sessionId);
  console.log(`🚀 [Coordinator] Mission Start: "${userInput.slice(0, 50)}..."`);
  emitAgentWs(wsReply, "typing", { status: true });

  let iterations = 0;
  const maxIterations = config.agent.maxIterations;
  let isAborted = false;
  const abortCtl = new AbortController();
  const globalMs = config.agent.globalTimeoutMs;

  const globalTimeout = setTimeout(() => {
    isAborted = true;
    abortCtl.abort();
    console.error(`🚨 GLOBAL AGENT TIMEOUT reached (${globalMs}ms) — aborting in-flight LLM call.`);
    emitAgentWs(wsReply, "typing", { status: false });
    emitAgentWs(wsReply, "error", { message: "System timeout. Please try again." });
  }, globalMs);

  try {
    while (iterations < maxIterations && !isAborted) {
      iterations++;
      console.log(`🔄 [Coordinator] Iteration ${iterations}...`);

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
          { abortSignal: abortCtl.signal },
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
          const saved =
            `${streamedThisRound.trim()}\n\n_(Generation stopped early — your partial answer was saved.)_`;
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

      console.log(`✅ [Coordinator] LLM responded.`);

      const assistantMessage: llm.Message = {
        role: "assistant",
        content: response.text || "",
      };
      if (response.toolCalls?.length) {
        assistantMessage.tool_calls = response.toolCalls;
      }
      messages.push(assistantMessage);

      if (response.text) {
        db.saveMessage(userId, "assistant", response.text, null, sessionId);
        emitAgentWs(wsReply, "text", { text: response.text });
      }

      if (!response.toolCalls?.length) {
        emitAgentWs(wsReply, "typing", { status: false });
        clearTimeout(globalTimeout);
        return response.text ?? "";
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
        console.log(`🛠️ [Supervisor -> Tool] ${tc.name}`);
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
          if (resultStr.length > 3000) resultStr = `${resultStr.slice(0, 3000)}... [Result Truncated]`;

          db.log(userId, "Coordinator Result", `${tc.name}: ${resultStr.slice(0, 200)}`);
          return {
            tool_call_id: tc.id,
            name: tc.name,
            content: resultStr,
          };
        } catch (err: any) {
          console.error(`❌ Coordinator Tool Error (${tc.name}):`, err.message);
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
    }

    emitAgentWs(wsReply, "typing", { status: false });
    clearTimeout(globalTimeout);
    if (isAborted) {
      return "";
    }
    return "⚠️ System: Coordinator loop timed out.";
  } catch (err: any) {
    const raw = err?.message ?? err;
    if (raw === "Aborted" || err?.name === "AbortError") {
      clearTimeout(globalTimeout);
      emitAgentWs(wsReply, "typing", { status: false });
      return "";
    }
    console.error(`🚨 Fatal Agent Error:`, err.message);
    clearTimeout(globalTimeout);
    emitAgentWs(wsReply, "typing", { status: false });
    const safe = sanitizeAgentErrorMessage(err?.message || err);
    emitAgentWs(wsReply, "error", { message: safe });
    db.saveMessage(userId, "assistant", `[Error] ${safe}`, null, sessionId);
    return `Error: ${safe}`;
  }
}
