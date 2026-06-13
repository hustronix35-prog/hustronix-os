import rateLimit from "express-rate-limit";

function principalKey(req: any, fallbackPrefix: string): string {
  const userId = String(req.userId || "").trim();
  if (userId) return `user:${userId}`;
  const apiKey = String(req.headers?.["x-api-key"] || "").slice(0, 16);
  if (apiKey) return `api-key:${apiKey}`;
  return `${fallbackPrefix}:${req.ip || req.socket?.remoteAddress || "unknown"}`;
}

/** Baseline public API protection. Production Redis should replace the default in-memory store. */
export const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Slow down and retry shortly." },
});

/** Strict bucket for credential endpoints (per IP). */
export const authRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: { error: "Too many attempts. Try again later." },
});

/** Public marketing forms (early access, etc.) — per IP. */
export const earlyAccessRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Try again in a few minutes." },
});

/** Public marketing contact form — same bucket as early access. */
export const marketingContactRouteLimiter = earlyAccessRouteLimiter;

export const passwordRouteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password attempts. Try again later." },
});

/** Cost guard for LLM/intelligence endpoints; keying by principal prevents one tenant from burning shared budget. */
export const aiRouteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => principalKey(req, "ip"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AI request budget exceeded. Retry after the reset window." },
});

/** Mutating execution endpoints get a tighter sustained bucket because they alter the source of truth. */
export const mutationRouteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (req) => principalKey(req, "ip"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many write operations. Retry shortly." },
});
