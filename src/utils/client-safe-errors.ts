/**
 * Strip secrets from strings before returning them to WebSocket / HTTP clients.
 */

export function sanitizeAgentErrorMessage(raw: unknown): string {
  let s = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw ?? "Unknown error");

  s = s.replace(/\bsk-ant-api\d+-[a-zA-Z0-9_-]+\b/gi, "[API key redacted]");
  s = s.replace(/\bsk-[a-zA-Z0-9_-]{16,}\b/g, "[API key redacted]");
  s = s.replace(/\bBearer\s+[a-zA-Z0-9._-]+\b/gi, "Bearer [redacted]");
  s = s.replace(/\bx-api-key:\s*[^\s]+\b/gi, "x-api-key: [redacted]");
  s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[AWS key redacted]");
  s = s.replace(/:\s*rk_live_[a-zA-Z0-9]+\b/gi, ": [stripe secret redacted]");

  if (/401|incorrect api key|invalid api key|authentication/i.test(s)) {
    return "LLM authentication failed (invalid or missing API key). Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY in the server .env and restart the backend.";
  }
  if (/anthropic api key missing/i.test(s)) {
    return "Anthropic API key is not configured. Set ANTHROPIC_API_KEY in the server .env or store a key for your account.";
  }
  if (/openai api key missing/i.test(s)) {
    return "OpenAI API key is not configured. Set OPENAI_API_KEY in the server .env or store a key for your account.";
  }
  if (/All LLM providers failed/i.test(s)) {
    return "The assistant could not reach any configured LLM. Check ANTHROPIC_API_KEY / OPENAI_API_KEY and ACTIVE_PROVIDER in .env.";
  }
  if (/no output for \d+ms|stream exceeded|stream stalled|timeout after \d+ms/i.test(s)) {
    return "The model stopped mid-reply (timeout or stall). If you already see text above, it was kept — try a shorter question or increase LLM_STREAM_IDLE_MS / LLM_STREAM_MAX_MS in the server .env.";
  }

  if (s.length > 600) s = `${s.slice(0, 600)}…`;
  return s;
}
