import type { NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "http";
import { config } from "../config.js";
import { db } from "../database.js";
import { hashOpaqueToken } from "../auth/tokens.js";
import { resolveTenantContext } from "../security/tenant-context.js";

export type AuthKind =
  | "api_token"
  | "session"
  | "legacy_cookie"
  | "api_key_user"
  | "automation";

export type WsAuthContext = {
  userId: string;
  authKind: AuthKind;
};

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}

function isLoopback(req: { socket: { remoteAddress?: string | null } }): boolean {
  const a = req.socket.remoteAddress;
  return (
    a === "127.0.0.1" ||
    a === "::1" ||
    a === "::ffff:127.0.0.1" ||
    (typeof a === "string" && a.endsWith("127.0.0.1"))
  );
}

function matchesApiKey(apiKey: string | undefined): boolean {
  return Boolean(apiKey && apiKey === config.server.apiKey);
}

function attachPrincipal(
  req: Request,
  userId: string,
  authKind: AuthKind,
  extra?: { sessionId?: string },
) {
  const tenant = resolveTenantContext(userId);
  (req as any).userId = userId;
  (req as any).orgId = tenant.orgId;
  (req as any).workspaceId = tenant.workspaceId;
  (req as any).tenantRole = tenant.role;
  (req as any).authKind = authKind;
  if (extra?.sessionId) (req as any).sessionId = extra.sessionId;
}

/**
 * Resolves tenant user id: opaque sessions, API tokens, trusted automation (API key + user header).
 * Unauthenticated requests receive 401 (no ambient `system` on loopback).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer?.startsWith("hx_live_")) {
    const row = db.getApiAccessTokenByHash(hashOpaqueToken(bearer));
    if (row && !row.revoked_at) {
      db.touchApiAccessToken(row.id);
      attachPrincipal(req, row.user_id, "api_token");
      return next();
    }
    return res.status(401).json({ error: "Invalid or revoked API token." });
  }

  const sessionCookie = req.cookies?.hustronix_session as string | undefined;
  if (sessionCookie) {
    const sess = db.getSessionByTokenHash(hashOpaqueToken(sessionCookie));
    if (sess && !sess.revoked_at && new Date(sess.expires_at) > new Date()) {
      db.touchSession(sess.id);
      attachPrincipal(req, sess.user_id, "session", { sessionId: sess.id });
      return next();
    }
  }

  if (config.server.allowLegacyUidCookie) {
    const legacyUid = req.cookies?.hustronix_uid as string | undefined;
    if (legacyUid && db.getUserById(legacyUid)) {
      attachPrincipal(req, legacyUid, "legacy_cookie");
      return next();
    }
  }

  const headerUser = (req.headers["x-user-id"] as string)?.trim();
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (matchesApiKey(apiKey) && headerUser) {
    if (!db.getUserById(headerUser)) {
      return res.status(401).json({ error: "Unknown user for automation header." });
    }
    attachPrincipal(req, headerUser, "api_key_user");
    return next();
  }

  if (config.server.allowLoopbackAuth && isLoopback(req)) {
    if (matchesApiKey(apiKey) && config.server.allowApiKeySystemPrincipal) {
      attachPrincipal(req, "system", "automation");
      return next();
    }
    if (headerUser && db.getUserById(headerUser)) {
      attachPrincipal(req, headerUser, "automation");
      return next();
    }
  }

  return res.status(401).json({ error: "Unauthorized." });
}

/**
 * WebSocket auth: session cookie, optional `session` query (dev only), automation on loopback when enabled.
 */
export function resolveWsAuth(req: IncomingMessage): WsAuthContext | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const loopback =
    req.socket.remoteAddress === "127.0.0.1" ||
    req.socket.remoteAddress === "::1" ||
    req.socket.remoteAddress === "::ffff:127.0.0.1";

  const sessionCookie = cookies.hustronix_session;
  if (sessionCookie) {
    const sess = db.getSessionByTokenHash(hashOpaqueToken(sessionCookie));
    if (sess && !sess.revoked_at && new Date(sess.expires_at) > new Date()) {
      db.touchSession(sess.id);
      return { userId: sess.user_id, authKind: "session" };
    }
  }

  if (config.server.allowLegacyUidCookie) {
    const legacyUid = cookies.hustronix_uid;
    if (legacyUid && db.getUserById(legacyUid)) {
      return { userId: legacyUid, authKind: "legacy_cookie" };
    }
  }

  if (config.server.allowWsSessionQuery) {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);
    const sessionTok = url.searchParams.get("session");
    if (sessionTok) {
      const sess = db.getSessionByTokenHash(hashOpaqueToken(sessionTok));
      if (sess && !sess.revoked_at && new Date(sess.expires_at) > new Date()) {
        db.touchSession(sess.id);
        return { userId: sess.user_id, authKind: "session" };
      }
    }
  }

  if (config.server.allowLoopbackAuth && loopback) {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);
    const explicitQueryUserId = url.searchParams.get("userId")?.trim();
    if (explicitQueryUserId && db.getUserById(explicitQueryUserId)) {
      return { userId: explicitQueryUserId, authKind: "automation" };
    }
  }

  return null;
}

/** @deprecated Use resolveWsAuth — kept for callers expecting user id only. */
export function resolveWsUserId(req: IncomingMessage): string | null {
  return resolveWsAuth(req)?.userId ?? null;
}
