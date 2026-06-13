import dotenv from "dotenv";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  ANTHROPIC_COORDINATOR_DEFAULT_MODEL,
  ANTHROPIC_FAST_DEFAULT_MODEL,
  coerceFastAnthropicModel,
  coercePremiumCoordinatorModel,
} from "./anthropic-model-policy.js";

export {
  ANTHROPIC_COORDINATOR_DEFAULT_MODEL,
  ANTHROPIC_FAST_DEFAULT_MODEL,
} from "./anthropic-model-policy.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 8; i += 1) {
    const pkgPath = resolve(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown };
        if (Array.isArray(pkg.workspaces)) return current;
      } catch {
        /* keep walking */
      }
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return resolve(moduleDir, "..", "..", "..");
}

export const repoRoot = findWorkspaceRoot(moduleDir);
export const apiRoot = resolve(repoRoot, "apps", "api");
export const webRoot = resolve(repoRoot, "apps", "web");
const envPath = resolve(repoRoot, ".env");
const envPathCwd = resolve(process.cwd(), ".env");

dotenv.config({ path: envPath });
if (envPathCwd !== envPath) dotenv.config({ path: envPathCwd });

/**
 * Dev-only: merge `apps/web/.env.local` so API OTP/contact SMTP matches Next without duplicating secrets in root `.env`.
 * In production (`NODE_ENV=production`) this path is never read — use the host secret store + root `.env` (not committed) or injected env only.
 */
const uiEnvLocal = resolve(webRoot, ".env.local");
if (process.env.NODE_ENV !== "production" && existsSync(uiEnvLocal)) {
  /** Do not override: root `.env` must win for API secrets (e.g. GOOGLE_*); UI file fills missing SMTP/contact keys only. */
  dotenv.config({ path: uiEnvLocal, override: false });
}

/** Repo `.env` PORT wins over a stray shell PORT and over anything in UI `.env.local` (aligns Next rewrite default 3005). */
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

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

/** Positive int from env with fallback; optional max clamp. */
function parsePositiveInt(envVal: string | undefined, defaultVal: number, max?: number): number {
  const n = parseInt(String(envVal ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  if (max !== undefined && n > max) return max;
  return n;
}

function firstTrimmedEnv(...keys: (string | undefined)[]): string {
  for (const k of keys) {
    const s = String(k ?? "").trim();
    if (s) return s;
  }
  return "";
}

/** Tighter prompts + caps + shorter completions. Opt out with LLM_COST_SAVER=0|false|off. */
const llmCostSaverRaw = process.env.LLM_COST_SAVER?.trim().toLowerCase();
const llmCostSaver =
  llmCostSaverRaw !== "0" && llmCostSaverRaw !== "false" && llmCostSaverRaw !== "off";

/** Premium Anthropic model (coordinator). Retired snapshot ids redirect to the active default Sonnet. */
const anthropicPremiumEnv =
  process.env.ANTHROPIC_MODEL_PREMIUM?.trim() || process.env.ANTHROPIC_MODEL?.trim() || "";
const anthropicPremiumModel = anthropicPremiumEnv
  ? coercePremiumCoordinatorModel(anthropicPremiumEnv)
  : ANTHROPIC_COORDINATOR_DEFAULT_MODEL;

export const config = {
  paths: {
    repoRoot,
    apiRoot,
    webRoot,
    workspaceDir: resolve(repoRoot, "workspace"),
  },
  server: {
    nodeEnv,
    isProduction,
    port: parseInt(process.env.PORT || "3005"),
    apiKey: (process.env.MISSION_CONTROL_API_KEY || "").trim(),
    /**
     * Local automation only. When false (default), loopback requests without a session are rejected.
     * Set ALLOW_LOOPBACK_AUTH=1 for trusted local scripts using x-api-key + x-user-id.
     */
    allowLoopbackAuth:
      !isProduction &&
      ["1", "true", "on", "yes"].includes(
        (process.env.ALLOW_LOOPBACK_AUTH || "").trim().toLowerCase(),
      ),
    /** When loopback auth is on, x-api-key alone may resolve to the `system` principal (automation). */
    allowApiKeySystemPrincipal:
      !isProduction &&
      ["1", "true", "on", "yes"].includes(
        (process.env.ALLOW_API_KEY_SYSTEM_PRINCIPAL || "").trim().toLowerCase(),
      ),
    /** Legacy cookie path; disabled in production. */
    allowLegacyUidCookie:
      !isProduction &&
      (process.env.ALLOW_LEGACY_UID_COOKIE || "0").trim().toLowerCase() !== "0",
    /** WebSocket `?session=` token; disabled in production (use cookies). */
    allowWsSessionQuery:
      !isProduction &&
      ["1", "true", "on", "yes"].includes(
        (process.env.ALLOW_WS_SESSION_QUERY || "").trim().toLowerCase(),
      ),
    /** Browser origins allowed to call the API (Next.js dev server, prod UI host). */
    allowedOrigins: parseOrigins(),
    requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "1mb",
    maxConcurrentSessions: parsePositiveInt(process.env.MAX_CONCURRENT_SESSIONS, 10, 100),
    requireHttps:
      (process.env.REQUIRE_HTTPS || (isProduction ? "true" : "false")).trim().toLowerCase() === "true",
    contentSecurityPolicy: process.env.CONTENT_SECURITY_POLICY || "",
    ledgerSigningKey: firstTrimmedEnv(process.env.LEDGER_SIGNING_KEY) || "",
    /** Where to send the browser after Slack OAuth completes (Next.js URL). */
    appOrigin: (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, ""),
    /**
     * AES-256-GCM key material for encrypting TOTP secrets at rest (scrypt-derived in code).
     * Required to enable / verify app-based 2FA. Use a long random string (32+ chars).
     */
    totpEncryptionKey: firstTrimmedEnv(process.env.TOTP_ENCRYPTION_KEY) || "",
    /** Browser must complete TOTP within this window after password (+ email OTP if used). */
    totpLoginPendingMinutes: parsePositiveInt(process.env.TOTP_LOGIN_PENDING_MINUTES, 5, 30),
    totpLoginMaxAttempts: parsePositiveInt(process.env.TOTP_LOGIN_MAX_ATTEMPTS, 8, 20),
    /** One-time backup codes issued when 2FA is confirmed. */
    totpBackupCodeCount: parsePositiveInt(process.env.TOTP_BACKUP_CODE_COUNT, 10, 20),
    /** Issuer label inside authenticator apps (otpauth URI). */
    totpIssuer: firstTrimmedEnv(process.env.TOTP_ISSUER) || "Hustronix",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    /** Cheap tier: sub-agents, intelligence (env: ANTHROPIC_MODEL_FAST). Non-Haiku ids coerced to Haiku default. */
    fastModel: process.env.ANTHROPIC_MODEL_FAST?.trim()
      ? coerceFastAnthropicModel(process.env.ANTHROPIC_MODEL_FAST)
      : ANTHROPIC_FAST_DEFAULT_MODEL,
    /** Premium tier: main coordinator with tools (env: ANTHROPIC_MODEL_PREMIUM or ANTHROPIC_MODEL). */
    premiumModel: anthropicPremiumModel,
    /** Same as premiumModel — bootstrap/logging compatibility. */
    primaryModel: anthropicPremiumModel,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    llmModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
  },
  storage: {
    dbPath: firstTrimmedEnv(process.env.SQLITE_PATH, "./data/hustronix.db"),
    databaseType: (process.env.DATABASE_TYPE || "sqlite").trim().toLowerCase(),
    databaseUrl: firstTrimmedEnv(process.env.DATABASE_URL, process.env.POSTGRES_URL),
  },
  agent: {
    /** Cost-focused caps unless LLM_COST_SAVER=0|false|off (default: on). */
    costSaverEnabled: llmCostSaver,
    /** Tool/LLM rounds per user message — lower = cheaper (env: MAX_ITERATIONS). Cost-saver mode tightens defaults. */
    maxIterations: parsePositiveInt(process.env.MAX_ITERATIONS, llmCostSaver ? 3 : 4, 20),
    /** Recent messages loaded into context — lower = cheaper prompts (env: CHAT_HISTORY_MESSAGES). Cost-saver tightens. */
    historyMessages: parsePositiveInt(process.env.CHAT_HISTORY_MESSAGES, llmCostSaver ? 8 : 12, 80),
    /** Max characters per chat history message body in coordinator context (env: CHAT_MESSAGE_CHAR_CAP). */
    chatMessageCharCap: parsePositiveInt(process.env.CHAT_MESSAGE_CHAR_CAP, llmCostSaver ? 1200 : 1600, 32000),
    /** Signals rows fetched for decision context (env: DECISION_CONTEXT_SIGNAL_LIMIT). */
    decisionContextSignalLimit: parsePositiveInt(process.env.DECISION_CONTEXT_SIGNAL_LIMIT, llmCostSaver ? 6 : 8, 24),
    decisionContextMaxExecutions: parsePositiveInt(
      process.env.DECISION_CONTEXT_MAX_EXECUTIONS,
      llmCostSaver ? 6 : 10,
      50,
    ),
    decisionContextMaxSignalsInPrompt: parsePositiveInt(
      process.env.DECISION_CONTEXT_MAX_SIGNALS,
      llmCostSaver ? 4 : 6,
      16,
    ),
    decisionContextMaxVowChars: parsePositiveInt(
      process.env.DECISION_CONTEXT_MAX_VOW_CHARS,
      llmCostSaver ? 360 : 480,
      4000,
    ),
    decisionContextMaxOutcomesChars: parsePositiveInt(
      process.env.DECISION_CONTEXT_MAX_OUTCOMES_CHARS,
      llmCostSaver ? 400 : 560,
      8000,
    ),
    decisionContextSignalContentChars: parsePositiveInt(
      process.env.DECISION_CONTEXT_SIGNAL_SNIPPET_CHARS,
      llmCostSaver ? 100 : 120,
      500,
    ),
    /** Cap JSON.stringify length for supervisor **Context** blobs (usage, pending, audit, world model). */
    /** Onboarding / company context injected into Chat system prompt (env: ORG_CONTEXT_PROMPT_MAX_CHARS). */
    orgContextPromptMaxChars: parsePositiveInt(
      process.env.ORG_CONTEXT_PROMPT_MAX_CHARS,
      llmCostSaver ? 2800 : 4000,
      12000,
    ),
    supervisorJsonBlobMaxChars: parsePositiveInt(
      process.env.SUPERVISOR_JSON_BLOB_MAX_CHARS,
      llmCostSaver ? 550 : 850,
      32000,
    ),
    supervisorRecentAuditOutcomes: parsePositiveInt(
      process.env.SUPERVISOR_RECENT_OUTCOMES,
      llmCostSaver ? 3 : 4,
      20,
    ),
    coordinatorToolResultMaxChars: parsePositiveInt(
      process.env.COORDINATOR_TOOL_RESULT_MAX_CHARS,
      llmCostSaver ? 2200 : 3000,
      32000,
    ),
    subAgentToolResultMaxChars: parsePositiveInt(
      process.env.SUB_AGENT_TOOL_RESULT_MAX_CHARS,
      llmCostSaver ? 1800 : 2400,
      32000,
    ),
    /**
     * After tool results return, coordinator trims this assistant message **in memory only** (next LLM iteration).
     * Full text stays in DB / streamed to UI — caps repeated input tokens from long “IMPACT” prose before more tools.
     */
    coordinatorInflightAssistantAfterToolsCap: parsePositiveInt(
      process.env.COORDINATOR_INFLIGHT_ASSISTANT_AFTER_TOOLS_CAP,
      llmCostSaver ? 900 : 1400,
      32000,
    ),
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
    /** Fast tier / assistant (env: LLM_MAX_OUTPUT_TOKENS). */
    maxOutputTokens: parsePositiveInt(process.env.LLM_MAX_OUTPUT_TOKENS, llmCostSaver ? 1024 : 2048, 8192),
    /** Chat coordinator premium tier — long roadmaps need headroom (env: LLM_MAX_OUTPUT_TOKENS_PREMIUM). */
    maxOutputTokensPremium: parsePositiveInt(
      process.env.LLM_MAX_OUTPUT_TOKENS_PREMIUM,
      llmCostSaver ? 2048 : 4096,
      8192,
    ),
  },
  /**
   * SMTP for transactional mail (login/signup OTP).
   * Uses the same env vars as `apps/web/src/app/api/contact/route.ts`: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS.
   * Fallbacks: EMAIL_* and EMAIL_ADDRESS / EMAIL_PASSWORD for older setups.
   */
  email: {
    smtpHost: firstTrimmedEnv(process.env.SMTP_HOST, process.env.EMAIL_SMTP_HOST) || "smtp.gmail.com",
    smtpPort: parsePositiveInt(process.env.SMTP_PORT || process.env.EMAIL_SMTP_PORT, 587, 65535),
    /**
     * Matches contact route: explicit SMTP_SECURE wins; otherwise implicit TLS only on port 465.
     */
    smtpSecure: (() => {
      const raw = firstTrimmedEnv(process.env.SMTP_SECURE, process.env.EMAIL_SMTP_SECURE).toLowerCase();
      if (raw === "true" || raw === "1") return true;
      if (raw === "false" || raw === "0") return false;
      return parsePositiveInt(process.env.SMTP_PORT || process.env.EMAIL_SMTP_PORT, 587, 65535) === 465;
    })(),
    smtpUser: firstTrimmedEnv(
      process.env.SMTP_USER,
      process.env.EMAIL_SMTP_USER,
      process.env.EMAIL_ADDRESS,
    ),
    smtpPass: firstTrimmedEnv(
      process.env.SMTP_PASS,
      process.env.EMAIL_SMTP_PASSWORD,
      process.env.EMAIL_PASSWORD,
    ),
    /** Envelope From for OTP (Gmail usually requires this to match SMTP_USER). */
    fromAddress: firstTrimmedEnv(
      process.env.OTP_FROM,
      process.env.EMAIL_FROM,
      process.env.SMTP_USER,
      process.env.CONTACT_FROM,
      process.env.EMAIL_ADDRESS,
    ),
    /** Same display name pattern as the marketing contact form. */
    fromDisplayName: firstTrimmedEnv(process.env.OTP_FROM_NAME, process.env.SMTP_FROM_NAME) || "Hustronix",
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

if (config.server.isProduction) {
  if (!config.server.apiKey || config.server.apiKey.length < 24) {
    throw new Error(
      "MISSION_CONTROL_API_KEY must be set to a long random secret (24+ chars) before running with NODE_ENV=production.",
    );
  }
  if (config.server.allowedOrigins.length === 0) {
    throw new Error("ALLOWED_ORIGINS must contain at least one exact browser origin in production.");
  }
  if (config.server.allowedOrigins.some((origin) => origin === "*" || origin.includes("*"))) {
    throw new Error("Wildcard ALLOWED_ORIGINS are forbidden in production when credentials are enabled.");
  }
  if (!config.server.totpEncryptionKey || config.server.totpEncryptionKey.length < 32) {
    console.warn("⚠️ TOTP_ENCRYPTION_KEY should be a 32+ character random secret in production.");
  }
  /**
   * Soft-warn (not fatal) for OAuth + webhook prerequisites. Hard-failing would
   * keep the decision-ledger from booting even when a tenant doesn't intend to
   * connect any external integrations yet. Operators see the warning in logs
   * and the boot-time integration banner (see `logIntegrationConfigSummary`).
   */
  if (!process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim()) {
    console.warn(
      "⚠️ OAUTH_TOKEN_ENCRYPTION_KEY is unset — all integration OAuth flows will be disabled. " +
        "Set a 64-hex (32-byte) secret in your secret store to enable Slack/GitHub/Google/Microsoft/Notion/Jira/Linear.",
    );
  }
  if (!process.env.APP_ORIGIN?.trim() && !process.env.WEBHOOK_PUBLIC_BASE_URL?.trim()) {
    console.warn(
      "⚠️ Neither APP_ORIGIN nor WEBHOOK_PUBLIC_BASE_URL is set. Inbound webhooks (GitHub, Microsoft Graph, Linear, Jira, Google Calendar) cannot register a callback URL.",
    );
  }
  if (config.storage.databaseType !== "postgres") {
    console.warn("⚠️ Production should use DATABASE_TYPE=postgres after running npm run db:pg:migrate.");
  }
  if (config.storage.databaseType === "postgres" && !config.storage.databaseUrl) {
    throw new Error("DATABASE_URL is required when DATABASE_TYPE=postgres.");
  }
}
