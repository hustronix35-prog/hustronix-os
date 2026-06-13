/**
 * Microsoft Graph connector — Teams + Outlook Calendar + Outlook Mail.
 *
 * One Azure AD multi-tenant app powers all three surfaces. Each surface gets
 * its own change-notification subscription (Graph subscriptions are
 * per-resource), tracked in `oauth_subscriptions`. The renewal worker keeps
 * them alive automatically.
 *
 * Why this is heavier than other providers:
 *   - Graph subscriptions expire fast: Teams chat/channel = 60 minutes max,
 *     mail/calendar = ~3 days. We renew with a 10-minute headroom.
 *   - Notification payloads are *light* (resource path + ids); the actual
 *     content lives behind a `GET <resource>` call that needs the user's
 *     token. The webhook handler does that fetch before transforming.
 *   - Webhook URL validation: when we POST /subscriptions, Graph synchronously
 *     hits our `notificationUrl?validationToken=…` and expects the raw token
 *     in plaintext within 10 seconds. Done in `microsoftWebhook.ts`.
 */

import { db } from "../database.js";
import { config } from "../config.js";
import {
  getLiveAccessToken,
  getLiveConnection,
  type LiveConnection,
} from "../auth/oauthConnections.js";
import {
  registerAfterConnect,
  registerBeforeDisconnect,
} from "../auth/oauthLifecycle.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const SUBSCRIPTION_KIND_GRAPH = "graph_subscription";

export type GraphResourceKind = "outlook_mail" | "outlook_calendar" | "teams_chats";

interface GraphSubscriptionMeta {
  kind: GraphResourceKind;
  resource: string;
  changeType: string;
}

const RESOURCE_DESCRIPTORS: Record<GraphResourceKind, GraphSubscriptionMeta & { maxLifetimeMinutes: number }> = {
  outlook_mail: {
    kind: "outlook_mail",
    resource: "me/mailFolders('Inbox')/messages",
    changeType: "created,updated",
    maxLifetimeMinutes: 4230,
  },
  outlook_calendar: {
    kind: "outlook_calendar",
    resource: "me/events",
    changeType: "created,updated,deleted",
    maxLifetimeMinutes: 4230,
  },
  /**
   * Single subscription captures both Teams channel and 1:1/group chat
   * messages the user can read. Delegated permission ChannelMessage.Read.All
   * + Chat.Read covers it. Subscription expires every 60 min.
   */
  teams_chats: {
    kind: "teams_chats",
    resource: "me/chats/getAllMessages",
    changeType: "created,updated",
    maxLifetimeMinutes: 60,
  },
};

const RENEWAL_HEADROOM_MIN = 10;

// =========================================================================
// Webhook public URL + clientState
// =========================================================================

export function microsoftNotificationUrl(): string {
  const explicit = (process.env.WEBHOOK_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const base = explicit || config.server.appOrigin.replace(/\/$/, "");
  return `${base}/api/ingest/microsoft`;
}

/**
 * Shared secret echoed back in every notification. We use the env var if set,
 * else derive a stable per-process value so dev still works without config.
 * In production this MUST be set to a random 32+ char string.
 */
export function microsoftClientState(): string {
  const explicit = (process.env.MICROSOFT_WEBHOOK_CLIENT_STATE || "").trim();
  if (explicit) return explicit;
  /** Fallback so dev works without setup; treat the warning as production-blocking. */
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MICROSOFT_WEBHOOK_CLIENT_STATE is required in production. Generate `openssl rand -hex 32` and set it.",
    );
  }
  return "hustronix-dev-client-state";
}

// =========================================================================
// Authenticated Graph fetch
// =========================================================================

interface GraphFetchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Pass true for endpoints that require ConsistencyLevel=eventual (advanced filters). */
  consistencyEventual?: boolean;
}

async function graphFetch<T>(
  accessToken: string,
  path: string,
  opts: GraphFetchOptions = {},
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH_BASE}/${path.replace(/^\//, "")}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  };
  if (opts.body) headers["content-type"] = "application/json";
  if (opts.consistencyEventual) headers["consistencylevel"] = "eventual";

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail = json?.error?.message || text.slice(0, 200);
    throw new Error(`graph ${opts.method ?? "GET"} ${path} failed: ${res.status} ${detail}`);
  }
  return json as T;
}

// =========================================================================
// /me lookup — captures tenantId + oid + UPN on connect
// =========================================================================

interface GraphMe {
  id: string;
  userPrincipalName?: string;
  mail?: string;
  displayName?: string;
}

interface GraphOrg {
  value: { id: string; displayName?: string }[];
}

export async function fetchGraphMe(accessToken: string): Promise<GraphMe> {
  return graphFetch<GraphMe>(accessToken, "/me");
}

export async function fetchGraphTenantId(accessToken: string): Promise<string | null> {
  try {
    const org = await graphFetch<GraphOrg>(accessToken, "/organization");
    return org.value?.[0]?.id ?? null;
  } catch {
    /** Personal MS accounts have no org; that's fine. */
    return null;
  }
}

// =========================================================================
// Subscription CRUD
// =========================================================================

interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  expirationDateTime: string;
  clientState: string;
}

function expirationFor(kind: GraphResourceKind): string {
  const max = RESOURCE_DESCRIPTORS[kind].maxLifetimeMinutes;
  /** Take max - 5 min so we don't bump into Graph's "too long" rejection. */
  const ms = Math.max(15, max - 5) * 60_000;
  return new Date(Date.now() + ms).toISOString();
}

export async function createGraphSubscription(
  connection: LiveConnection,
  kind: GraphResourceKind,
): Promise<{ subscriptionId: string; expiresAt: string; resource: string }> {
  const desc = RESOURCE_DESCRIPTORS[kind];
  const body = {
    changeType: desc.changeType,
    notificationUrl: microsoftNotificationUrl(),
    /** Required for Teams; harmless for mail/calendar. Listens for `reauthorizationRequired`. */
    lifecycleNotificationUrl: microsoftNotificationUrl(),
    resource: desc.resource,
    expirationDateTime: expirationFor(kind),
    clientState: microsoftClientState(),
    /**
     * Rich (resource-data) notifications are only required for Teams when the
     * tenant blocks delegated reads of message content; for now we keep it
     * simple and fetch the resource on each notification.
     */
    includeResourceData: false,
  };

  const created = await graphFetch<GraphSubscription>(connection.accessToken, "/subscriptions", {
    method: "POST",
    body,
  });

  db.upsertOAuthSubscription({
    connectionId: connection.id,
    userId: connection.userId,
    provider: "microsoft",
    kind: SUBSCRIPTION_KIND_GRAPH,
    externalResource: desc.resource,
    externalSubscriptionId: created.id,
    expiresAt: created.expirationDateTime,
    meta: JSON.stringify({ kind: desc.kind, changeType: desc.changeType }),
  });

  return {
    subscriptionId: created.id,
    expiresAt: created.expirationDateTime,
    resource: created.resource,
  };
}

export async function renewGraphSubscription(
  connection: LiveConnection,
  subscriptionId: string,
  kind: GraphResourceKind,
): Promise<string> {
  const next = expirationFor(kind);
  await graphFetch(connection.accessToken, `/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: { expirationDateTime: next },
  });
  return next;
}

export async function deleteGraphSubscription(
  connection: LiveConnection,
  subscriptionId: string,
): Promise<void> {
  try {
    await graphFetch(connection.accessToken, `/subscriptions/${subscriptionId}`, {
      method: "DELETE",
    });
  } catch (err) {
    /** Already gone — safe to ignore so cleanup loops complete. */
    if (!String((err as Error).message).match(/\b404\b/)) throw err;
  }
}

export interface MicrosoftSubscriptionRow {
  id: string;
  kind: GraphResourceKind;
  resource: string;
  subscriptionId: string;
  expiresAt: string;
  registeredAt: string;
}

export function listMicrosoftSubscriptions(connectionId: string): MicrosoftSubscriptionRow[] {
  const subs = db.listOAuthSubscriptions(connectionId);
  return subs
    .filter((s: any) => s.kind === SUBSCRIPTION_KIND_GRAPH)
    .map((s: any) => {
      const meta = parseMeta(s.meta);
      return {
        id: s.id as string,
        kind: (meta.kind || "outlook_mail") as GraphResourceKind,
        resource: s.external_resource as string,
        subscriptionId: (s.external_subscription_id || "") as string,
        expiresAt: (s.expires_at || "") as string,
        registeredAt: (s.created_at || "") as string,
      };
    });
}

function parseMeta(raw: string | null): { kind?: GraphResourceKind } {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Find the connection that owns a given Graph subscription id (used by webhook handler). */
export function findConnectionForSubscription(
  subscriptionId: string,
): { userId: string; kind: GraphResourceKind; resource: string; connectionId: string } | null {
  const row = (db.rawGet(
    `SELECT s.user_id, s.connection_id, s.external_resource, s.meta
     FROM oauth_subscriptions s
     WHERE s.provider = 'microsoft' AND s.kind = ? AND s.external_subscription_id = ?
     LIMIT 1`,
    [SUBSCRIPTION_KIND_GRAPH, subscriptionId],
  ) as any[])[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    kind: (parseMeta(row.meta).kind || "outlook_mail") as GraphResourceKind,
    resource: row.external_resource,
    connectionId: row.connection_id,
  };
}

// =========================================================================
// Resource fetcher used by webhook handler
// =========================================================================

/**
 * Given the resource path Graph sent in the notification, fetch the full
 * record (mail message, calendar event, Teams message) for transformation.
 */
export async function fetchNotificationResource(
  userId: string,
  resourcePath: string,
): Promise<Record<string, unknown> | null> {
  const accessToken = await getLiveAccessToken(userId, "microsoft");
  if (!accessToken) return null;
  try {
    return await graphFetch<Record<string, unknown>>(accessToken, `/${resourcePath.replace(/^\//, "")}`);
  } catch (err) {
    console.warn(`[microsoft] resource fetch failed for ${resourcePath}:`, (err as Error).message);
    return null;
  }
}

// =========================================================================
// Lifecycle hooks
// =========================================================================

async function afterMicrosoftConnect(connection: LiveConnection): Promise<void> {
  try {
    const me = await fetchGraphMe(connection.accessToken);
    const tenantId = await fetchGraphTenantId(connection.accessToken);
    db.rawRun(
      `UPDATE oauth_connections
       SET external_user_id = ?,
           external_team_id = COALESCE(NULLIF(external_team_id,''), ?),
           external_team_name = COALESCE(external_team_name, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        me.id,
        tenantId || me.userPrincipalName || me.mail || "",
        me.displayName || me.userPrincipalName || me.mail || "Microsoft",
        connection.id,
      ],
    );
  } catch (err) {
    console.warn("[microsoft] /me lookup after connect failed:", (err as Error).message);
  }
}

async function beforeMicrosoftDisconnect(connection: LiveConnection): Promise<void> {
  const subs = listMicrosoftSubscriptions(connection.id);
  for (const s of subs) {
    if (s.subscriptionId) {
      try {
        await deleteGraphSubscription(connection, s.subscriptionId);
      } catch (err) {
        console.warn(
          `[microsoft] cleanup subscription ${s.subscriptionId} failed:`,
          (err as Error).message,
        );
      }
    }
    db.deleteOAuthSubscription(s.id);
  }
}

let registered = false;
export function registerMicrosoftLifecycleHooks(): void {
  if (registered) return;
  registered = true;
  registerAfterConnect("microsoft", afterMicrosoftConnect);
  registerBeforeDisconnect("microsoft", beforeMicrosoftDisconnect);
}

// =========================================================================
// Renewal worker
// =========================================================================

let renewalTimer: NodeJS.Timeout | null = null;

async function renewalTick(): Promise<void> {
  const due = db.listOAuthSubscriptionsDueForRenewal(RENEWAL_HEADROOM_MIN);
  for (const row of due) {
    if (row.provider !== "microsoft" || row.kind !== SUBSCRIPTION_KIND_GRAPH) continue;
    const connection = await getLiveConnection(row.user_id, "microsoft");
    if (!connection) {
      /** Connection revoked but subscription row lingered — drop it. */
      db.deleteOAuthSubscription(row.id);
      continue;
    }
    const meta = parseMeta(row.meta);
    const kind: GraphResourceKind = meta.kind || "outlook_mail";
    try {
      const nextExp = await renewGraphSubscription(
        connection,
        row.external_subscription_id as string,
        kind,
      );
      db.upsertOAuthSubscription({
        connectionId: row.connection_id,
        userId: row.user_id,
        provider: "microsoft",
        kind: SUBSCRIPTION_KIND_GRAPH,
        externalResource: row.external_resource,
        externalSubscriptionId: row.external_subscription_id,
        expiresAt: nextExp,
        meta: row.meta,
      });
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(
        `[microsoft.renew] subscription ${row.external_subscription_id} renew failed:`,
        msg,
      );
      /** If Graph says it's gone, recreate from scratch so signals keep flowing. */
      if (/\b(404|410)\b/.test(msg)) {
        try {
          await createGraphSubscription(connection, kind);
          db.deleteOAuthSubscription(row.id);
        } catch (recreateErr) {
          console.error(
            `[microsoft.renew] recreate failed for ${kind}:`,
            (recreateErr as Error).message,
          );
        }
      }
    }
  }
}

export function startMicrosoftRenewalWorker(): void {
  if (renewalTimer) return;
  void renewalTick().catch(() => undefined);
  /** Tick every 5 min — Teams subscriptions expire in 60 min, plenty of headroom. */
  renewalTimer = setInterval(() => {
    void renewalTick().catch(() => undefined);
  }, 5 * 60_000);
  if (typeof (renewalTimer as any).unref === "function") (renewalTimer as any).unref();
}

export function stopMicrosoftRenewalWorker(): void {
  if (renewalTimer) {
    clearInterval(renewalTimer);
    renewalTimer = null;
  }
}

// =========================================================================
// Convenience
// =========================================================================

export async function getMicrosoftConnection(userId: string): Promise<LiveConnection | null> {
  return getLiveConnection(userId, "microsoft");
}
