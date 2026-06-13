import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_BYPASS_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/otp/request",
  "/api/auth/google/",
  "/api/auth/github/",
  "/api/integrations/slack/events",
  "/api/ingest/github",
  "/api/ingest/jira",
  "/api/ingest/crm",
  "/api/ingest/microsoft",
  "/api/ingest/google",
  "/api/ingest/notion",
  "/api/ingest/linear",
  "/api/oauth/",
  "/api/early-access",
  "/api/contact",
];

function hasBearerOrServiceAuth(req: Request): boolean {
  return Boolean(req.headers.authorization || req.headers["x-api-key"]);
}

function isBypassedPath(path: string): boolean {
  return CSRF_BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function csrfOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (isBypassedPath(req.path)) return next();
  if (hasBearerOrServiceAuth(req)) return next();
  if (!req.cookies?.hustronix_session) return next();

  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  const allowed = new Set(config.server.allowedOrigins);

  if (origin && allowed.has(origin)) return next();
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (allowed.has(refOrigin)) return next();
    } catch {
      /* fall through */
    }
  }

  return res.status(403).json({ error: "CSRF origin check failed." });
}
