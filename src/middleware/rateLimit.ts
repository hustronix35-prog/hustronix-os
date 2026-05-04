import rateLimit from "express-rate-limit";

/** Strict bucket for credential endpoints (per IP). */
export const authRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

export const passwordRouteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password attempts. Try again later." },
});
