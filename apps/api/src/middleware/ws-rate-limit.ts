type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function windowMs(): number {
  const raw = Number(process.env.WS_RATE_LIMIT_WINDOW_MS ?? 60_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
}

function limitFor(action: "text" | "commit_decision"): number {
  const envKey = action === "text" ? "WS_TEXT_RATE_LIMIT" : "WS_COMMIT_RATE_LIMIT";
  const fallback = action === "text" ? 40 : 12;
  const raw = Number(process.env[envKey] ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function checkWsRateLimit(
  userId: string,
  action: "text" | "commit_decision",
): { allowed: boolean; retryAfterMs?: number } {
  const key = `${action}:${userId}`;
  const now = Date.now();
  const win = windowMs();
  const max = limitFor(action);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + win };
    buckets.set(key, bucket);
  }
  if (bucket.count >= max) {
    return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
  }
  bucket.count += 1;
  return { allowed: true };
}
