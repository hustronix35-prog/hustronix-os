import { config } from "./config.js";
import * as llm from "./llm.js";
import { memoryTools } from "./tools/index.js";
import { type AgentWsReply } from "./server.js";
import { db } from "./database.js";
import { sanitizeAgentErrorMessage } from "./utils/client-safe-errors.js";
import { sanitizeInstitutionalTone } from "./epistemic-engine.js";
import { buildAssistantSystemPrompt } from "./assistant-guide.js";

function emitAgentWs(wsReply: AgentWsReply | undefined, type: string, data: Record<string, unknown>) {
  const payload = { type, ...data };
  if (wsReply) wsReply(payload);
}

/**
 * Lightweight product-help agent for the header AI Assistant drawer.
 * Uses `asst:*` session ids so history never mixes with main Chat.
 */
export async function runAssistantAgent(
  userId: string,
  userInput: string,
  sessionId: string,
  wsReply?: AgentWsReply,
): Promise<string> {
  if (!llm.hasLlmCredentials(userId)) {
    const msg =
      "No AI API key is configured on the server. Add ANTHROPIC_API_KEY to the project `.env` and restart the API.";
    emitAgentWs(wsReply, "typing", { status: false });
    emitAgentWs(wsReply, "error", { message: msg });
    db.saveMessage(userId, "assistant", `[Error] ${msg}`, null, sessionId);
    return `Error: ${msg}`;
  }

  const rawHistory = db.getRecentMessages(userId, sessionId, 24);
  const msgCap = Math.min(config.agent.chatMessageCharCap, 6000);
  const history = rawHistory.map((m: { role: string; content: string }) => {
    let content = m.content;
    if (content.length > msgCap) {
      content = `${content.slice(0, msgCap)}... [truncated]`;
    }
    return { role: m.role as llm.Message["role"], content };
  });

  const systemPrompt = buildAssistantSystemPrompt();
  const messages: llm.Message[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userInput },
  ];

  db.saveMessage(userId, "user", userInput, null, sessionId);
  emitAgentWs(wsReply, "typing", { status: true });

  const maxIterations = 3;
  let iterations = 0;
  const abortCtl = new AbortController();
  const globalMs = Math.min(config.agent.globalTimeoutMs, 90_000);

  const globalTimeout = setTimeout(() => {
    abortCtl.abort();
    emitAgentWs(wsReply, "typing", { status: false });
    emitAgentWs(wsReply, "error", { message: "Assistant timed out. Try a shorter question." });
  }, globalMs);

  try {
    while (iterations < maxIterations) {
      iterations++;
      let streamed = "";
      let response: Awaited<ReturnType<typeof llm.chat>>;
      try {
        response = await llm.chat(
          userId,
          messages,
          memoryTools,
          (chunk) => {
            streamed += chunk;
            emitAgentWs(wsReply, "text_chunk", { text: chunk });
          },
          { abortSignal: abortCtl.signal, modelTier: "fast" },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "Aborted" || (err instanceof Error && err.name === "AbortError")) {
          clearTimeout(globalTimeout);
          emitAgentWs(wsReply, "typing", { status: false });
          return "";
        }
        if (streamed.trim().length >= 20) {
          const saved = streamed.trim();
          db.saveMessage(userId, "assistant", saved, null, sessionId);
          emitAgentWs(wsReply, "text", { text: saved });
          clearTimeout(globalTimeout);
          emitAgentWs(wsReply, "typing", { status: false });
          return saved;
        }
        throw err;
      }

      const text = sanitizeInstitutionalTone(response.text || "") || response.text || "";
      if (response.toolCalls?.length) {
        messages.push({
          role: "assistant",
          content: text,
          tool_calls: response.toolCalls,
        });
        if (text) {
          db.saveMessage(userId, "assistant", text, null, sessionId);
          emitAgentWs(wsReply, "text", { text });
        }

        for (const tc of response.toolCalls) {
          const tool = memoryTools.find((t) => t.name === tc.name);
          let result = "Tool not available.";
          if (tool) {
            try {
              const args =
                typeof tc.arguments === "string"
                  ? JSON.parse(tc.arguments)
                  : (tc.arguments as Record<string, unknown>);
              result = String(await tool.handler({ ...args, userId }));
            } catch (e: unknown) {
              result = sanitizeAgentErrorMessage(e instanceof Error ? e.message : String(e));
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.name,
            content: result,
          });
        }
        continue;
      }

      const final = text || "I could not generate a reply. Try rephrasing or open **Chat** for operational help.";
      db.saveMessage(userId, "assistant", final, null, sessionId);
      emitAgentWs(wsReply, "text", { text: final });
      clearTimeout(globalTimeout);
      emitAgentWs(wsReply, "typing", { status: false });
      return final;
    }

    const fallback = "I need to stop here—try a shorter question or use **Chat** for deeper operational analysis.";
    db.saveMessage(userId, "assistant", fallback, null, sessionId);
    emitAgentWs(wsReply, "text", { text: fallback });
    clearTimeout(globalTimeout);
    emitAgentWs(wsReply, "typing", { status: false });
    return fallback;
  } catch (err: unknown) {
    clearTimeout(globalTimeout);
    emitAgentWs(wsReply, "typing", { status: false });
    const msg = sanitizeAgentErrorMessage(err instanceof Error ? err.message : String(err));
    emitAgentWs(wsReply, "error", { message: msg });
    db.saveMessage(userId, "assistant", `[Error] ${msg}`, null, sessionId);
    return `Error: ${msg}`;
  }
}
