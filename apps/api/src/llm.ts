import Anthropic from "@anthropic-ai/sdk";
import { OpenAI } from "openai";
import {
  ANTHROPIC_COORDINATOR_DEFAULT_MODEL,
  ANTHROPIC_FAST_DEFAULT_MODEL,
  coerceFastAnthropicModel,
  coercePremiumCoordinatorModel,
} from "./anthropic-model-policy.js";
import { config } from "./config.js";
import { db } from "./database.js";

console.log("🛠️ [SYSTEM] LLM Module Loaded (Hardened V2.3 - 2026 Compatibility Layer)");

/** If the primary model fails (404 / retired id), try Haiku — cheaper than repeating Sonnet calls. */
const ANTHROPIC_MODEL_FALLBACKS = [ANTHROPIC_FAST_DEFAULT_MODEL];

function anthropicEcoCoordinatorEnabled(): boolean {
  const v = process.env.LLM_COORDINATOR_HAIKU?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
/** Prefer cheaper mini model on fallback before older GPT-4 tiers. */
const OPENAI_MODEL_FALLBACKS = ["gpt-4o-mini", "gpt-4o"];

/** Env keys (`.env`) override per-user SQLite keys so server restarts pick up new secrets. */
function resolveAnthropicApiKey(userId: string): string | null {
  const env = config.anthropic?.apiKey?.trim();
  if (env) return env;
  const k = db.getUserKey(userId, "anthropic");
  return k ? String(k).trim() || null : null;
}

function resolveOpenaiApiKey(userId: string): string | null {
  const env = config.openai?.apiKey?.trim();
  if (env) return env;
  const k = db.getUserKey(userId, "openai");
  return k ? String(k).trim() || null : null;
}

function resolvePrimaryProvider(userId: string): "anthropic" | "openai" {
  const ep = process.env.ACTIVE_PROVIDER?.trim().toLowerCase();
  if (ep === "openai" || ep === "anthropic") return ep;
  const cfg = config.agent.activeProvider;
  if (cfg === "openai" || cfg === "anthropic") return cfg;
  const dbp = db.getSetting(userId, "activeProvider")?.trim().toLowerCase();
  if (dbp === "openai" || dbp === "anthropic") return dbp as "openai" | "anthropic";
  return "anthropic";
}

/** Returns true if at least one provider has credentials (env or SQLite). */
export function hasLlmCredentials(userId: string): boolean {
  return !!(resolveAnthropicApiKey(userId) || resolveOpenaiApiKey(userId));
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: any[];
}

function safeParseToolInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function toolArgumentsToInput(tc: any): Record<string, unknown> {
  const raw = tc.arguments ?? tc.function?.arguments ?? tc.input;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") return safeParseToolInput(raw);
  return {};
}

function resolveAnthropicPremiumModelForUser(userId: string): string {
  const antConfig = config.anthropic || {};
  const envPremium = process.env.ANTHROPIC_MODEL_PREMIUM?.trim();
  const envLegacy = process.env.ANTHROPIC_MODEL?.trim();
  if (envPremium) return coercePremiumCoordinatorModel(envPremium);
  if (envLegacy) return coercePremiumCoordinatorModel(envLegacy);

  const dbRaw = db.getSetting(userId, "anthropicModel")?.trim();
  if (dbRaw) return coercePremiumCoordinatorModel(dbRaw);

  return coercePremiumCoordinatorModel(
    antConfig.premiumModel || antConfig.primaryModel || ANTHROPIC_COORDINATOR_DEFAULT_MODEL,
  );
}

function isLikelyModelOrNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const s = `${msg} ${(err as any)?.status ?? ""} ${(err as any)?.error?.error?.type ?? ""}`;
  return (
    /\b404\b|\bnot_found\b|model_not_found|invalid_model|does not exist|not support/i.test(s) ||
    ((err as any)?.status === 404)
  );
}

/** Anthropic routing: cheap Haiku-class vs coordinator Sonnet-class (ignored for OpenAI for now). */
export type ModelTier = "fast" | "premium";

export type ChatOptions = {
  /** When aborted, `chat` rejects with Error("Aborted"). */
  abortSignal?: AbortSignal;
  /** Default `premium` when omitted — safer for unknown callers; batched agents should pass `fast`. */
  modelTier?: ModelTier;
};

export type LlmChatResult = {
  text: string;
  toolCalls?: { id: string; name: string; input?: unknown; arguments: string }[];
  /** Anthropic: `max_tokens` | `end_turn`. OpenAI: `length` | `stop`. */
  stopReason?: string;
};

function resolveMaxOutputTokens(tier?: ModelTier): number {
  return tier === "premium" ? config.llm.maxOutputTokensPremium : config.llm.maxOutputTokens;
}

export async function chat(
  userId: string,
  messages: Message[],
  tools: any[] = [],
  onChunk?: (chunk: string) => void,
  options?: ChatOptions,
) {
  const primaryProvider = resolvePrimaryProvider(userId);
  const hasAnthropic = !!resolveAnthropicApiKey(userId);
  const hasOpenai = !!resolveOpenaiApiKey(userId);

  const sortedQueue: ("anthropic" | "openai")[] = [];
  const offer = (p: "anthropic" | "openai") => {
    if (p === "anthropic" && hasAnthropic) sortedQueue.push(p);
    if (p === "openai" && hasOpenai) sortedQueue.push(p);
  };
  offer(primaryProvider);
  for (const p of ["anthropic", "openai"] as const) {
    if (p !== primaryProvider) offer(p);
  }

  if (sortedQueue.length === 0) {
    throw new Error(
      "No LLM API keys configured. Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY in the server .env (repo root) and restart.",
    );
  }

  let lastError: unknown = null;

  for (const provider of sortedQueue) {
    try {
      const tierHint =
        provider === "anthropic" && options?.modelTier ? ` tier=${options.modelTier}` : "";
      console.log(`🧠 Attempting reasoning with ${provider}${tierHint}...`);

      /** Agent cancellation — not the same as per-stream idle/max (handled inside providers). */
      const abortSignal = options?.abortSignal;
      const abortPromise =
        abortSignal &&
        new Promise<never>((_, reject) => {
          if (abortSignal.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          abortSignal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
        });

      const chatPromise =
        provider === "anthropic"
          ? chatWithAnthropic(userId, messages, tools, onChunk, options)
          : chatWithOpenAI(userId, messages, tools, onChunk, options);

      const racers: Promise<LlmChatResult>[] = [chatPromise];
      if (abortPromise) racers.push(abortPromise);

      return await Promise.race(racers);
    } catch (err: unknown) {
      lastError = err;
      const m = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${provider} failed: ${m}`);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError || "unknown");
  console.error(`❌ All LLM providers failed for user ${userId}:`, detail);
  throw new Error(`All LLM providers failed. Last error: ${detail}`);
}

async function chatWithAnthropic(
  userId: string,
  messages: Message[],
  tools: any[] = [],
  onChunk?: (chunk: string) => void,
  options?: ChatOptions,
) {
  const antConfig = config.anthropic || {};
  const apiKey = resolveAnthropicApiKey(userId);
  if (!apiKey) throw new Error("Anthropic API key missing");

  const client = new Anthropic({ apiKey });
  const tier = options?.modelTier ?? "premium";
  const fastConfigured = coerceFastAnthropicModel(
    process.env.ANTHROPIC_MODEL_FAST?.trim() || antConfig.fastModel || ANTHROPIC_FAST_DEFAULT_MODEL,
  );
  const premiumConfigured = resolveAnthropicPremiumModelForUser(userId);
  const useHaikuCoordinator = tier === "premium" && anthropicEcoCoordinatorEnabled();
  const configured = tier === "fast" || useHaikuCoordinator ? fastConfigured : premiumConfigured;
  if (useHaikuCoordinator) {
    console.log(`🧠 Anthropic coordinator using fast-tier model (LLM_COORDINATOR_HAIKU): ${configured}`);
  }
  /** Fast tier stays on Haiku-class fallbacks only — never silently upgrade to Sonnet. */
  const modelChain = [...new Set([configured, ...ANTHROPIC_MODEL_FALLBACKS])];
  const systemPrompt = messages.find((m) => m.role === "system")?.content || "You are Hustronix OS.";

  const anthropicMessages: any[] = messages.filter((m) => m.role !== "system").map((m) => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }],
      };
    }
    if (m.role === "assistant" && m.tool_calls) {
      const blocks: any[] = [];
      if (m.content?.trim()) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name || (tc.function ? tc.function.name : "unknown"),
          input: toolArgumentsToInput(tc),
        });
      }
      return { role: "assistant", content: blocks };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });

  const anthropicTools = tools.map((t: any) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters || t.input_schema || { type: "object", properties: {} },
  }));

  let lastModelErr: unknown = null;
  const idleMs = config.llm.streamIdleTimeoutMs;
  const maxMs = config.llm.streamMaxMs;
  const maxTokens = resolveMaxOutputTokens(options?.modelTier);

  for (const modelId of modelChain) {
    try {
      const stream = client.messages.stream({
        model: modelId as string,
        max_tokens: maxTokens,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        system: systemPrompt as string,
      });

      let textContent = "";
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let maxTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (maxTimer) clearTimeout(maxTimer);
      };

      const bumpIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (settled) return;
          try {
            stream.abort();
          } catch {
            /* ignore */
          }
        }, idleMs);
      };

      bumpIdle();
      maxTimer = setTimeout(() => {
        if (settled) return;
        try {
          stream.abort();
        } catch {
          /* ignore */
        }
      }, maxMs);

      /** Tool-use / thinking phases may emit no `text` for a long time — reset idle on any stream activity. */
      stream.on("streamEvent", () => {
        bumpIdle();
      });

      stream.on("text", (text: string) => {
        bumpIdle();
        textContent += text;
        if (onChunk) onChunk(text);
      });

      let finalMsg: Awaited<ReturnType<typeof stream.finalMessage>>;
      try {
        finalMsg = await stream.finalMessage();
      } catch (streamErr) {
        settled = true;
        cleanup();
        if (textContent.trim().length >= 40) {
          console.warn("⚠️ Anthropic stream error after partial output; returning partial text.");
          return { text: textContent, toolCalls: [], stopReason: "stream_error" };
        }
        throw streamErr;
      }
      settled = true;
      cleanup();
      const toolCalls: { id: string; name: string; input: unknown; arguments: string }[] = [];
      for (const block of finalMsg.content) {
        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input,
            arguments: JSON.stringify(block.input ?? {}),
          });
        }
      }

      if (modelId !== configured) {
        console.warn(`✅ Anthropic using fallback model: ${modelId} (configured: ${configured})`);
      }
      if (finalMsg.stop_reason === "max_tokens") {
        console.warn(
          `⚠️ Anthropic hit max_tokens (${maxTokens}) — reply may end mid-section.`,
        );
      }
      return {
        text: textContent,
        toolCalls,
        stopReason: finalMsg.stop_reason ? String(finalMsg.stop_reason) : undefined,
      };
    } catch (err: unknown) {
      lastModelErr = err;
      if (isLikelyModelOrNotFoundError(err) && modelId !== modelChain[modelChain.length - 1]) {
        console.warn(`⚠️ Anthropic model "${modelId}" failed; retrying with fallback…`);
        continue;
      }
      throw err;
    }
  }
  throw lastModelErr instanceof Error ? lastModelErr : new Error(String(lastModelErr));
}

async function chatWithOpenAI(
  userId: string,
  messages: Message[],
  tools: any[] = [],
  onChunk?: (chunk: string) => void,
  options?: ChatOptions,
): Promise<LlmChatResult> {
  const oaiConfig = config.openai || {};
  const apiKey = resolveOpenaiApiKey(userId);
  if (!apiKey) throw new Error("OpenAI API key missing");

  const client = new OpenAI({ apiKey });
  const configured = db.getSetting(userId, "openaiModel") || oaiConfig.llmModel || "gpt-4o-mini";
  const modelChain = [...new Set([configured, ...OPENAI_MODEL_FALLBACKS])];

  const openaiMessages: any[] = messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name || (tc.function ? tc.function.name : "unknown"),
            arguments:
              typeof tc.arguments === "string"
                ? tc.arguments
                : JSON.stringify(tc.arguments ?? tc.function?.arguments ?? {}),
          },
        })),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
    }
    return { role: m.role, content: m.content };
  });

  const openaiTools: any[] = tools.map((t: any) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || t.input_schema || { type: "object", properties: {} },
    },
  }));

  const idleMs = config.llm.streamIdleTimeoutMs;
  const maxMs = config.llm.streamMaxMs;
  const maxTokens = resolveMaxOutputTokens(options?.modelTier);

  let lastModelErr: unknown = null;
  for (const modelId of modelChain) {
    try {
      const stream = await client.chat.completions.create({
        model: modelId as string,
        messages: openaiMessages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        max_tokens: maxTokens,
        stream: true,
      });

      let textContent = "";
      const toolCalls: any[] = [];
      let finishReason: string | undefined;
      let lastActivity = Date.now();
      const started = Date.now();

      let watchdog: ReturnType<typeof setInterval> | undefined;
      let rejectWatchdog: ((e: Error) => void) | undefined;
      const stallPromise = new Promise<never>((_, rej) => {
        rejectWatchdog = rej;
      });

      watchdog = setInterval(() => {
        if (Date.now() - started > maxMs) {
          if (watchdog) clearInterval(watchdog);
          rejectWatchdog?.(new Error(`Stream exceeded ${maxMs}ms`));
        } else if (Date.now() - lastActivity > idleMs) {
          if (watchdog) clearInterval(watchdog);
          rejectWatchdog?.(new Error(`No output for ${idleMs}ms`));
        }
      }, 450);

      try {
        await Promise.race([
          (async () => {
            for await (const chunk of stream) {
              lastActivity = Date.now();
              const choice = chunk.choices[0];
              if (choice?.finish_reason) finishReason = choice.finish_reason;
              const delta = choice?.delta;
              if (delta?.content) {
                textContent += delta.content;
                if (onChunk) onChunk(delta.content);
              }
              if (delta?.tool_calls?.length) {
                lastActivity = Date.now();
                for (const tc of delta.tool_calls) {
                  if (!toolCalls[tc.index])
                    toolCalls[tc.index] = { id: tc.id, name: tc.function?.name, arguments: "" };
                  if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                  if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
                }
              }
            }
          })(),
          stallPromise,
        ]);
      } catch (loopErr: unknown) {
        if (textContent.trim().length >= 40) {
          console.warn("⚠️ OpenAI stream error after partial output; returning partial text.");
          return {
            text: textContent,
            toolCalls: toolCalls
              .filter((tc) => tc.name)
              .map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments || "{}" })),
            stopReason: finishReason ?? "stream_error",
          };
        }
        throw loopErr;
      } finally {
        if (watchdog) clearInterval(watchdog);
      }

      if (modelId !== configured) {
        console.warn(`✅ OpenAI using fallback model: ${modelId} (configured: ${configured})`);
      }
      if (finishReason === "length") {
        console.warn(`⚠️ OpenAI hit max_tokens (${maxTokens}) — reply may end mid-section.`);
      }
      return {
        text: textContent,
        toolCalls: toolCalls
          .filter((tc) => tc.name)
          .map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments || "{}" })),
        stopReason: finishReason,
      };
    } catch (err: unknown) {
      lastModelErr = err;
      if (isLikelyModelOrNotFoundError(err) && modelId !== modelChain[modelChain.length - 1]) {
        console.warn(`⚠️ OpenAI model "${modelId}" failed; retrying with fallback…`);
        continue;
      }
      throw err;
    }
  }
  throw lastModelErr instanceof Error ? lastModelErr : new Error(String(lastModelErr));
}

export async function embedText(userId: string, text: string): Promise<number[]> {
  const oaiConfig = config?.openai || {};
  const apiKey = resolveOpenaiApiKey(userId);
  if (!apiKey) throw new Error("No OpenAI API key found for this user");

  const openai = new OpenAI({ apiKey });
  const response = await openai.embeddings.create({
    model: oaiConfig.embeddingModel || "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}
