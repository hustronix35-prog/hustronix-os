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

const llmCostSaver =
  process.env.LLM_COST_SAVER === "1" || process.env.LLM_COST_SAVER?.trim().toLowerCase() === "true";

/** Premium Anthropic model (coordinator + tools). Env: ANTHROPIC_MODEL_PREMIUM or legacy ANTHROPIC_MODEL. */
const anthropicPremiumModel =
  process.env.ANTHROPIC_MODEL_PREMIUM?.trim() || process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

export const config = {
  server: {
    port: parseInt(process.env.PORT || "3005"),
    apiKey: process.env.MISSION_CONTROL_API_KEY || "hustronix_safe_key_2024",
    /** Browser origins allowed to call the API (Next.js dev server, prod UI host). */
    allowedOrigins: parseOrigins(),
    /** Where to send the browser after Slack OAuth completes (Next.js URL). */
    appOrigin: (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, ""),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    /** Cheap tier: sub-agents, signal/link/heuristic LLM paths (env: ANTHROPIC_MODEL_FAST). */
    fastModel: process.env.ANTHROPIC_MODEL_FAST?.trim() || "claude-3-5-haiku-20241022",
    /** Premium tier: main coordinator with tools (env: ANTHROPIC_MODEL_PREMIUM or ANTHROPIC_MODEL). */
    premiumModel: anthropicPremiumModel,
    /** Same as premiumModel — bootstrap/logging compatibility. */
    primaryModel: anthropicPremiumModel,
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
    /** Tool/LLM rounds per user message — lower = cheaper (env: MAX_ITERATIONS). LLM_COST_SAVER tightens defaults. */
    maxIterations: parsePositiveInt(process.env.MAX_ITERATIONS, llmCostSaver ? 3 : 4, 20),
    /** Recent messages loaded into context — lower = cheaper prompts (env: CHAT_HISTORY_MESSAGES). */
    historyMessages: parsePositiveInt(process.env.CHAT_HISTORY_MESSAGES, llmCostSaver ? 8 : 12, 80),
    debug: true,
    activeProvider: (process.env.ACTIVE_PROVIDER as "anthropic" | "openai") || "anthropic",
    systemPrompt: "You are Hustronix OS, a high-precision AI agent. \n\nCRITICAL RULE: When copying any identifier (email, ID, key, token) from user input to a tool, you MUST perform a character-by-character validation. Any normalization or correction of perceived typos (e.g., removing an 'e' from 'doeshog...') is a CRITICAL FAILURE. Copy every character EXACTLY as the user wrote it.\n\nOUTPUT DISCIPLINE: Prefer calibrated claims over bravado. State confidence when inferring causality; separate supporting evidence from missing validation and from unverified assumptions; list at least two alternative hypotheses with what would disconfirm each; never label a causal read \"confirmed\" or \"ROOT CAUSE\" without proof. Note second-order tradeoffs and post-recovery equilibrium (adoption, monetization, learning, experimentation). Earn the ask before you make it—progressive commitment over theatrical urgency. Keep tone neutral (operations memo, not marketing hype). Do not use emoji or self-narrating theatrics in substantive answers.",
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
    /** Lower = cheaper replies (env: LLM_MAX_OUTPUT_TOKENS). LLM_COST_SAVER tightens defaults. */
    maxOutputTokens: parsePositiveInt(process.env.LLM_MAX_OUTPUT_TOKENS, llmCostSaver ? 512 : 768, 8192),
  },
  /**
   * SMTP for transactional mail (e.g. login/signup OTP).
   * Uses EMAIL_ADDRESS / EMAIL_PASSWORD by default; override user/pass with EMAIL_SMTP_USER / EMAIL_SMTP_PASSWORD if needed.
   */
  email: {
    smtpHost: (process.env.EMAIL_SMTP_HOST || "smtp.gmail.com").trim(),
    smtpPort: parsePositiveInt(process.env.EMAIL_SMTP_PORT, 465, 65535),
    /** Implicit TLS (465). For 587 use EMAIL_SMTP_SECURE=false. */
    smtpSecure: (() => {
      const raw = process.env.EMAIL_SMTP_SECURE?.trim().toLowerCase();
      if (raw === "true") return true;
      if (raw === "false") return false;
      return parsePositiveInt(process.env.EMAIL_SMTP_PORT, 465, 65535) === 465;
    })(),
    smtpUser: (process.env.EMAIL_SMTP_USER || process.env.EMAIL_ADDRESS || "").trim(),
    smtpPass: (process.env.EMAIL_SMTP_PASSWORD || process.env.EMAIL_PASSWORD || "").trim(),
    fromAddress: (process.env.EMAIL_FROM || process.env.EMAIL_ADDRESS || "").trim(),
    otpTtlMinutes: parsePositiveInt(process.env.EMAIL_OTP_TTL_MINUTES, 10, 60),
    otpMaxAttempts: parsePositiveInt(process.env.EMAIL_OTP_MAX_ATTEMPTS, 5, 20),
  },
};

if (config.llm.streamMaxMs > config.agent.globalTimeoutMs) {
  console.warn(
    `⚠️ LLM_STREAM_MAX_MS (${config.llm.streamMaxMs}) exceeds AGENT_GLOBAL_TIMEOUT_MS (${config.agent.globalTimeoutMs}) — multi-step agent turns may hit the global cap.`,
  );
}

// Validate critical secrets (avoid duplicate noise when only one provider is used)
if (!config.anthropic.apiKey) console.warn("⚠️ Warning: ANTHROPIC_API_KEY missing. Please add it to your .env.");
if (!config.openai.apiKey && config.agent.activeProvider === "openai") {
  console.warn("⚠️ Warning: OPENAI_API_KEY missing (ACTIVE_PROVIDER=openai). Please add it to your .env.");
}
