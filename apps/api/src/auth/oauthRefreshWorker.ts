/**
 * Background refresh worker.
 *
 * For providers with short-lived access tokens (Google, Microsoft, Jira,
 * Linear), we proactively refresh in the background instead of only on demand.
 * Reasons:
 *   - Webhook handlers must respond in <3s; doing a refresh in-line during a
 *     burst of incoming events causes cascading timeouts.
 *   - Polling workers (Notion, fallback Gmail) prefer a warm token cached in
 *     memory upstream, since they fire every few minutes.
 *
 * The worker scans `oauth_connections` every minute and refreshes anything
 * within the early-refresh window. Slack tokens are skipped (they don't expire).
 */

import { db } from "../database.js";
import { hydrateLiveConnection, refreshConnectionTokens } from "./oauthConnections.js";
import { PROVIDERS } from "./oauthProviders.js";

const REFRESH_TICK_MS = 60_000;
const EARLY_WINDOW_MIN = 5;

let timer: NodeJS.Timeout | null = null;

async function tick() {
  const horizonIso = new Date(Date.now() + EARLY_WINDOW_MIN * 60_000).toISOString();
  /** Pull a candidate set; we filter providers that support refresh in JS to keep SQL simple. */
  const rows: any[] = db.rawGet(
    `SELECT * FROM oauth_connections
     WHERE revoked_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at <= ?
     ORDER BY expires_at ASC
     LIMIT 50`,
    [horizonIso],
  );
  for (const row of rows) {
    const cfg = (PROVIDERS as Record<string, any>)[row.provider];
    if (!cfg?.supportsRefresh) continue;
    const live = hydrateLiveConnection(row);
    if (!live.refreshToken) continue;
    try {
      await refreshConnectionTokens(live);
    } catch (err) {
      console.warn(
        `[oauth.refresh] failed for ${row.provider} (${row.id}):`,
        (err as Error).message,
      );
    }
  }
}

export function startOAuthRefreshWorker(): void {
  if (timer) return;
  /** Fire once at startup so freshly-restored processes don't wait a minute. */
  void tick().catch(() => undefined);
  timer = setInterval(() => {
    void tick().catch(() => undefined);
  }, REFRESH_TICK_MS);
  if (typeof (timer as any).unref === "function") (timer as any).unref();
}

export function stopOAuthRefreshWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
