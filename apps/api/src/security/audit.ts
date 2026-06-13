import type { Request } from "express";
import { db } from "../database.js";
import { clientIp, getRequestId, logJson, redactForLog } from "./requestContext.js";

export type SecuritySeverity = "info" | "warning" | "critical";

export function recordSecurityEvent(
  req: Request,
  eventType: string,
  severity: SecuritySeverity,
  metadata: Record<string, unknown> = {},
) {
  const userId = String((req as any).userId || metadata.userId || "") || null;
  const authKind = String((req as any).authKind || metadata.authKind || "") || null;
  const safeMetadata = redactForLog(metadata) as Record<string, unknown>;

  logJson("security.event", {
    eventType,
    severity,
    userId,
    authKind,
    ip: clientIp(req),
    requestId: getRequestId(req),
    metadata: safeMetadata,
  });

  try {
    db.insertSecurityEvent({
      eventType,
      severity,
      userId,
      authKind,
      ip: clientIp(req),
      userAgent: String(req.headers["user-agent"] || ""),
      requestId: getRequestId(req),
      metadata: safeMetadata,
    });
  } catch (e) {
    logJson("security.event.persist_failed", {
      eventType,
      requestId: getRequestId(req),
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
