import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

const REDACTED_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "password",
  "currentpassword",
  "newpassword",
  "token",
  "refreshtoken",
  "accesstoken",
  "apikey",
  "secret",
  "otp",
  "totpcode",
  "backupcode",
]);

export function getRequestId(req: Request): string {
  return String((req as any).requestId || req.headers[REQUEST_ID_HEADER] || "");
}

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = typeof req.headers[REQUEST_ID_HEADER] === "string" ? req.headers[REQUEST_ID_HEADER] : "";
  const requestId = /^[a-zA-Z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  (req as any).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function redactForLog(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactForLog);
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    out[key] = REDACTED_KEYS.has(normalized) ? "[REDACTED]" : redactForLog(raw);
  }
  return out;
}

export function logJson(event: string, fields: Record<string, unknown>) {
  const safeFields = redactForLog(fields) as Record<string, unknown>;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...safeFields,
    }),
  );
}
