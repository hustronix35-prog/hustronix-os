/**
 * Linear connector — OAuth + auto-registered GraphQL webhook.
 *
 * Linear is the simplest of the Phase 3 trio:
 *   - OAuth via /oauth/authorize → /oauth/token (handled by oauthRoutes)
 *   - GraphQL endpoint at https://api.linear.app/graphql
 *   - Webhooks created via `webhookCreate` mutation; the response includes
 *     a per-webhook `secret` we stash so we can verify HMAC-SHA256 deliveries.
 *
 * On connect we:
 *   1. Look up `viewer` to capture the user's Linear id, email, displayName
 *   2. Create a single webhook scoped to all teams the user can see
 *      (`allPublicTeams: true`) for resourceTypes Issue + Comment + Project
 *
 * On disconnect we delete the webhook so Linear stops trying to deliver.
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

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";
const SUBSCRIPTION_KIND_LINEAR_HOOK = "linear_webhook";
const RESOURCE_TYPES = ["Issue", "Comment", "Project", "Cycle"] as const;

interface LinearViewer {
  id: string;
  email?: string;
  displayName?: string;
  name?: string;
  organization?: { id: string; name?: string; urlKey?: string };
}

function deliveryUrlForUser(userId: string): string {
  const explicit = (process.env.WEBHOOK_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const base = explicit || config.server.appOrigin.replace(/\/$/, "");
  return `${base}/api/ingest/linear/${encodeURIComponent(userId)}`;
}

async function linearGraphQL<T = any>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(LINEAR_GRAPHQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.errors) {
    const detail =
      Array.isArray(json.errors) && json.errors.length
        ? json.errors.map((e: any) => e.message).join("; ")
        : text.slice(0, 200);
    throw new Error(`linear GraphQL failed: ${res.status} ${detail}`);
  }
  return json.data as T;
}

export async function fetchLinearViewer(accessToken: string): Promise<LinearViewer> {
  const data = await linearGraphQL<{ viewer: LinearViewer }>(
    accessToken,
    `query Me {
      viewer {
        id
        email
        displayName
        name
        organization { id name urlKey }
      }
    }`,
  );
  return data.viewer;
}

export interface LinearWebhookRow {
  rowId: string;
  webhookId: string;
  webhookSecret: string;
  url: string;
  expiresAt: string;
}

interface LinearWebhookPayload {
  webhookId: string;
  webhookSecret: string;
  url: string;
}

export function getLinearWebhook(connectionId: string): LinearWebhookRow | null {
  const subs = db.listOAuthSubscriptions(connectionId);
  const match = subs.find((s: any) => s.kind === SUBSCRIPTION_KIND_LINEAR_HOOK);
  if (!match) return null;
  const meta = parseSecret(match.meta);
  return {
    rowId: match.id as string,
    webhookId: (match.external_subscription_id || "") as string,
    webhookSecret: meta.secret || "",
    url: (match.external_resource || "") as string,
    expiresAt: (match.expires_at || "") as string,
  };
}

function parseSecret(raw: string | null): { secret?: string } {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function createLinearWebhook(
  connection: LiveConnection,
): Promise<LinearWebhookPayload> {
  const url = deliveryUrlForUser(connection.userId);
  const data = await linearGraphQL<{
    webhookCreate: { success: boolean; webhook: { id: string; secret: string } };
  }>(
    connection.accessToken,
    `mutation Hook($input: WebhookCreateInput!) {
      webhookCreate(input: $input) {
        success
        webhook { id secret }
      }
    }`,
    {
      input: {
        url,
        label: "Hustronix Signal Bridge",
        resourceTypes: [...RESOURCE_TYPES],
        allPublicTeams: true,
      },
    },
  );
  if (!data.webhookCreate?.success) {
    throw new Error("linear webhookCreate returned success=false");
  }
  const wh = data.webhookCreate.webhook;
  /** Secret must be persisted; without it we cannot verify deliveries. */
  db.upsertOAuthSubscription({
    connectionId: connection.id,
    userId: connection.userId,
    provider: "linear",
    kind: SUBSCRIPTION_KIND_LINEAR_HOOK,
    externalResource: url,
    externalSubscriptionId: wh.id,
    /** Linear webhooks don't expire, but we keep a far-future date so the renewal worker ignores it. */
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    meta: JSON.stringify({ secret: wh.secret }),
  });
  return { webhookId: wh.id, webhookSecret: wh.secret, url };
}

export async function deleteLinearWebhook(
  connection: LiveConnection,
  webhookId: string,
): Promise<void> {
  try {
    await linearGraphQL(
      connection.accessToken,
      `mutation Del($id: String!) { webhookDelete(id: $id) { success } }`,
      { id: webhookId },
    );
  } catch (err) {
    /** If the webhook is already gone, ignore. */
    if (!String((err as Error).message).match(/(not\s+found|404)/i)) throw err;
  }
}

/** Find the connection that owns the bearer URL of an inbound delivery. */
export function getLinearConnectionForUser(userId: string): { connectionId: string; secret: string } | null {
  const rows = db.rawGet(
    `SELECT c.id, s.meta
     FROM oauth_connections c
     JOIN oauth_subscriptions s ON s.connection_id = c.id
     WHERE c.user_id = ? AND c.provider = 'linear' AND s.kind = ? AND c.revoked_at IS NULL
     LIMIT 1`,
    [userId, SUBSCRIPTION_KIND_LINEAR_HOOK],
  ) as any[];
  if (!rows || !rows[0]) return null;
  const secret = parseSecret(rows[0].meta).secret;
  if (!secret) return null;
  return { connectionId: rows[0].id, secret };
}

// =========================================================================
// Lifecycle hooks
// =========================================================================

async function afterLinearConnect(connection: LiveConnection): Promise<void> {
  try {
    const viewer = await fetchLinearViewer(connection.accessToken);
    db.rawRun(
      `UPDATE oauth_connections
       SET external_user_id = ?,
           external_team_id = COALESCE(NULLIF(external_team_id,''), ?),
           external_team_name = COALESCE(external_team_name, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        viewer.id,
        viewer.organization?.id || "",
        viewer.organization?.name || viewer.displayName || "Linear",
        connection.id,
      ],
    );
  } catch (err) {
    console.warn("[linear] viewer lookup after connect failed:", (err as Error).message);
  }
  /** Auto-register the webhook so signals start flowing immediately. */
  try {
    await createLinearWebhook(connection);
  } catch (err) {
    console.warn(
      "[linear] webhook auto-create failed (user can retry from Settings):",
      (err as Error).message,
    );
  }
}

async function beforeLinearDisconnect(connection: LiveConnection): Promise<void> {
  const wh = getLinearWebhook(connection.id);
  if (!wh) return;
  try {
    await deleteLinearWebhook(connection, wh.webhookId);
  } catch (err) {
    console.warn("[linear] webhook cleanup failed:", (err as Error).message);
  }
  db.deleteOAuthSubscription(wh.rowId);
}

let registered = false;
export function registerLinearLifecycleHooks(): void {
  if (registered) return;
  registered = true;
  registerAfterConnect("linear", afterLinearConnect);
  registerBeforeDisconnect("linear", beforeLinearDisconnect);
}

export async function getLinearConnection(userId: string): Promise<LiveConnection | null> {
  return getLiveConnection(userId, "linear");
}

export async function getLinearAccessToken(userId: string): Promise<string | null> {
  return getLiveAccessToken(userId, "linear");
}
