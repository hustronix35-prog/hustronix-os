import dotenv from "dotenv";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/** Resolve `.env` from repo root (next to `package.json`), not `process.cwd()` — scripts may start from `dist/` or another folder. */
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..");
const envPath = resolve(repoRoot, ".env");
const envPathCwd = resolve(process.cwd(), ".env");

dotenv.config({ path: envPath });
if (envPathCwd !== envPath) dotenv.config({ path: envPathCwd });

/** Repo `.env` PORT wins over a stray shell PORT (aligns Next rewrite default 3005). */
if (existsSync(envPath)) {
  try {
    const parsed = dotenv.parse(readFileSync(envPath));
    const p = parsed.PORT?.trim();
    if (p) process.env.PORT = p;
  } catch {
    /* ignore */
  }
}

/**
 * Hustronix OS Configuration
 * Lean, secure, and fully understood.
 */
const parseOrigins = () => {
  const raw = process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Positive int from env with fallback; optional max clamp. */
function parsePositiveInt(envVal: string | undefined, defaultVal: number, max?: number): number {
  const n = parseInt(String(envVal ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  if (max !== undefined && n > max) return max;
  return n;
}

export const config = {
  server: {
    port: parseInt(process.env.PORT || "3005"),
    apiKey: process.env.MISSION_CONTROL_API_KEY || "hustronix_safe_key_2024",
    /** Browser origins allowed to call the API (Next.js dev server, prod UI host). */
    allowedOrigins: parseOrigins(),
    /** Where to send the browser after Slack OAuth completes (Next.js URL). */
    appOrigin: (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, ""),
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    whitelist: (process.env.ALLOWED_USER_IDS || "7947808911")
      .split(",")
      .map(id => id.trim())
      .filter(id => id.length > 0),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    /** Env overrides SQLite `anthropicModel`. Use Haiku for cheaper chat: `claude-3-5-haiku-20241022`. */
    primaryModel: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    llmModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o",
    embeddingModel: "text-embedding-3-small",
  },
  storage: {
    dbPath: "./data/hustronix.db",
  },
  agent: {
    /** Tool/LLM rounds per user message — lower = faster (env: MAX_ITERATIONS). */
    maxIterations: parsePositiveInt(process.env.MAX_ITERATIONS, 6, 20),
    /** Recent messages loaded into context — lower = faster prompts (env: CHAT_HISTORY_MESSAGES). */
    historyMessages: parsePositiveInt(process.env.CHAT_HISTORY_MESSAGES, 25, 80),
    debug: true,
    activeProvider: (process.env.ACTIVE_PROVIDER as "anthropic" | "openai") || "anthropic",
    systemPrompt: "You are Hustronix OS, a high-precision AI agent. \n\nCRITICAL RULE: When copying any identifier (email, ID, key, token) from user input to a tool, you MUST perform a character-by-character validation. Any normalization or correction of perceived typos (e.g., removing an 'e' from 'doeshog...') is a CRITICAL FAILURE. Copy every character EXACTLY as the user wrote it.",
    /**
     * Wall-clock cap for full coordinator loop (LLM + tools, multiple iterations).
     * Must exceed one stream’s LLM_STREAM_MAX_MS or multi-step turns abort early (env: AGENT_GLOBAL_TIMEOUT_MS).
     */
    globalTimeoutMs: parsePositiveInt(process.env.AGENT_GLOBAL_TIMEOUT_MS, 360_000, 900_000),
  },
  llm: {
    /**
     * Legacy single-call ceiling (ms). Used only for non-streaming paths; streaming uses idle + max below.
     * @deprecated Prefer LLM_STREAM_IDLE_MS + LLM_STREAM_MAX_MS
     */
    chatTimeoutMs: parsePositiveInt(process.env.LLM_CHAT_TIMEOUT_MS, 180_000, 600_000),
    /** Reset while tokens arrive — avoids killing long streams that are still producing output (env: LLM_STREAM_IDLE_MS). */
    streamIdleTimeoutMs: parsePositiveInt(process.env.LLM_STREAM_IDLE_MS, 90_000, 300_000),
    /** Hard cap for one streamed completion — cost + hang guard (env: LLM_STREAM_MAX_MS). */
    streamMaxMs: parsePositiveInt(process.env.LLM_STREAM_MAX_MS, 240_000, 900_000),
    /** Lower = cheaper / faster replies (env: LLM_MAX_OUTPUT_TOKENS). */
    maxOutputTokens: parsePositiveInt(process.env.LLM_MAX_OUTPUT_TOKENS, 1536, 8192),
  },
  email: {
    enabled: true,
    address: process.env.EMAIL_ADDRESS || "",
    password: process.env.EMAIL_PASSWORD || "",
    smtpHost: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
    smtpPort: parseInt(process.env.EMAIL_SMTP_PORT || "465"),
    imapHost: process.env.EMAIL_IMAP_HOST || "imap.gmail.com",
    imapPort: parseInt(process.env.EMAIL_IMAP_PORT || "993"),
  }
};

if (config.llm.streamMaxMs > config.agent.globalTimeoutMs) {
  console.warn(
    `⚠️ LLM_STREAM_MAX_MS (${config.llm.streamMaxMs}) exceeds AGENT_GLOBAL_TIMEOUT_MS (${config.agent.globalTimeoutMs}) — multi-step agent turns may hit the global cap.`,
  );
}

// Validate critical secrets
if (!config.telegram.token) console.error("❌ CRITICAL: TELEGRAM_BOT_TOKEN missing in .env");
if (!config.anthropic.apiKey) console.warn("⚠️ Warning: ANTHROPIC_API_KEY missing. Please add it to your .env.");
if (!config.openai.apiKey) console.warn("⚠️ Warning: OPENAI_API_KEY missing. Please add it to your .env.");
