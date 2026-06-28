import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

function principalKey(req: { userId?: string; headers?: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } }, fallbackPrefix: string): string {
  const userId = String(req.userId || "").trim();
  if (userId) return `user:${userId}`;
  const apiKey = String(req.headers?.["x-api-key"] || "").slice(0, 16);
  if (apiKey) return `api-key:${apiKey}`;
  return `${fallbackPrefix}:${req.ip || req.socket?.remoteAddress || "unknown"}`;
}

function createRedisStore(): NonNullable<Options["store"]> | undefined {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return undefined;
  try {
    const { RedisStore } = require("rate-limit-redis");
    const { createClient } = require("redis");
    const client = createClient({ url });
    client.connect().catch((err: Error) => {
      console.warn("[rateLimit] Redis connect failed — using in-memory store:", err.message);
    });
    return new RedisStore({
      sendCommand: (...args: string[]) => client.sendCommand(args),
    }) as Options["store"];
  } catch (err) {
    console.warn(
      "[rateLimit] Redis store unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }
}

const redisStore = createRedisStore();

function baseOptions(extra: Partial<Options> = {}): Partial<Options> {
  const opts: Partial<Options> = {
    standardHeaders: true,
    legacyHeaders: false,
    ...extra,
  };
  if (redisStore) opts.store = redisStore;
  return opts;
}

/** Baseline public API protection. Uses Redis when REDIS_URL is set. */
export const globalApiLimiter = rateLimit({
  ...baseOptions(),
  windowMs: 60 * 1000,
  limit: 600,
  message: { error: "Too many requests. Slow down and retry shortly." },
});

/** Strict bucket for credential endpoints (per IP). */
export const authRouteLimiter = rateLimit({
  ...baseOptions(),
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: false,
  message: { error: "Too many attempts. Try again later." },
});

/** Public marketing forms (early access, etc.) — per IP. */
export const earlyAccessRouteLimiter = rateLimit({
  ...baseOptions(),
  windowMs: 15 * 60 * 1000,
  limit: 12,
  message: { error: "Too many submissions. Try again in a few minutes." },
});

/** Public marketing contact form — same bucket as early access. */
export const marketingContactRouteLimiter = earlyAccessRouteLimiter;

export const passwordRouteLimiter = rateLimit({
  ...baseOptions(),
  windowMs: 60 * 60 * 1000,
  limit: 25,
  message: { error: "Too many password attempts. Try again later." },
});

/** Cost guard for LLM/intelligence endpoints; keying by principal prevents one tenant from burning shared budget. */
export const aiRouteLimiter = rateLimit({
  ...baseOptions({ keyGenerator: (req: Request) => principalKey(req as any, "ip") }),
  windowMs: 60 * 1000,
  limit: 30,
  message: { error: "AI request budget exceeded. Retry after the reset window." },
});

/** Mutating execution endpoints get a tighter sustained bucket because they alter the source of truth. */
export const mutationRouteLimiter = rateLimit({
  ...baseOptions({ keyGenerator: (req: Request) => principalKey(req as any, "ip") }),
  windowMs: 60 * 1000,
  limit: 120,
  message: { error: "Too many write operations. Retry shortly." },
});
