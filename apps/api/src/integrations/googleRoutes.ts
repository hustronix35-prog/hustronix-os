/**
 * Google management surface.
 *
 *   GET    /api/integrations/google/status                  → calendar + gmail subscription state
 *   POST   /api/integrations/google/calendar/recreate       → tear down + recreate the watch channel
 *   POST   /api/integrations/google/gmail/recreate          → reseed historyId after disconnect/reconnect
 *   GET    /api/integrations/google/gmail/allowlist         → current FROM-domain allowlist
 *   POST   /api/integrations/google/gmail/allowlist         → replace allowlist (body: { domains: [] })
 */

import type { Express, Request, Response } from "express";

import { authMiddleware } from "../middleware/auth.js";
import { db } from "../database.js";
import {
  bootstrapGmailPoll,
  createCalendarSubscription,
  deleteCalendarSubscription,
  getGmailAllowlist,
  getGoogleConnection,
  setGmailFromAllowlist,
  SUBSCRIPTION_KIND_CAL_WATCH,
  SUBSCRIPTION_KIND_GMAIL_POLL,
} from "./googleConnector.js";

async function withConnection(req: Request, res: Response) {
  const userId = (req as any).userId as string | undefined;
  if (!userId || userId === "system") {
    res.status(401).json({ error: "Sign in required." });
    return null;
  }
  const connection = await getGoogleConnection(userId);
  if (!connection) {
    res.status(409).json({
      error: "Google is not connected.",
      hint: "Connect Google from Settings → Connections, then retry.",
    });
    return null;
  }
  return { userId, connection };
}

export function mountGoogleRoutes(app: Express): void {
  app.get("/api/integrations/google/status", authMiddleware, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    const subs = db.listOAuthSubscriptions(ctx.connection.id);
    const cal = subs.find((s: any) => s.kind === SUBSCRIPTION_KIND_CAL_WATCH);
    const gmail = subs.find((s: any) => s.kind === SUBSCRIPTION_KIND_GMAIL_POLL);
    res.json({
      connected: true,
      calendar: cal
        ? {
            calendarId: (cal.external_resource || "").replace(/^calendar:/, ""),
            channelExpiresAt: cal.expires_at,
            active: true,
          }
        : { active: false },
      gmail: gmail
        ? {
            email: gmail.external_subscription_id,
            allowlist: getGmailAllowlist(ctx.connection.id),
            active: true,
          }
        : { active: false },
    });
  });

  app.post("/api/integrations/google/calendar/recreate", authMiddleware, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    try {
      await deleteCalendarSubscription(ctx.connection);
      await createCalendarSubscription(ctx.connection);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/api/integrations/google/gmail/recreate", authMiddleware, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    /** Drop existing poll row before bootstrap so we get a fresh historyId. */
    const subs = db.listOAuthSubscriptions(ctx.connection.id);
    for (const s of subs) {
      if (s.kind === SUBSCRIPTION_KIND_GMAIL_POLL) db.deleteOAuthSubscription(s.id);
    }
    try {
      await bootstrapGmailPoll(ctx.connection);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get("/api/integrations/google/gmail/allowlist", authMiddleware, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    res.json({ allowlist: getGmailAllowlist(ctx.connection.id) });
  });

  app.post("/api/integrations/google/gmail/allowlist", authMiddleware, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as { domains?: unknown };
    if (!Array.isArray(body.domains)) {
      return res.status(400).json({ error: "Body must include `domains: string[]`." });
    }
    const ok = setGmailFromAllowlist(
      ctx.connection.id,
      (body.domains as unknown[]).map((d) => String(d || "")),
    );
    if (!ok) {
      return res.status(409).json({ error: "Gmail poll is not initialized for this connection." });
    }
    res.json({ ok: true, allowlist: getGmailAllowlist(ctx.connection.id) });
  });
}
