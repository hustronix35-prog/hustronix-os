/**
 * Jira connector — 3LO OAuth + auto-registered webhook.
 *
 * Jira's webhook system has a quirky shape:
 *   - You register webhooks via `POST /rest/api/3/webhook` (returns an
 *     `id` per JQL filter you submit).
 *   - Each webhook is scoped to a single Jira Cloud instance, identified by
 *     a `cloudId` returned by `https://api.atlassian.com/oauth/token/accessible-resources`.
 *   - Webhooks expire after 30 days unless refreshed via `PUT .../webhook/refresh`.
 *
 * Our existing `/api/ingest/jira/:tenant` endpoint authenticates via a shared
 * `JIRA_WEBHOOK_BEARER`. After OAuth completes we register a webhook pointing
 * at that endpoint with `:tenant` = the user's id.
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

const ATLASSIAN_API = "https://api.atlassian.com";
const SUBSCRIPTION_KIND_JIRA_HOOK = "jira_webhook";
const RENEWAL_HEADROOM_MIN = 24 * 60; // refresh 24 h before expiry

const DEFAULT_JIRA_EVENTS = [
  "jira:issue_created",
  "jira:issue_updated",
  "jira:issue_deleted",
  "comment_created",
  "comment_updated",
];

interface AccessibleResource {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  avatarUrl?: string;
}

function deliveryUrlForUser(userId: string): string {
  const explicit = (process.env.WEBHOOK_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const base = explicit || config.server.appOrigin.replace(/\/$/, "");
  return `${base}/api/ingest/jira/${encodeURIComponent(userId)}`;
}

async function jiraFetch<T>(
  accessToken: string,
  url: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  };
  if (opts.body) headers["content-type"] = "application/json";
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
    const detail = json?.errorMessages?.join("; ") || json?.message || text.slice(0, 200);
    throw new Error(`jira ${opts.method ?? "GET"} ${url} failed: ${res.status} ${detail}`);
  }
  return json as T;
}

export async function fetchJiraAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
  return jiraFetch<AccessibleResource[]>(
    accessToken,
    `${ATLASSIAN_API}/oauth/token/accessible-resources`,
  );
}

export async function fetchJiraSelf(
  accessToken: string,
  cloudId: string,
): Promise<{ accountId: string; emailAddress?: string; displayName?: string }> {
  return jiraFetch(
    accessToken,
    `${ATLASSIAN_API}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/myself`,
  );
}

interface JiraWebhookCreateResponse {
  webhookRegistrationResult: {
    createdWebhookId?: number;
    errors?: string[];
  }[];
}

export async function createJiraWebhook(
  accessToken: string,
  cloudId: string,
  deliveryUrl: string,
): Promise<{ webhookId: number; expiresAt: string }> {
  /**
   * Jira requires a `jqlFilter` per webhook. We use `project is not empty` to
   * subscribe to all projects the user can access.
   */
  const body = {
    url: deliveryUrl,
    webhooks: [
      {
        events: DEFAULT_JIRA_EVENTS,
        jqlFilter: "project is not empty",
      },
    ],
  };
  const result = await jiraFetch<JiraWebhookCreateResponse>(
    accessToken,
    `${ATLASSIAN_API}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/webhook`,
    { method: "POST", body },
  );
  const first = result.webhookRegistrationResult?.[0];
  if (!first?.createdWebhookId) {
    throw new Error(
      `jira webhook create returned no id: ${JSON.stringify(result.webhookRegistrationResult ?? {})}`,
    );
  }
  /** Jira webhooks expire after 30 days. */
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return { webhookId: first.createdWebhookId, expiresAt };
}

export async function refreshJiraWebhook(
  accessToken: string,
  cloudId: string,
  webhookId: number,
): Promise<string> {
  await jiraFetch(
    accessToken,
    `${ATLASSIAN_API}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/webhook/refresh`,
    { method: "PUT", body: { webhookIds: [webhookId] } },
  );
  /** Refresh extends by 30 days. */
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

export async function deleteJiraWebhook(
  accessToken: string,
  cloudId: string,
  webhookId: number,
): Promise<void> {
  try {
    await jiraFetch(
      accessToken,
      `${ATLASSIAN_API}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/webhook`,
      { method: "DELETE", body: { webhookIds: [webhookId] } },
    );
  } catch (err) {
    if (!String((err as Error).message).match(/\b404\b/)) throw err;
  }
}

export interface JiraWebhookRow {
  rowId: string;
  cloudId: string;
  webhookId: number;
  expiresAt: string;
  url: string;
}

function parseMeta(raw: string | null): { cloudId?: string; cloudUrl?: string } {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function listJiraWebhooks(connectionId: string): JiraWebhookRow[] {
  const subs = db.listOAuthSubscriptions(connectionId);
  return subs
    .filter((s: any) => s.kind === SUBSCRIPTION_KIND_JIRA_HOOK)
    .map((s: any) => {
      const meta = parseMeta(s.meta);
      return {
        rowId: s.id,
        cloudId: meta.cloudId || "",
        webhookId: Number(s.external_subscription_id),
        expiresAt: s.expires_at || "",
        url: s.external_resource || "",
      };
    });
}

// =========================================================================
// Lifecycle hooks
// =========================================================================

async function afterJiraConnect(connection: LiveConnection): Promise<void> {
  let resources: AccessibleResource[] = [];
  try {
    resources = await fetchJiraAccessibleResources(connection.accessToken);
  } catch (err) {
    console.warn("[jira] accessible-resources lookup failed:", (err as Error).message);
    return;
  }
  if (!resources.length) {
    console.warn("[jira] OAuth completed but user has no accessible Jira sites.");
    return;
  }

  /**
   * Use the first accessible site as the canonical workspace. Multi-site
   * tenants will need a future per-site picker; for now we capture all.
   */
  const primary = resources[0];
  try {
    const me = await fetchJiraSelf(connection.accessToken, primary.id);
    db.rawRun(
      `UPDATE oauth_connections
       SET external_user_id = ?,
           external_team_id = COALESCE(NULLIF(external_team_id,''), ?),
           external_team_name = COALESCE(external_team_name, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [me.accountId, primary.id, primary.name || "Jira", connection.id],
    );
  } catch (err) {
    console.warn("[jira] /myself lookup failed:", (err as Error).message);
  }

  for (const site of resources) {
    try {
      const url = deliveryUrlForUser(connection.userId);
      const created = await createJiraWebhook(connection.accessToken, site.id, url);
      db.upsertOAuthSubscription({
        connectionId: connection.id,
        userId: connection.userId,
        provider: "jira",
        kind: SUBSCRIPTION_KIND_JIRA_HOOK,
        externalResource: url,
        externalSubscriptionId: String(created.webhookId),
        expiresAt: created.expiresAt,
        meta: JSON.stringify({ cloudId: site.id, cloudUrl: site.url }),
      });
    } catch (err) {
      console.warn(
        `[jira] webhook auto-create for site ${site.id} failed:`,
        (err as Error).message,
      );
    }
  }
}

async function beforeJiraDisconnect(connection: LiveConnection): Promise<void> {
  const rows = listJiraWebhooks(connection.id);
  for (const row of rows) {
    if (row.cloudId && row.webhookId) {
      try {
        await deleteJiraWebhook(connection.accessToken, row.cloudId, row.webhookId);
      } catch (err) {
        console.warn(
          `[jira] webhook ${row.webhookId} cleanup failed:`,
          (err as Error).message,
        );
      }
    }
    db.deleteOAuthSubscription(row.rowId);
  }
}

let registered = false;
export function registerJiraLifecycleHooks(): void {
  if (registered) return;
  registered = true;
  registerAfterConnect("jira", afterJiraConnect);
  registerBeforeDisconnect("jira", beforeJiraDisconnect);
}

// =========================================================================
// Renewal worker (Jira webhooks expire every 30 days)
// =========================================================================

let renewalTimer: NodeJS.Timeout | null = null;

async function renewalTick(): Promise<void> {
  const due = db.listOAuthSubscriptionsDueForRenewal(RENEWAL_HEADROOM_MIN);
  for (const row of due) {
    if (row.provider !== "jira" || row.kind !== SUBSCRIPTION_KIND_JIRA_HOOK) continue;
    const connection = await getLiveConnection(row.user_id, "jira");
    if (!connection) {
      db.deleteOAuthSubscription(row.id);
      continue;
    }
    const meta = parseMeta(row.meta);
    if (!meta.cloudId) {
      db.deleteOAuthSubscription(row.id);
      continue;
    }
    try {
      const next = await refreshJiraWebhook(
        connection.accessToken,
        meta.cloudId,
        Number(row.external_subscription_id),
      );
      db.upsertOAuthSubscription({
        connectionId: row.connection_id,
        userId: row.user_id,
        provider: "jira",
        kind: SUBSCRIPTION_KIND_JIRA_HOOK,
        externalResource: row.external_resource,
        externalSubscriptionId: row.external_subscription_id,
        expiresAt: next,
        meta: row.meta,
      });
    } catch (err) {
      console.warn(`[jira.renew] webhook ${row.external_subscription_id} renew failed:`, (err as Error).message);
    }
  }
}

export function startJiraRenewalWorker(): void {
  if (renewalTimer) return;
  void renewalTick().catch(() => undefined);
  /** Once an hour is plenty for a 30-day expiry. */
  renewalTimer = setInterval(() => {
    void renewalTick().catch(() => undefined);
  }, 60 * 60_000);
  if (typeof (renewalTimer as any).unref === "function") (renewalTimer as any).unref();
}

export function stopJiraRenewalWorker(): void {
  if (renewalTimer) {
    clearInterval(renewalTimer);
    renewalTimer = null;
  }
}

export async function getJiraConnection(userId: string): Promise<LiveConnection | null> {
  return getLiveConnection(userId, "jira");
}

export async function getJiraAccessToken(userId: string): Promise<string | null> {
  return getLiveAccessToken(userId, "jira");
}
