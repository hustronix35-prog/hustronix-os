/**
 * Notion connector — OAuth + 5-minute poller.
 *
 * Notion has no webhooks (as of writing). Instead we poll
 * `POST /v1/search` with a `last_edited_time` sort and a stored cursor; any
 * page edited since the cursor moves through `transformNotionPage` and into
 * the ingest router.
 *
 * Cursor lives in `oauth_subscriptions.meta.lastSyncIso` so we get the same
 * lifecycle (connect → start polling, disconnect → stop polling) as
 * webhook-based providers.
 */

import { db } from "../database.js";
import {
  getLiveConnection,
  type LiveConnection,
} from "../auth/oauthConnections.js";
import {
  registerAfterConnect,
  registerBeforeDisconnect,
} from "../auth/oauthLifecycle.js";
import { ingestExternalBatch } from "./ingestRouter.js";
import { transformNotionPage } from "./webhookTransforms.js";

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const SUBSCRIPTION_KIND_NOTION_POLL = "notion_poll";

interface NotionUser {
  id: string;
  name?: string;
  bot?: { workspace_name?: string };
}

interface NotionSearchResponse {
  object: "list";
  results: Record<string, unknown>[];
  next_cursor: string | null;
  has_more: boolean;
}

async function notionFetch<T>(
  accessToken: string,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "notion-version": NOTION_VERSION,
    accept: "application/json",
  };
  if (opts.body) headers["content-type"] = "application/json";
  const res = await fetch(`${NOTION_BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail = json?.message || text.slice(0, 200);
    throw new Error(`notion ${opts.method ?? "GET"} ${path} failed: ${res.status} ${detail}`);
  }
  return json as T;
}

export async function fetchNotionMe(accessToken: string): Promise<NotionUser> {
  return notionFetch<NotionUser>(accessToken, "/users/me");
}

interface PollState {
  rowId: string;
  workspaceId: string;
  workspaceName: string;
  lastSyncIso: string;
}

function parsePollMeta(raw: string | null): { workspaceName?: string; lastSyncIso?: string } {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function pollStateFor(connectionId: string): PollState | null {
  const subs = db.listOAuthSubscriptions(connectionId);
  const match = subs.find((s: any) => s.kind === SUBSCRIPTION_KIND_NOTION_POLL);
  if (!match) return null;
  const meta = parsePollMeta(match.meta);
  return {
    rowId: match.id,
    workspaceId: match.external_subscription_id || "",
    workspaceName: meta.workspaceName || "Notion",
    lastSyncIso: meta.lastSyncIso || "1970-01-01T00:00:00.000Z",
  };
}

function savePollState(state: PollState, userId: string, connectionId: string): void {
  db.upsertOAuthSubscription({
    connectionId,
    userId,
    provider: "notion",
    kind: SUBSCRIPTION_KIND_NOTION_POLL,
    externalResource: "notion://poll",
    externalSubscriptionId: state.workspaceId,
    /** Far-future expiry — polls don't really expire, but we want the renewal worker to ignore it. */
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    meta: JSON.stringify({
      workspaceName: state.workspaceName,
      lastSyncIso: state.lastSyncIso,
    }),
  });
}

/**
 * Run the search and return everything edited after `sinceIso`. Pagination
 * stops as soon as we see an entry older than the cursor (search is sorted
 * `last_edited_time` DESC).
 */
async function fetchEditsSince(
  accessToken: string,
  sinceIso: string,
): Promise<Record<string, unknown>[]> {
  const collected: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  /** Hard cap to avoid unbounded paging; 5 pages = 500 results. */
  for (let page = 0; page < 5; page += 1) {
    const body: Record<string, unknown> = {
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;
    const result = await notionFetch<NotionSearchResponse>(accessToken, "/search", {
      method: "POST",
      body,
    });
    const olderThanCursorIdx = result.results.findIndex(
      (r) => String(r.last_edited_time || "") <= sinceIso,
    );
    if (olderThanCursorIdx === -1) {
      collected.push(...result.results);
      if (!result.has_more || !result.next_cursor) break;
      cursor = result.next_cursor;
    } else {
      collected.push(...result.results.slice(0, olderThanCursorIdx));
      break;
    }
  }
  return collected;
}

export async function pollNotionWorkspace(connection: LiveConnection): Promise<number> {
  const state = pollStateFor(connection.id);
  if (!state) return 0;

  const items = await fetchEditsSince(connection.accessToken, state.lastSyncIso);
  if (!items.length) return 0;

  /** Update cursor to the newest item we've seen (results are DESC). */
  const newest = String(items[0].last_edited_time || state.lastSyncIso);
  const records = items.flatMap((item) =>
    transformNotionPage(item, {
      userId: connection.userId,
      workspaceId: state.workspaceId,
      workspaceName: state.workspaceName,
    }),
  );
  if (records.length) {
    try {
      ingestExternalBatch(records);
    } catch (err) {
      console.warn("[notion] ingestExternalBatch failed:", (err as Error).message);
    }
  }

  savePollState(
    { ...state, lastSyncIso: newest },
    connection.userId,
    connection.id,
  );
  return records.length;
}

// =========================================================================
// Lifecycle hooks
// =========================================================================

async function afterNotionConnect(connection: LiveConnection): Promise<void> {
  let user: NotionUser | null = null;
  try {
    user = await fetchNotionMe(connection.accessToken);
  } catch (err) {
    console.warn("[notion] /users/me lookup failed:", (err as Error).message);
  }
  const workspaceName = user?.bot?.workspace_name || user?.name || "Notion";
  /**
   * Notion's OAuth response carries the workspace id inside the raw token
   * blob; we stash it on `externalTeamId` during connect (oauthRoutes maps the
   * provider's tenantKey field). Fall back to user.id and finally connection
   * id so we always have a non-empty key.
   */
  const workspaceId = connection.externalTeamId || user?.id || connection.id;

  if (user?.id) {
    db.rawRun(
      `UPDATE oauth_connections
       SET external_user_id = ?,
           external_team_id = COALESCE(NULLIF(external_team_id,''), ?),
           external_team_name = COALESCE(external_team_name, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [user.id, workspaceId, workspaceName, connection.id],
    );
  }

  /** Initialize poll state at "now" so we don't blast the auditor with old pages. */
  savePollState(
    {
      rowId: "",
      workspaceId,
      workspaceName,
      lastSyncIso: new Date().toISOString(),
    },
    connection.userId,
    connection.id,
  );
}

async function beforeNotionDisconnect(connection: LiveConnection): Promise<void> {
  const subs = db.listOAuthSubscriptions(connection.id);
  for (const s of subs) {
    if (s.kind === SUBSCRIPTION_KIND_NOTION_POLL) {
      db.deleteOAuthSubscription(s.id);
    }
  }
}

let registered = false;
export function registerNotionLifecycleHooks(): void {
  if (registered) return;
  registered = true;
  registerAfterConnect("notion", afterNotionConnect);
  registerBeforeDisconnect("notion", beforeNotionDisconnect);
}

// =========================================================================
// Poll worker — runs every 5 minutes
// =========================================================================

let pollTimer: NodeJS.Timeout | null = null;

async function pollAll(): Promise<void> {
  /** Find every connection with an active Notion poll state. */
  const rows = db.rawGet(
    `SELECT c.user_id
     FROM oauth_connections c
     JOIN oauth_subscriptions s ON s.connection_id = c.id
     WHERE c.provider = 'notion' AND s.kind = ? AND c.revoked_at IS NULL`,
    [SUBSCRIPTION_KIND_NOTION_POLL],
  ) as { user_id: string }[];

  for (const row of rows || []) {
    const conn = await getLiveConnection(row.user_id, "notion");
    if (!conn) continue;
    try {
      await pollNotionWorkspace(conn);
    } catch (err) {
      console.warn(
        `[notion.poll] tenant ${row.user_id} poll failed:`,
        (err as Error).message,
      );
    }
  }
}

export function startNotionPollWorker(): void {
  if (pollTimer) return;
  void pollAll().catch(() => undefined);
  pollTimer = setInterval(() => {
    void pollAll().catch(() => undefined);
  }, 5 * 60_000);
  if (typeof (pollTimer as any).unref === "function") (pollTimer as any).unref();
}

export function stopNotionPollWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function getNotionConnection(userId: string): Promise<LiveConnection | null> {
  return getLiveConnection(userId, "notion");
}
