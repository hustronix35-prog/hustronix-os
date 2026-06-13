/**
 * Connections health surface. Single endpoint the UI can poll to render the
 * Settings → Manage modal: per-connection status, expiring subscriptions,
 * stale workers, and the most recent ingest activity per source.
 *
 * Endpoint: GET /api/integrations/health
 *
 * Returns a stable shape so the frontend can render even when individual
 * connectors fail to report. Errors are isolated per provider — one slow
 * provider never blocks the rest.
 */

import type { Express, Request, Response } from "express";

import { authMiddleware } from "../middleware/auth.js";
import { db } from "../database.js";
import { listConnectionStatuses } from "../auth/oauthConnections.js";
import type { ProviderId } from "../auth/oauthProviders.js";

interface SubscriptionRow {
  id: string;
  provider: string;
  kind: string;
  external_resource: string;
  external_subscription_id: string;
  expires_at: string;
  created_at: string;
}

interface ProviderHealth {
  provider: ProviderId | string;
  label: string;
  connected: boolean;
  externalTeamName: string | null;
  scope: string | null;
  expiresAt: string | null;
  needsReauth: boolean;
  /** Subscriptions / pollers tracked for this provider. */
  surfaces: {
    kind: string;
    resource: string;
    expiresAt: string | null;
    minutesUntilExpiry: number | null;
    /** True when the row is overdue and the renewal worker hasn't picked it up yet. */
    expired: boolean;
  }[];
  /** Most recent external_signal we ingested under this provider's bucket(s). */
  lastSignalAt: string | null;
  signalCount24h: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  slack: "Slack",
  github: "GitHub",
  microsoft: "Microsoft 365",
  google: "Google",
  notion: "Notion",
  jira: "Jira",
  linear: "Linear",
};

const PROVIDER_TO_SOURCES: Record<string, string[]> = {
  slack: ["SLACK"],
  github: ["GITHUB"],
  jira: ["JIRA"],
  microsoft: ["MICROSOFT"],
  google: ["GOOGLE", "GMAIL"],
  notion: ["NOTION"],
  linear: ["LINEAR"],
};

function minutesUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 60_000);
}

function lastSignalFor(userId: string, sources: string[]): { lastAt: string | null; count24h: number } {
  if (!sources.length) return { lastAt: null, count24h: 0 };
  const placeholders = sources.map(() => "?").join(",");
  const last = db.rawGet(
    `SELECT MAX(detected_at) as t FROM external_signals
     WHERE user_id = ? AND source IN (${placeholders})`,
    [userId, ...sources],
  ) as { t: string | null }[];
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const count = db.rawGet(
    `SELECT COUNT(*) as c FROM external_signals
     WHERE user_id = ? AND source IN (${placeholders}) AND detected_at >= ?`,
    [userId, ...sources, since],
  ) as { c: number }[];
  return { lastAt: last[0]?.t ?? null, count24h: count[0]?.c ?? 0 };
}

function buildProviderHealth(
  userId: string,
  status: ReturnType<typeof listConnectionStatuses>[number],
  subscriptions: SubscriptionRow[],
): ProviderHealth {
  const subs = subscriptions.filter((s) => s.provider === status.provider);
  const surfaces = subs.map((s) => {
    const mins = minutesUntil(s.expires_at);
    return {
      kind: s.kind,
      resource: s.external_resource,
      expiresAt: s.expires_at || null,
      minutesUntilExpiry: mins,
      expired: mins !== null && mins < 0,
    };
  });
  const sources = PROVIDER_TO_SOURCES[status.provider] || [];
  const { lastAt, count24h } = lastSignalFor(userId, sources);

  /**
   * `needsReauth` is true if the provider's access token has already expired
   * AND the refresh worker hasn't recovered it. This is the single signal the
   * UI needs to nudge "Reconnect" — everything else is informational.
   */
  const tokenMins = minutesUntil(status.expiresAt);
  const needsReauth =
    !!status.connected && tokenMins !== null && tokenMins < 0;

  return {
    provider: status.provider,
    label: PROVIDER_LABELS[status.provider] || status.provider,
    connected: !!status.connected,
    externalTeamName: status.externalTeamName ?? null,
    scope: status.scope ?? null,
    expiresAt: status.expiresAt ?? null,
    needsReauth,
    surfaces,
    lastSignalAt: lastAt,
    signalCount24h: count24h,
  };
}

export function mountConnectionsHealthRoute(app: Express): void {
  app.get("/api/integrations/health", authMiddleware, (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }

    const statuses = listConnectionStatuses(userId);

    /**
     * Pull every subscription row in one query. Cheaper than per-provider
     * round-trips, and the size is bounded by what one user has.
     */
    const subs = db.rawGet(
      `SELECT id, provider, kind, external_resource, external_subscription_id, expires_at, created_at
       FROM oauth_subscriptions WHERE user_id = ?`,
      [userId],
    ) as SubscriptionRow[];

    const providers = statuses.map((s) =>
      buildProviderHealth(userId, s, subs as SubscriptionRow[]),
    );
    const summary = {
      total: providers.length,
      connected: providers.filter((p) => p.connected).length,
      needsReauth: providers.filter((p) => p.needsReauth).length,
      expiringSoon: providers
        .flatMap((p) => p.surfaces)
        .filter((s) => s.minutesUntilExpiry !== null && s.minutesUntilExpiry < 60).length,
    };

    res.json({ ok: true, summary, providers });
  });
}
