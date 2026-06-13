/**
 * Google connector — Calendar (push notifications) + Gmail (history poll).
 *
 * One OAuth client, two surfaces, **zero GCP infrastructure**:
 *   - Calendar uses `events.watch` push channels (no Pub/Sub topic needed).
 *     Channels expire every ~24 h; the renewal worker stops + recreates them.
 *   - Gmail uses `users.history.list` polling instead of `users.watch` so we
 *     don't have to create a Pub/Sub topic in the customer's GCP project.
 *     This keeps onboarding to a single OAuth consent screen.
 *
 * State lives in `oauth_subscriptions`:
 *   - kind=calendar_watch — { calendarId, syncToken, channelId, resourceId, channelToken }
 *   - kind=gmail_poll     — { startHistoryId, fromAllowlist[] }
 */

import crypto from "crypto";

import { db } from "../database.js";
import { config } from "../config.js";
import {
  getLiveConnection,
  type LiveConnection,
} from "../auth/oauthConnections.js";
import {
  registerAfterConnect,
  registerBeforeDisconnect,
} from "../auth/oauthLifecycle.js";
import { ingestExternalBatch } from "./ingestRouter.js";
import {
  transformGmailMessage,
  transformGoogleCalendarEvent,
} from "./webhookTransforms.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
export const SUBSCRIPTION_KIND_CAL_WATCH = "calendar_watch";
export const SUBSCRIPTION_KIND_GMAIL_POLL = "gmail_poll";

const CAL_RENEWAL_HEADROOM_MIN = 60; // recreate calendar channel 1 h before expiry
const GMAIL_POLL_INTERVAL_MS = 5 * 60_000;

// =========================================================================
// Common helpers
// =========================================================================

export function googleNotificationUrl(): string {
  const explicit = (process.env.WEBHOOK_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const base = explicit || config.server.appOrigin.replace(/\/$/, "");
  return `${base}/api/ingest/google/calendar`;
}

async function googleFetch<T>(
  accessToken: string,
  url: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const u = new URL(url);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null) u.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  };
  if (opts.body) headers["content-type"] = "application/json";
  const res = await fetch(u, {
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
    throw new Error(`google ${opts.method ?? "GET"} ${url} failed: ${res.status} ${detail}`);
  }
  return json as T;
}

interface GoogleUserInfo {
  email: string;
  sub: string;
  name?: string;
  hd?: string;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  return googleFetch<GoogleUserInfo>(
    accessToken,
    "https://openidconnect.googleapis.com/v1/userinfo",
  );
}

// =========================================================================
// Calendar — events.watch + syncToken rotation
// =========================================================================

interface CalendarWatchMeta {
  calendarId: string;
  channelId: string;
  resourceId: string;
  channelToken: string;
  syncToken: string;
}

interface CalendarChannelResponse {
  id: string;
  resourceId: string;
  resourceUri: string;
  expiration: string;
}

interface CalendarEventsListResponse {
  items: Record<string, unknown>[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

function parseMeta<T>(raw: string | null): Partial<T> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Initial sync — fetches everything once, captures `nextSyncToken` for incremental polling. */
async function bootstrapCalendarSyncToken(accessToken: string, calendarId: string): Promise<string> {
  let pageToken: string | undefined;
  let syncToken: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const result: CalendarEventsListResponse = await googleFetch(
      accessToken,
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        query: {
          singleEvents: "true",
          showDeleted: "true",
          maxResults: 250,
          pageToken,
          /** Skip the past — we only need a baseline. */
          timeMin: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
        },
      },
    );
    if (result.nextSyncToken) {
      syncToken = result.nextSyncToken;
      break;
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  if (!syncToken) {
    throw new Error("calendar bootstrap: never received nextSyncToken");
  }
  return syncToken;
}

async function startCalendarWatchChannel(
  accessToken: string,
  calendarId: string,
): Promise<{ channelId: string; resourceId: string; channelToken: string; expiresAt: string }> {
  const channelId = crypto.randomUUID();
  const channelToken = crypto.randomBytes(24).toString("hex");
  const result = await googleFetch<CalendarChannelResponse>(
    accessToken,
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      body: {
        id: channelId,
        type: "web_hook",
        address: googleNotificationUrl(),
        token: channelToken,
        params: { ttl: String(60 * 60 * 24) }, // 24 h
      },
    },
  );
  const expiresAt = new Date(Number(result.expiration)).toISOString();
  return { channelId: result.id, resourceId: result.resourceId, channelToken, expiresAt };
}

async function stopCalendarChannel(
  accessToken: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  try {
    await googleFetch(accessToken, `${CALENDAR_API}/channels/stop`, {
      method: "POST",
      body: { id: channelId, resourceId },
    });
  } catch (err) {
    /** Already stopped → ignore. */
    if (!String((err as Error).message).match(/\b(404|410)\b/)) throw err;
  }
}

export async function createCalendarSubscription(
  connection: LiveConnection,
  calendarId: string = "primary",
): Promise<void> {
  const syncToken = await bootstrapCalendarSyncToken(connection.accessToken, calendarId);
  const channel = await startCalendarWatchChannel(connection.accessToken, calendarId);
  const meta: CalendarWatchMeta = {
    calendarId,
    channelId: channel.channelId,
    resourceId: channel.resourceId,
    channelToken: channel.channelToken,
    syncToken,
  };
  db.upsertOAuthSubscription({
    connectionId: connection.id,
    userId: connection.userId,
    provider: "google",
    kind: SUBSCRIPTION_KIND_CAL_WATCH,
    externalResource: `calendar:${calendarId}`,
    externalSubscriptionId: channel.channelId,
    expiresAt: channel.expiresAt,
    meta: JSON.stringify(meta),
  });
}

export async function deleteCalendarSubscription(connection: LiveConnection): Promise<void> {
  const subs = db
    .listOAuthSubscriptions(connection.id)
    .filter((s: any) => s.kind === SUBSCRIPTION_KIND_CAL_WATCH);
  for (const s of subs) {
    const meta = parseMeta<CalendarWatchMeta>(s.meta);
    if (meta.channelId && meta.resourceId) {
      try {
        await stopCalendarChannel(connection.accessToken, meta.channelId, meta.resourceId);
      } catch (err) {
        console.warn(
          `[google.calendar] stop channel ${meta.channelId} failed:`,
          (err as Error).message,
        );
      }
    }
    db.deleteOAuthSubscription(s.id);
  }
}

/** Called by webhook handler after a push notification arrives. */
export async function pollCalendarChanges(
  userId: string,
  channelId: string,
): Promise<void> {
  const row = (db.rawGet(
    `SELECT s.id, s.meta, s.connection_id
     FROM oauth_subscriptions s
     WHERE s.provider = 'google' AND s.kind = ? AND s.external_subscription_id = ?
     LIMIT 1`,
    [SUBSCRIPTION_KIND_CAL_WATCH, channelId],
  ) as any[])[0];
  if (!row) return;
  const meta = parseMeta<CalendarWatchMeta>(row.meta);
  if (!meta.calendarId || !meta.syncToken) return;

  const connection = await getLiveConnection(userId, "google");
  if (!connection) return;

  const userInfo = await fetchGoogleUserInfo(connection.accessToken).catch(() => null);
  const accountEmail = userInfo?.email || connection.externalTeamId || "google:unknown";

  let pageToken: string | undefined;
  let nextSync: string | undefined = meta.syncToken;
  for (let i = 0; i < 10; i += 1) {
    let result: CalendarEventsListResponse;
    try {
      result = await googleFetch<CalendarEventsListResponse>(
        connection.accessToken,
        `${CALENDAR_API}/calendars/${encodeURIComponent(meta.calendarId)}/events`,
        { query: { syncToken: nextSync, pageToken } },
      );
    } catch (err) {
      /** 410 Gone = sync token expired; rebootstrap. */
      if (/\b410\b/.test((err as Error).message)) {
        nextSync = await bootstrapCalendarSyncToken(connection.accessToken, meta.calendarId);
        break;
      }
      throw err;
    }
    const records = (result.items || []).flatMap((event) =>
      transformGoogleCalendarEvent(event, {
        userId,
        accountEmail,
        partition: channelId,
      }),
    );
    if (records.length) {
      try {
        ingestExternalBatch(records);
      } catch (err) {
        console.warn("[google.calendar] ingest failed:", (err as Error).message);
      }
    }
    if (result.nextSyncToken) {
      nextSync = result.nextSyncToken;
      break;
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }

  /** Persist the new sync token so next push picks up where we left off. */
  if (nextSync && nextSync !== meta.syncToken) {
    const updatedMeta: CalendarWatchMeta = { ...(meta as CalendarWatchMeta), syncToken: nextSync };
    db.upsertOAuthSubscription({
      connectionId: row.connection_id,
      userId,
      provider: "google",
      kind: SUBSCRIPTION_KIND_CAL_WATCH,
      externalResource: `calendar:${meta.calendarId}`,
      externalSubscriptionId: channelId,
      /** Don't overwrite expiresAt — channel's own clock controls renewal. */
      expiresAt: undefined,
      meta: JSON.stringify(updatedMeta),
    });
  }
}

export function findCalendarSubscriptionForChannel(
  channelId: string,
): { userId: string; channelToken: string } | null {
  const row = (db.rawGet(
    `SELECT user_id, meta FROM oauth_subscriptions
     WHERE provider = 'google' AND kind = ? AND external_subscription_id = ?
     LIMIT 1`,
    [SUBSCRIPTION_KIND_CAL_WATCH, channelId],
  ) as any[])[0];
  if (!row) return null;
  const meta = parseMeta<CalendarWatchMeta>(row.meta);
  return { userId: row.user_id, channelToken: meta.channelToken || "" };
}

// =========================================================================
// Gmail — historyId polling
// =========================================================================

interface GmailPollMeta {
  startHistoryId: string;
  fromAllowlist: string[];
}

export async function bootstrapGmailPoll(connection: LiveConnection): Promise<void> {
  const profile = await googleFetch<{ emailAddress: string; historyId: string }>(
    connection.accessToken,
    `${GMAIL_API}/users/me/profile`,
  );
  const meta: GmailPollMeta = {
    startHistoryId: profile.historyId,
    fromAllowlist: [],
  };
  db.upsertOAuthSubscription({
    connectionId: connection.id,
    userId: connection.userId,
    provider: "google",
    kind: SUBSCRIPTION_KIND_GMAIL_POLL,
    externalResource: `gmail:${profile.emailAddress}`,
    externalSubscriptionId: profile.emailAddress,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    meta: JSON.stringify(meta),
  });
}

export function setGmailFromAllowlist(connectionId: string, allowlist: string[]): boolean {
  const subs = db.listOAuthSubscriptions(connectionId);
  const match = subs.find((s: any) => s.kind === SUBSCRIPTION_KIND_GMAIL_POLL);
  if (!match) return false;
  const meta = parseMeta<GmailPollMeta>(match.meta);
  const cleaned = Array.from(
    new Set(allowlist.map((d) => d.trim().toLowerCase()).filter((d) => d.length && /\./.test(d))),
  );
  db.upsertOAuthSubscription({
    connectionId,
    userId: match.user_id,
    provider: "google",
    kind: SUBSCRIPTION_KIND_GMAIL_POLL,
    externalResource: match.external_resource,
    externalSubscriptionId: match.external_subscription_id,
    expiresAt: undefined,
    meta: JSON.stringify({
      startHistoryId: meta.startHistoryId || "0",
      fromAllowlist: cleaned,
    }),
  });
  return true;
}

export function getGmailAllowlist(connectionId: string): string[] {
  const subs = db.listOAuthSubscriptions(connectionId);
  const match = subs.find((s: any) => s.kind === SUBSCRIPTION_KIND_GMAIL_POLL);
  if (!match) return [];
  const meta = parseMeta<GmailPollMeta>(match.meta);
  return meta.fromAllowlist || [];
}

interface GmailHistoryResponse {
  history?: {
    id: string;
    messagesAdded?: { message: { id: string; threadId: string } }[];
  }[];
  nextPageToken?: string;
  historyId?: string;
}

async function pollGmailForConnection(connection: LiveConnection): Promise<number> {
  const subs = db.listOAuthSubscriptions(connection.id);
  const row = subs.find((s: any) => s.kind === SUBSCRIPTION_KIND_GMAIL_POLL);
  if (!row) return 0;
  const meta = parseMeta<GmailPollMeta>(row.meta);
  if (!meta.startHistoryId) return 0;

  const userInfo = await fetchGoogleUserInfo(connection.accessToken).catch(() => null);
  const accountEmail = userInfo?.email || connection.externalTeamId || "";

  const seenMessageIds = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = meta.startHistoryId;

  for (let i = 0; i < 10; i += 1) {
    let history: GmailHistoryResponse;
    try {
      history = await googleFetch<GmailHistoryResponse>(
        connection.accessToken,
        `${GMAIL_API}/users/me/history`,
        {
          query: {
            startHistoryId: meta.startHistoryId,
            historyTypes: "messageAdded",
            pageToken,
            maxResults: 500,
          },
        },
      );
    } catch (err) {
      /** 404 → historyId too old; rebootstrap. */
      if (/\b404\b/.test((err as Error).message)) {
        const profile = await googleFetch<{ historyId: string }>(
          connection.accessToken,
          `${GMAIL_API}/users/me/profile`,
        );
        latestHistoryId = profile.historyId;
        break;
      }
      throw err;
    }
    for (const h of history.history || []) {
      if (h.id && Number(h.id) > Number(latestHistoryId)) latestHistoryId = h.id;
      for (const added of h.messagesAdded || []) {
        seenMessageIds.add(added.message.id);
      }
    }
    pageToken = history.nextPageToken;
    if (history.historyId && Number(history.historyId) > Number(latestHistoryId)) {
      latestHistoryId = history.historyId;
    }
    if (!pageToken) break;
  }

  if (seenMessageIds.size === 0) {
    persistGmailMeta(connection, latestHistoryId, meta.fromAllowlist || []);
    return 0;
  }

  const records: ReturnType<typeof transformGmailMessage> = [];
  for (const messageId of seenMessageIds) {
    try {
      const message = await googleFetch<Record<string, unknown>>(
        connection.accessToken,
        `${GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}`,
        { query: { format: "metadata", metadataHeaders: "From,To,Subject" } },
      );
      records.push(
        ...transformGmailMessage(message, {
          userId: connection.userId,
          accountEmail,
          partition: latestHistoryId,
          fromAllowlist: meta.fromAllowlist || [],
        }),
      );
    } catch (err) {
      console.warn(
        `[google.gmail] fetch message ${messageId} failed:`,
        (err as Error).message,
      );
    }
  }
  if (records.length) {
    try {
      ingestExternalBatch(records);
    } catch (err) {
      console.warn("[google.gmail] ingest failed:", (err as Error).message);
    }
  }
  persistGmailMeta(connection, latestHistoryId, meta.fromAllowlist || []);
  return records.length;
}

function persistGmailMeta(connection: LiveConnection, historyId: string, allow: string[]): void {
  const subs = db.listOAuthSubscriptions(connection.id);
  const row = subs.find((s: any) => s.kind === SUBSCRIPTION_KIND_GMAIL_POLL);
  if (!row) return;
  db.upsertOAuthSubscription({
    connectionId: connection.id,
    userId: connection.userId,
    provider: "google",
    kind: SUBSCRIPTION_KIND_GMAIL_POLL,
    externalResource: row.external_resource,
    externalSubscriptionId: row.external_subscription_id,
    expiresAt: undefined,
    meta: JSON.stringify({ startHistoryId: historyId, fromAllowlist: allow }),
  });
}

// =========================================================================
// Lifecycle hooks
// =========================================================================

async function afterGoogleConnect(connection: LiveConnection): Promise<void> {
  let userInfo: GoogleUserInfo | null = null;
  try {
    userInfo = await fetchGoogleUserInfo(connection.accessToken);
  } catch (err) {
    console.warn("[google] userinfo lookup failed:", (err as Error).message);
  }
  if (userInfo) {
    db.rawRun(
      `UPDATE oauth_connections
       SET external_user_id = ?,
           external_team_id = COALESCE(NULLIF(external_team_id,''), ?),
           external_team_name = COALESCE(external_team_name, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        userInfo.sub,
        userInfo.email,
        userInfo.hd || userInfo.name || userInfo.email,
        connection.id,
      ],
    );
  }
  /** Best-effort scaffolding; user can retry from Settings if either fails. */
  try {
    await createCalendarSubscription(connection);
  } catch (err) {
    console.warn("[google.calendar] watch setup failed:", (err as Error).message);
  }
  try {
    await bootstrapGmailPoll(connection);
  } catch (err) {
    console.warn("[google.gmail] poll bootstrap failed:", (err as Error).message);
  }
}

async function beforeGoogleDisconnect(connection: LiveConnection): Promise<void> {
  await deleteCalendarSubscription(connection);
  const subs = db.listOAuthSubscriptions(connection.id);
  for (const s of subs) {
    if (s.kind === SUBSCRIPTION_KIND_GMAIL_POLL) db.deleteOAuthSubscription(s.id);
  }
}

let registered = false;
export function registerGoogleLifecycleHooks(): void {
  if (registered) return;
  registered = true;
  registerAfterConnect("google", afterGoogleConnect);
  registerBeforeDisconnect("google", beforeGoogleDisconnect);
}

// =========================================================================
// Workers
// =========================================================================

let calRenewalTimer: NodeJS.Timeout | null = null;
let gmailPollTimer: NodeJS.Timeout | null = null;

async function calRenewalTick(): Promise<void> {
  const due = db.listOAuthSubscriptionsDueForRenewal(CAL_RENEWAL_HEADROOM_MIN);
  for (const row of due) {
    if (row.provider !== "google" || row.kind !== SUBSCRIPTION_KIND_CAL_WATCH) continue;
    const connection = await getLiveConnection(row.user_id, "google");
    if (!connection) {
      db.deleteOAuthSubscription(row.id);
      continue;
    }
    const meta = parseMeta<CalendarWatchMeta>(row.meta);
    if (!meta.calendarId) continue;
    try {
      /** Stop the old channel, then create a new one (Google channels can't be PATCHed). */
      if (meta.channelId && meta.resourceId) {
        await stopCalendarChannel(connection.accessToken, meta.channelId, meta.resourceId);
      }
      const channel = await startCalendarWatchChannel(connection.accessToken, meta.calendarId);
      db.upsertOAuthSubscription({
        connectionId: row.connection_id,
        userId: row.user_id,
        provider: "google",
        kind: SUBSCRIPTION_KIND_CAL_WATCH,
        externalResource: row.external_resource,
        externalSubscriptionId: channel.channelId,
        expiresAt: channel.expiresAt,
        meta: JSON.stringify({
          calendarId: meta.calendarId,
          channelId: channel.channelId,
          resourceId: channel.resourceId,
          channelToken: channel.channelToken,
          syncToken: meta.syncToken || "",
        }),
      });
    } catch (err) {
      console.warn(
        `[google.calendar.renew] tenant ${row.user_id} renewal failed:`,
        (err as Error).message,
      );
    }
  }
}

async function gmailPollTick(): Promise<void> {
  const rows = db.rawGet(
    `SELECT c.user_id
     FROM oauth_connections c
     JOIN oauth_subscriptions s ON s.connection_id = c.id
     WHERE c.provider = 'google' AND s.kind = ? AND c.revoked_at IS NULL`,
    [SUBSCRIPTION_KIND_GMAIL_POLL],
  ) as { user_id: string }[];
  for (const row of rows || []) {
    const conn = await getLiveConnection(row.user_id, "google");
    if (!conn) continue;
    try {
      await pollGmailForConnection(conn);
    } catch (err) {
      console.warn(
        `[google.gmail.poll] tenant ${row.user_id} failed:`,
        (err as Error).message,
      );
    }
  }
}

export function startGoogleWorkers(): void {
  if (!calRenewalTimer) {
    void calRenewalTick().catch(() => undefined);
    calRenewalTimer = setInterval(() => {
      void calRenewalTick().catch(() => undefined);
    }, 30 * 60_000);
    if (typeof (calRenewalTimer as any).unref === "function") (calRenewalTimer as any).unref();
  }
  if (!gmailPollTimer) {
    void gmailPollTick().catch(() => undefined);
    gmailPollTimer = setInterval(() => {
      void gmailPollTick().catch(() => undefined);
    }, GMAIL_POLL_INTERVAL_MS);
    if (typeof (gmailPollTimer as any).unref === "function") (gmailPollTimer as any).unref();
  }
}

export function stopGoogleWorkers(): void {
  if (calRenewalTimer) {
    clearInterval(calRenewalTimer);
    calRenewalTimer = null;
  }
  if (gmailPollTimer) {
    clearInterval(gmailPollTimer);
    gmailPollTimer = null;
  }
}

export async function getGoogleConnection(userId: string): Promise<LiveConnection | null> {
  return getLiveConnection(userId, "google");
}
