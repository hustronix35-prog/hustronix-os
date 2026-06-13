/**
 * Microsoft-specific REST surface.
 *
 *   GET  /api/integrations/microsoft/status           → which surfaces (mail/calendar/teams) are active
 *   POST /api/integrations/microsoft/surfaces         → enable a set of surfaces (creates Graph subs)
 *
 * The status endpoint is the source-of-truth the Settings UI uses to render
 * three toggle pills (Outlook Mail / Outlook Calendar / Microsoft Teams).
 * `POST /surfaces` accepts the authoritative list and reconciles — same shape
 * as GitHub repo selection.
 */

import type { Express, Request, Response } from "express";

import { authMiddleware } from "../middleware/auth.js";
import {
  createGraphSubscription,
  deleteGraphSubscription,
  getMicrosoftConnection,
  listMicrosoftSubscriptions,
  type GraphResourceKind,
} from "./microsoftConnector.js";
import { db } from "../database.js";

const ALL_KINDS: GraphResourceKind[] = ["outlook_mail", "outlook_calendar", "teams_chats"];

function isGraphResourceKind(s: string): s is GraphResourceKind {
  return ALL_KINDS.includes(s as GraphResourceKind);
}

async function withConnection(req: Request, res: Response) {
  const userId = (req as any).userId as string | undefined;
  if (!userId || userId === "system") {
    res.status(401).json({ error: "Sign in required." });
    return null;
  }
  const connection = await getMicrosoftConnection(userId);
  if (!connection) {
    res.status(409).json({
      error: "Microsoft is not connected.",
      hint: "Connect Microsoft from Settings → Connections, then retry.",
    });
    return null;
  }
  return { userId, connection };
}

export function mountMicrosoftRoutes(app: Express): void {
  app.get("/api/integrations/microsoft/status", authMiddleware, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    const subs = listMicrosoftSubscriptions(ctx.connection.id);
    const active = new Set(subs.map((s) => s.kind));
    res.json({
      connected: true,
      surfaces: ALL_KINDS.map((kind) => ({
        kind,
        enabled: active.has(kind),
        expiresAt: subs.find((s) => s.kind === kind)?.expiresAt ?? null,
      })),
    });
  });

  app.post("/api/integrations/microsoft/surfaces", authMiddleware, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as { surfaces?: unknown };
    if (!Array.isArray(body.surfaces)) {
      return res.status(400).json({ error: "Body must include `surfaces: string[]`." });
    }
    const requested = (body.surfaces as unknown[])
      .map((s) => String(s || "").trim())
      .filter(isGraphResourceKind);
    const wanted = new Set(requested);

    const current = listMicrosoftSubscriptions(ctx.connection.id);
    const currentByKind = new Map(current.map((s) => [s.kind, s]));

    const failures: { kind: string; error: string }[] = [];
    const enabled: GraphResourceKind[] = [];
    const disabled: GraphResourceKind[] = [];

    for (const kind of ALL_KINDS) {
      const exists = currentByKind.has(kind);
      const want = wanted.has(kind);
      if (want && !exists) {
        try {
          await createGraphSubscription(ctx.connection, kind);
          enabled.push(kind);
        } catch (err) {
          failures.push({ kind, error: (err as Error).message });
        }
      } else if (!want && exists) {
        const row = currentByKind.get(kind)!;
        try {
          if (row.subscriptionId) {
            await deleteGraphSubscription(ctx.connection, row.subscriptionId);
          }
          db.deleteOAuthSubscription(row.id);
          disabled.push(kind);
        } catch (err) {
          failures.push({ kind, error: (err as Error).message });
        }
      }
    }

    res.json({
      ok: failures.length === 0,
      enabled,
      disabled,
      surfaces: listMicrosoftSubscriptions(ctx.connection.id).map((s) => ({
        kind: s.kind,
        expiresAt: s.expiresAt,
      })),
      failures,
    });
  });
}
