import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

const DEFAULT_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "img-src 'self' data:",
  "script-src 'none'",
  "style-src 'none'",
  "connect-src 'self'",
].join("; ");

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Content-Security-Policy", config.server.contentSecurityPolicy || DEFAULT_CSP);

  if (config.server.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  next();
}

export function requireHttpsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!config.server.requireHttps) return next();

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "").toLowerCase();
  if (proto === "https") return next();
  if (req.path === "/api/health") return next();

  return res.status(400).json({ error: "HTTPS is required." });
}
