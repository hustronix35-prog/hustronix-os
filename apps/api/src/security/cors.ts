import type { CorsOptions } from "cors";
import type { Request } from "express";
import { config } from "../config.js";

function isWebhookPath(req: Request): boolean {
  return (
    req.path === "/api/integrations/slack/events" ||
    req.path.startsWith("/api/ingest/github") ||
    req.path.startsWith("/api/ingest/jira") ||
    req.path.startsWith("/api/ingest/crm") ||
    req.path.startsWith("/api/ingest/microsoft") ||
    req.path.startsWith("/api/ingest/google") ||
    req.path.startsWith("/api/ingest/notion") ||
    req.path.startsWith("/api/ingest/linear")
  );
}

export function buildCorsOptions(): CorsOptions {
  const allowed = new Set(config.server.allowedOrigins);

  return {
    credentials: true,
    maxAge: 600,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-API-Key",
      "X-Request-ID",
      "X-User-ID",
    ],
    exposedHeaders: [
      "Retry-After",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "X-Request-ID",
    ],
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };
}

export function shouldBypassBrowserCors(req: Request): boolean {
  return isWebhookPath(req);
}
