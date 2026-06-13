/**
 * GitHub connector.
 *
 * Per-user OAuth flow finishes in `oauthRoutes.ts` and lands here via the
 * lifecycle hooks. Responsibilities:
 *
 *   afterConnect      → call `GET /user` to capture the GitHub login as
 *                       `external_user_id`. We do NOT auto-register webhooks
 *                       here: most users have hundreds of repos and we don't
 *                       want to spam all of them. The Settings UI calls
 *                       `/api/integrations/github/repos/select` to pick.
 *
 *   beforeDisconnect  → walk every webhook we previously registered for this
 *                       connection (recorded in `oauth_subscriptions`) and
 *                       delete them on GitHub's side, then drop our rows.
 *
 *   register/unregister webhook helpers used by the routes module.
 *
 * GitHub webhook payloads continue to flow through `/api/ingest/github/:tenant`
 * (unchanged) — when we register a webhook we set `tenant = userId` in the URL
 * and `secret = GITHUB_WEBHOOK_SECRET`, so the existing HMAC verification +
 * `transformGithubWebhook` path keeps working with zero modification.
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

const GITHUB_API = "https://api.github.com";
const SUBSCRIPTION_KIND_REPO_HOOK = "repo_webhook";
const GITHUB_WEBHOOK_EVENTS = [
  "push",
  "pull_request",
  "pull_request_review",
  "issues",
  "issue_comment",
  "deployment_status",
  "workflow_run",
  "release",
  "create",
  "delete",
] as const;

export interface GithubRepoSummary {
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string | null;
  pushedAt: string | null;
  stars: number;
}

interface GithubUser {
  login: string;
  id: number;
}

interface GithubHook {
  id: number;
  url: string;
  config: { url?: string; content_type?: string; secret?: string };
  events: string[];
  active: boolean;
}

interface GithubRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string | null;
  pushed_at: string | null;
  stargazers_count: number;
  permissions?: { admin?: boolean };
}

// =========================================================================
// Webhook delivery URL
// =========================================================================

/**
 * Public base URL where GitHub will POST webhooks. In production this is the
 * unified app origin; in dev, point `WEBHOOK_PUBLIC_BASE_URL` at an ngrok or
 * cloudflared tunnel so GitHub can reach localhost.
 */
function publicWebhookBase(): string {
  const explicit = (process.env.WEBHOOK_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  return config.server.appOrigin.replace(/\/$/, "");
}

function deliveryUrlForUser(userId: string): string {
  return `${publicWebhookBase()}/api/ingest/github/${encodeURIComponent(userId)}`;
}

// =========================================================================
// Authenticated GitHub API helper
// =========================================================================

interface GithubFetchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Use a 5xx-tolerant retry loop. We default to true for read calls. */
  retry?: boolean;
}

async function githubFetch<T>(
  accessToken: string,
  path: string,
  opts: GithubFetchOptions = {},
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${GITHUB_API}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method: opts.method || "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "hustronix-os",
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  };

  const maxAttempts = opts.retry === false ? 1 : 3;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(url, init);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (res.ok) return json as T;
    /** GitHub abuse / secondary rate limits surface as 403 with a body message. */
    if (res.status >= 500 || res.status === 429 || res.status === 403) {
      lastErr = new Error(
        `github ${opts.method ?? "GET"} ${path} failed: ${res.status} ${json.message || text.slice(0, 160)}`,
      );
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
    }
    throw new Error(
      `github ${opts.method ?? "GET"} ${path} failed: ${res.status} ${json.message || text.slice(0, 160)}`,
    );
  }
  throw lastErr ?? new Error(`github ${path} failed`);
}

// =========================================================================
// API surface used by routes
// =========================================================================

/** Resolve the GitHub login + numeric id behind an access token. */
export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  return githubFetch<GithubUser>(accessToken, "/user");
}

/**
 * List repos the user can administer. We restrict to admin permissions because
 * webhook creation requires that scope; including non-admin repos in the picker
 * would mislead the user into trying to monitor repos they can't.
 */
export async function listAdminRepos(accessToken: string): Promise<GithubRepoSummary[]> {
  const out: GithubRepoSummary[] = [];
  let page = 1;
  /** Cap pagination — beyond a few hundred repos we surface a search box instead of full list. */
  while (page <= 5) {
    const repos = await githubFetch<GithubRepo[]>(accessToken, "/user/repos", {
      query: {
        per_page: 100,
        page,
        sort: "pushed",
        affiliation: "owner,collaborator,organization_member",
      },
    });
    for (const r of repos) {
      if (r.permissions && r.permissions.admin === false) continue;
      out.push({
        fullName: r.full_name,
        name: r.name,
        owner: r.owner.login,
        private: !!r.private,
        defaultBranch: r.default_branch,
        pushedAt: r.pushed_at,
        stars: r.stargazers_count ?? 0,
      });
    }
    if (repos.length < 100) break;
    page += 1;
  }
  return out;
}

async function listRepoHooks(
  accessToken: string,
  repoFullName: string,
): Promise<GithubHook[]> {
  return githubFetch<GithubHook[]>(accessToken, `/repos/${repoFullName}/hooks`, {
    query: { per_page: 100 },
  });
}

async function createRepoHook(
  accessToken: string,
  repoFullName: string,
  deliveryUrl: string,
  secret: string,
): Promise<GithubHook> {
  return githubFetch<GithubHook>(accessToken, `/repos/${repoFullName}/hooks`, {
    method: "POST",
    body: {
      name: "web",
      active: true,
      events: GITHUB_WEBHOOK_EVENTS,
      config: {
        url: deliveryUrl,
        content_type: "json",
        secret,
        insecure_ssl: "0",
      },
    },
    retry: false,
  });
}

async function deleteRepoHook(
  accessToken: string,
  repoFullName: string,
  hookId: number,
): Promise<void> {
  try {
    await githubFetch(accessToken, `/repos/${repoFullName}/hooks/${hookId}`, {
      method: "DELETE",
      retry: false,
    });
  } catch (err) {
    /** 404 = already gone (user may have deleted it manually) — ignore. */
    if (!String((err as Error).message).includes("404")) throw err;
  }
}

// =========================================================================
// Subscription bookkeeping (per-repo webhook lifecycle)
// =========================================================================

function webhookSecret(): string {
  const s = (process.env.GITHUB_WEBHOOK_SECRET || "").trim();
  if (!s) {
    throw new Error(
      "GITHUB_WEBHOOK_SECRET is not set. Generate `openssl rand -hex 32` and add it to .env before connecting GitHub.",
    );
  }
  return s;
}

export interface MonitoredRepo {
  repoFullName: string;
  hookId: number | null;
  registeredAt: string;
  lastRenewedAt: string | null;
}

export function listMonitoredRepos(connectionId: string): MonitoredRepo[] {
  return db
    .listOAuthSubscriptions(connectionId)
    .filter((s: any) => s.kind === SUBSCRIPTION_KIND_REPO_HOOK)
    .map((s: any) => ({
      repoFullName: s.external_resource as string,
      hookId: s.external_subscription_id ? Number(s.external_subscription_id) : null,
      registeredAt: s.created_at as string,
      lastRenewedAt: s.last_renewed_at as string,
    }));
}

/**
 * Register (or re-confirm) a webhook on a repo. Idempotent: if a hook with
 * matching delivery URL already exists, we adopt it instead of creating a duplicate.
 */
export async function registerRepoWebhook(
  connection: LiveConnection,
  repoFullName: string,
): Promise<MonitoredRepo> {
  const secret = webhookSecret();
  const deliveryUrl = deliveryUrlForUser(connection.userId);

  const existing = await listRepoHooks(connection.accessToken, repoFullName).catch(() => []);
  const ours = existing.find((h) => h.config?.url === deliveryUrl);
  let hookId: number;
  if (ours) {
    hookId = ours.id;
  } else {
    const created = await createRepoHook(
      connection.accessToken,
      repoFullName,
      deliveryUrl,
      secret,
    );
    hookId = created.id;
  }

  db.upsertOAuthSubscription({
    connectionId: connection.id,
    userId: connection.userId,
    provider: "github",
    kind: SUBSCRIPTION_KIND_REPO_HOOK,
    externalResource: repoFullName,
    externalSubscriptionId: String(hookId),
    expiresAt: null,
    meta: JSON.stringify({ deliveryUrl }),
  });

  return {
    repoFullName,
    hookId,
    registeredAt: new Date().toISOString(),
    lastRenewedAt: new Date().toISOString(),
  };
}

export async function unregisterRepoWebhook(
  connection: LiveConnection,
  repoFullName: string,
): Promise<void> {
  const subs = db
    .listOAuthSubscriptions(connection.id)
    .filter(
      (s: any) =>
        s.kind === SUBSCRIPTION_KIND_REPO_HOOK && s.external_resource === repoFullName,
    );
  for (const s of subs) {
    if (s.external_subscription_id) {
      await deleteRepoHook(
        connection.accessToken,
        repoFullName,
        Number(s.external_subscription_id),
      );
    }
    db.deleteOAuthSubscription(s.id);
  }
}

// =========================================================================
// Lifecycle hooks
// =========================================================================

async function afterGithubConnect(connection: LiveConnection): Promise<void> {
  try {
    const me = await fetchGithubUser(connection.accessToken);
    /** Persist login as external_user_id; reuse the existing row by re-saving. */
    db.rawRun(
      `UPDATE oauth_connections
       SET external_user_id = ?, external_team_id = COALESCE(NULLIF(external_team_id,''), ?),
           external_team_name = COALESCE(external_team_name, ?), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [me.login, me.login, me.login, connection.id],
    );
  } catch (err) {
    /** Login lookup is non-fatal — repo selection still works without it. */
    console.warn("[github] /user lookup after connect failed:", (err as Error).message);
  }
}

async function beforeGithubDisconnect(connection: LiveConnection): Promise<void> {
  const subs = db
    .listOAuthSubscriptions(connection.id)
    .filter((s: any) => s.kind === SUBSCRIPTION_KIND_REPO_HOOK);
  for (const s of subs) {
    if (s.external_subscription_id) {
      try {
        await deleteRepoHook(
          connection.accessToken,
          s.external_resource as string,
          Number(s.external_subscription_id),
        );
      } catch (err) {
        console.warn(
          `[github] cleanup hook failed for ${s.external_resource}:`,
          (err as Error).message,
        );
      }
    }
  }
}

let registered = false;
export function registerGithubLifecycleHooks(): void {
  if (registered) return;
  registered = true;
  registerAfterConnect("github", afterGithubConnect);
  registerBeforeDisconnect("github", beforeGithubDisconnect);
}

// =========================================================================
// Convenience for routes
// =========================================================================

/** Returns a live GitHub connection or null. */
export async function getGithubConnection(userId: string): Promise<LiveConnection | null> {
  return getLiveConnection(userId, "github");
}

export async function getGithubAccessToken(userId: string): Promise<string | null> {
  return getLiveAccessToken(userId, "github");
}
