/**
 * Provider-specific lifecycle hooks invoked by the generic `oauthRoutes`:
 *
 *   afterConnect   — runs after we persist a fresh `TokenSet`. Use this to
 *                    register webhooks (GitHub), create change-notification
 *                    subscriptions (Microsoft Graph), set up watch channels
 *                    (Google), or kick off backfill polls (Notion).
 *   beforeDisconnect — runs before we revoke / delete a connection. Use this
 *                    to tear down provider-side subscriptions so we stop
 *                    receiving events for a tenant that disconnected.
 *
 * Each provider's connector module re-exports its handlers and registers them
 * via `registerLifecycleHook`. Phase 0 ships only the registry; Phase 1+ will
 * populate per-provider implementations.
 */

import type { LiveConnection } from "./oauthConnections.js";
import type { ProviderId } from "./oauthProviders.js";

type Hook = (connection: LiveConnection) => Promise<void> | void;

const afterConnectHooks: Partial<Record<ProviderId, Hook>> = {};
const beforeDisconnectHooks: Partial<Record<ProviderId, Hook>> = {};

export function registerAfterConnect(provider: ProviderId, fn: Hook): void {
  afterConnectHooks[provider] = fn;
}

export function registerBeforeDisconnect(provider: ProviderId, fn: Hook): void {
  beforeDisconnectHooks[provider] = fn;
}

export async function runAfterConnect(connection: LiveConnection): Promise<void> {
  const fn = afterConnectHooks[connection.provider];
  if (!fn) return;
  try {
    await fn(connection);
  } catch (err) {
    /**
     * Connect itself succeeded — we don't want to roll back the user-visible
     * connection just because a downstream webhook registration failed. Log it
     * and let the subscription-health worker recover.
     */
    console.error(
      `[oauth] afterConnect hook failed for ${connection.provider}:`,
      (err as Error).message,
    );
  }
}

export async function runBeforeDisconnect(connection: LiveConnection): Promise<void> {
  const fn = beforeDisconnectHooks[connection.provider];
  if (!fn) return;
  try {
    await fn(connection);
  } catch (err) {
    console.error(
      `[oauth] beforeDisconnect hook failed for ${connection.provider}:`,
      (err as Error).message,
    );
  }
}
