import type { NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "http";
import { config } from "../config.js";
import { db } from "../database.js";
import { hashOpaqueToken } from "../auth/tokens.js";

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

function isLoopback(req: Request): boolean {
  const a = req.socket.remoteAddress;
  return (
    a === "127.0.0.1" ||
    a === "::1" ||
    a === "::ffff:127.0.0.1" ||
    (typeof a === "string" && a.endsWith("127.0.0.1"))
  );
}

/**
 * Resolves tenant user id: opaque sessions, API tokens, trusted automation (API key + user header),
 * legacy cookie, dev-only x-user-id on loopback, else system for local/key-only automation.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const loopback = isLoopback(req);

  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer?.startsWith("hx_live_")) {
    const row = db.getApiAccessTokenByHash(hashOpaqueToken(bearer));
    if (row && !row.revoked_at) {
      db.touchApiAccessToken(row.id);
      (req as any).userId = row.user_id;
      (req as any).authKind = "api_token";
      return next();
    }
    return res.status(401).json({ error: "Invalid or revoked API token." });
  }

  const sessionCookie = req.cookies?.hustronix_session as string | undefined;
  if (sessionCookie) {
    const sess = db.getSessionByTokenHash(hashOpaqueToken(sessionCookie));
    if (sess && !sess.revoked_at && new Date(sess.expires_at) > new Date()) {
      db.touchSession(sess.id);
      (req as any).userId = sess.user_id;
      (req as any).sessionId = sess.id;
      (req as any).authKind = "session";
      return next();
    }
  }

  const legacyUid = req.cookies?.hustronix_uid as string | undefined;
  if (legacyUid && db.getUserById(legacyUid)) {
    (req as any).userId = legacyUid;
    (req as any).authKind = "legacy_cookie";
    return next();
  }

  const headerUser = (req.headers["x-user-id"] as string)?.trim();
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (apiKey === config.server.apiKey && headerUser) {
    (req as any).userId = headerUser;
    (req as any).authKind = "api_key_user";
    return next();
  }

  if (headerUser && loopback) {
    (req as any).userId = headerUser;
    (req as any).authKind = "local_dev_header";
    return next();
  }

  if (loopback || apiKey === config.server.apiKey) {
    (req as any).userId = "system";
    (req as any).authKind = "system";
    return next();
  }

  return res.status(401).json({ error: "Unauthorized." });
}

/**
 * WebSocket user resolution: Cookie `hustronix_session` / legacy uid (same as browser),
 * optional `session` query for clients that cannot send cookies, then loopback `userId`.
 */
export function resolveWsUserId(req: IncomingMessage): string | null {
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
      return sess.user_id;
    }
  }

  const legacyUid = cookies.hustronix_uid;
  if (legacyUid && db.getUserById(legacyUid)) return legacyUid;

  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);

  const sessionTok = url.searchParams.get("session");
  if (sessionTok) {
    const sess = db.getSessionByTokenHash(hashOpaqueToken(sessionTok));
    if (sess && !sess.revoked_at && new Date(sess.expires_at) > new Date()) {
      db.touchSession(sess.id);
      return sess.user_id;
    }
  }

  if (loopback) {
    return url.searchParams.get("userId") || "system";
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return url.searchParams.get("userId") || "system";
}
