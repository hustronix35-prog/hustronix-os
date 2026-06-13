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
  if (/No LLM API keys configured/i.test(s)) {
    return "No LLM API keys are configured on the server. Add ANTHROPIC_API_KEY (recommended) and/or OPENAI_API_KEY to the repo-root `.env`, match ACTIVE_PROVIDER to the key you use, then restart the API.";
  }
  if (/All LLM providers failed/i.test(s)) {
    const low = s.toLowerCase();
    if (/fetch failed|econnrefused|econnreset|enotfound|socket hang up|network|timed out|timeout/i.test(low)) {
      return "The assistant could not reach the LLM over the network (TLS/connectivity). Confirm this machine can reach api.anthropic.com / api.openai.com, check VPN or proxy, and retry.";
    }
    if (/429|rate.?limit|too many requests/i.test(low)) {
      return "The LLM provider rate-limited the request. Wait briefly and retry, or reduce concurrent chats.";
    }
    if (/credit|billing|insufficient_quota|payment/i.test(low)) {
      return "The LLM provider rejected the request for billing or quota reasons. Check your Anthropic/OpenAI account balance and plan.";
    }
    if (/404|not_found|model_not_found|invalid_model|does not exist/i.test(low)) {
      return "The configured model ID was rejected by the provider (unknown or retired). Check ANTHROPIC_MODEL_PREMIUM / ANTHROPIC_MODEL_FAST / OPENAI_CHAT_MODEL in `.env` and restart the API.";
    }
    return "Every configured LLM call failed after retries. Your HTTP API is running, but chat needs a working provider: verify ANTHROPIC_API_KEY or OPENAI_API_KEY in repo-root `.env`, ACTIVE_PROVIDER, then restart the API and read the server log line after \"All LLM providers failed\" for the underlying reason.";
  }
  if (/no output for \d+ms|stream exceeded|stream stalled|timeout after \d+ms/i.test(s)) {
    return "The model stopped mid-reply (timeout or stall). If you already see text above, it was kept — try a shorter question or increase LLM_STREAM_IDLE_MS / LLM_STREAM_MAX_MS in the server .env.";
  }

  if (s.length > 600) s = `${s.slice(0, 600)}…`;
  return s;
}
