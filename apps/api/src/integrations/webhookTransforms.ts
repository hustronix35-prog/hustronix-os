import crypto from "crypto";
import type { IngestRecord } from "./ingestRouter.js";

/**
 * Webhook Transforms — provider payload -> normalized IngestRecord(s).
 *
 * Two responsibilities:
 *   1. Cryptographic verification (HMAC for GitHub, bearer token for Jira/CRM).
 *      We never trust the body before verification.
 *   2. Normalization. Each transformer extracts the operationally relevant
 *      facets and folds them into one or more IngestRecords. We deliberately
 *      DROP everything that isn't operationally relevant (avatars, raw HTML,
 *      noise events) — we are not building a knowledge graph, we are feeding
 *      the auditor.
 *
 * Adding a provider: write `transformXxxWebhook(payload, headers, ctx)` and
 * (if applicable) `verifyXxxSignature`. Mount in `server.ts`.
 */

// =====================================================================
// Common helpers
// =====================================================================

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function trimContent(s: string, max = 1000): string {
  const t = String(s || "").replace(/\r/g, "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// =====================================================================
// GitHub
// =====================================================================

/** Verify `x-hub-signature-256: sha256=…` against the raw request body. */
export function verifyGithubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const m = signatureHeader.match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualHex(`sha256=${digest}`, signatureHeader);
}

interface GhCtx {
  /** The Hustronix tenant that owns this webhook endpoint. */
  userId: string;
  /** `x-github-delivery` header value — used as idempotency key. */
  deliveryId: string;
  /** `x-github-event` header value — used as subtype. */
  event: string;
}

/**
 * GitHub webhook -> IngestRecord[]. Most events fold to a single record;
 * `pull_request` may emit two (open + status) but we keep it to one for now.
 *
 * Operational filter: we ignore noisy events (`star`, `watch`, `fork`,
 * `team_add`, …) that have no enforcement value.
 */
export function transformGithubWebhook(
  payload: Record<string, unknown>,
  ctx: GhCtx,
): IngestRecord[] {
  const event = ctx.event.toLowerCase();
  if (NOISE_GH_EVENTS.has(event)) return [];

  const repo = (payload.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;
  const sender = (payload.sender as Record<string, unknown> | undefined)?.login as string | undefined;
  const action = String(payload.action ?? "");
  const head = `[github:${event}${action ? `.${action}` : ""}] repo=${repo ?? "?"} actor=${sender ?? "?"}`;

  let body = "";
  switch (event) {
    case "push": {
      const commits = (payload.commits as { message?: string; author?: { name?: string } }[]) || [];
      const lines = commits.slice(0, 10).map((c) => `- ${c.message?.split("\n")[0] ?? "(no msg)"} (${c.author?.name ?? "?"})`);
      body = `${commits.length} commit(s) on ${(payload.ref as string) ?? "?"}\n${lines.join("\n")}`;
      break;
    }
    case "pull_request": {
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      body = `PR #${pr?.number ?? "?"} ${action} :: ${pr?.title ?? ""}\n${(pr?.body as string)?.slice(0, 500) ?? ""}`;
      break;
    }
    case "issues": {
      const issue = payload.issue as Record<string, unknown> | undefined;
      body = `Issue #${issue?.number ?? "?"} ${action} :: ${issue?.title ?? ""}\n${(issue?.body as string)?.slice(0, 500) ?? ""}`;
      break;
    }
    case "issue_comment": {
      const comment = payload.comment as Record<string, unknown> | undefined;
      const issue = payload.issue as Record<string, unknown> | undefined;
      body = `Comment on #${issue?.number ?? "?"}: ${(comment?.body as string)?.slice(0, 500) ?? ""}`;
      break;
    }
    case "deployment_status": {
      const ds = payload.deployment_status as Record<string, unknown> | undefined;
      body = `Deployment ${ds?.state ?? "?"} env=${(payload.deployment as Record<string, unknown> | undefined)?.environment ?? "?"}`;
      break;
    }
    case "workflow_run": {
      const wr = payload.workflow_run as Record<string, unknown> | undefined;
      body = `Workflow ${wr?.name ?? "?"} ${wr?.status ?? "?"}/${wr?.conclusion ?? "?"} on ${wr?.head_branch ?? "?"}`;
      break;
    }
    default: {
      body = `(${event}) action=${action}`;
    }
  }

  return [
    {
      provider: "github",
      subtype: `github.${event}${action ? `.${action}` : ""}`,
      userId: ctx.userId,
      tenantKey: repo ?? "",
      content: trimContent(`${head}\n${body}`),
      owner: sender ? `github:${sender}` : "github:unknown",
      externalId: ctx.deliveryId,
      meta: { repo, event, action, sender },
    },
  ];
}

const NOISE_GH_EVENTS = new Set([
  "star",
  "watch",
  "fork",
  "team_add",
  "member",
  "repository_vulnerability_alert",
  "ping",
]);

// =====================================================================
// Jira
// =====================================================================

interface JiraCtx {
  userId: string;
  /** Jira does not provide an HMAC out of the box; we use a bearer secret on the URL/header. */
  bearerSecret: string;
  /** `atl-request-id` or own dedup id; if missing, transformer derives one. */
  deliveryId?: string;
}

/** Compare bearer secret in constant time. */
export function verifyJiraBearer(headerValue: string | undefined, expected: string): boolean {
  if (!expected) return false;
  if (!headerValue) return false;
  const tok = headerValue.replace(/^Bearer\s+/i, "").trim();
  return timingSafeEqualHex(tok, expected);
}

export function transformJiraWebhook(
  payload: Record<string, unknown>,
  ctx: JiraCtx,
): IngestRecord[] {
  const issue = payload.issue as Record<string, unknown> | undefined;
  const fields = (issue?.fields as Record<string, unknown> | undefined) ?? {};
  const eventType = String(payload.webhookEvent ?? "");
  const issueKey = (issue?.key as string) ?? "?";
  const summary = (fields.summary as string) ?? "";
  const status = (fields.status as Record<string, unknown> | undefined)?.name as string | undefined;
  const assignee = (fields.assignee as Record<string, unknown> | undefined)?.emailAddress as string | undefined;
  const reporter = (fields.reporter as Record<string, unknown> | undefined)?.emailAddress as string | undefined;

  const head = `[jira:${eventType}] ${issueKey} status=${status ?? "?"} assignee=${assignee ?? "?"}`;
  const body = `${summary}\n${(fields.description as string)?.slice(0, 500) ?? ""}`;

  return [
    {
      provider: "jira",
      subtype: `jira.${eventType}`,
      userId: ctx.userId,
      tenantKey: issueKey.split("-")[0] ?? "",
      content: trimContent(`${head}\n${body}`),
      owner: assignee ? `jira:${assignee}` : reporter ? `jira:${reporter}` : "jira:unknown",
      externalId: ctx.deliveryId ?? `${issueKey}:${eventType}:${(payload.timestamp as number | string) ?? Date.now()}`,
      meta: { issueKey, eventType, status, assignee, reporter },
    },
  ];
}

// =====================================================================
// Generic CRM (HubSpot/Salesforce/Pipedrive/etc.)
// =====================================================================

interface CrmCtx {
  userId: string;
  bearerSecret: string;
  /** `hubspot.contact.created`, `salesforce.opportunity.updated`, … */
  vendor: string;
}

export function verifyCrmBearer(headerValue: string | undefined, expected: string): boolean {
  return verifyJiraBearer(headerValue, expected);
}

/**
 * Generic CRM transformer. The CRM payload shape differs per vendor; we accept
 * a normalized envelope that the front-door route is responsible for shaping
 * (or vendor-specific handlers can be added). For the common HubSpot
 * `subscriptionType` envelope we pull a few high-signal fields.
 */
export function transformCrmWebhook(
  payload: Record<string, unknown>,
  ctx: CrmCtx,
): IngestRecord[] {
  const records: IngestRecord[] = [];

  /** HubSpot delivers an array; everything else can come through `events` or as a single object. */
  const items: Record<string, unknown>[] = Array.isArray(payload.events)
    ? (payload.events as Record<string, unknown>[])
    : Array.isArray(payload)
      ? (payload as unknown as Record<string, unknown>[])
      : [payload];

  for (const item of items) {
    const subscription = String(item.subscriptionType ?? item.eventType ?? "event");
    const objectId = String(item.objectId ?? item.id ?? "");
    const occurredAt = item.occurredAt
      ? new Date(item.occurredAt as number | string).toISOString()
      : undefined;
    const content = trimContent(
      `[${ctx.vendor}:${subscription}] objectId=${objectId} ${JSON.stringify(item.propertyValue ?? item.changes ?? {}).slice(0, 400)}`,
    );

    records.push({
      provider: ctx.vendor.toLowerCase(),
      subtype: `${ctx.vendor.toLowerCase()}.${subscription}`,
      userId: ctx.userId,
      tenantKey: String(item.portalId ?? item.tenantId ?? ""),
      content,
      owner: `crm:${ctx.vendor.toLowerCase()}:${item.actorId ?? "unknown"}`,
      externalId: `${ctx.vendor}:${objectId}:${item.eventId ?? Date.now()}`,
      detectedAt: occurredAt,
      meta: { vendor: ctx.vendor, subscription, raw: item },
    });
  }

  return records;
}

// =====================================================================
// Linear (issues + comments via webhookCreate-registered hook)
// =====================================================================
//
// Linear delivers a JSON envelope with `action` (create/update/remove),
// `type` (Issue/Comment/Project), `data` (the resource), and signs the body
// with HMAC-SHA256 using the webhook secret returned by `webhookCreate`.

interface LinearCtx {
  userId: string;
  /** Connection-id of the OAuth row, used so per-user webhook secrets are isolated. */
  connectionId: string;
}

export function verifyLinearSignature(
  rawBody: Buffer,
  headerSig: string | undefined,
  secret: string,
): boolean {
  if (!headerSig || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualHex(headerSig, expected);
}

export function transformLinearWebhook(
  payload: Record<string, unknown>,
  ctx: LinearCtx,
): IngestRecord[] {
  const action = String(payload.action || "update");
  const type = String(payload.type || "Issue");
  const data = (payload.data as Record<string, unknown>) || {};
  const id = String(data.id || "");
  if (!id) return [];

  if (type === "Issue") {
    const title = String(data.title || "(untitled)");
    const desc = String(data.description || "").slice(0, 500);
    const state = (data.state as { name?: string } | undefined)?.name;
    const assignee = (data.assignee as { email?: string } | undefined)?.email;
    const team = (data.team as { key?: string } | undefined)?.key;
    return [
      {
        provider: "linear",
        subtype: `linear.issue.${action}`,
        userId: ctx.userId,
        tenantKey: team ?? "",
        content: trimContent(
          `[linear:issue.${action}] ${data.identifier ?? id} state=${state ?? "?"} assignee=${assignee ?? "?"}\nTitle: ${title}\n${desc}`,
        ),
        owner: assignee ? `linear:${assignee}` : "linear:unassigned",
        externalId: `linear:${id}:${action}`,
        meta: {
          issueId: id,
          identifier: data.identifier,
          team,
          state,
          assignee,
          priority: data.priority,
        },
      },
    ];
  }
  if (type === "Comment") {
    const body = String(data.body || "").slice(0, 600);
    const issueId = (data.issue as { id?: string; identifier?: string } | undefined)?.identifier ?? "";
    const user = (data.user as { email?: string } | undefined)?.email;
    return [
      {
        provider: "linear",
        subtype: `linear.comment.${action}`,
        userId: ctx.userId,
        tenantKey: issueId,
        content: trimContent(`[linear:comment.${action}] on ${issueId} by ${user ?? "?"}\n${body}`),
        owner: user ? `linear:${user}` : "linear:unknown",
        externalId: `linear:comment:${id}:${action}`,
        meta: { commentId: id, issueId, user },
      },
    ];
  }
  /** Projects, cycles, etc. — keep a low-fidelity record so the auditor still sees activity. */
  return [
    {
      provider: "linear",
      subtype: `linear.${type.toLowerCase()}.${action}`,
      userId: ctx.userId,
      content: trimContent(`[linear:${type.toLowerCase()}.${action}] ${JSON.stringify(data).slice(0, 400)}`),
      owner: `linear:${type.toLowerCase()}`,
      externalId: `linear:${type}:${id}:${action}`,
      meta: { type, action, id },
    },
  ];
}

// =====================================================================
// Notion (poll-based — Notion API has no webhooks as of this writing)
// =====================================================================
//
// The poll worker calls `/v1/search?sort=last_edited_time` with a stored
// cursor (epoch ms). Each result page row is sent through this transformer.

interface NotionCtx {
  userId: string;
  workspaceId: string;
  workspaceName?: string;
}

export function transformNotionPage(
  page: Record<string, unknown>,
  ctx: NotionCtx,
): IngestRecord[] {
  const id = String(page.id || "");
  if (!id) return [];
  const lastEdited = String(page.last_edited_time || "");
  const editedBy = (page.last_edited_by as { id?: string } | undefined)?.id;
  const objectType = String(page.object || "page");
  /**
   * Title extraction: Notion stores the page title under different paths
   * depending on whether the page belongs to a database or is standalone.
   */
  const title = extractNotionTitle(page) || "(untitled)";
  const url = String(page.url || "");
  return [
    {
      provider: "notion",
      subtype: `notion.${objectType}.updated`,
      userId: ctx.userId,
      tenantKey: ctx.workspaceId,
      content: trimContent(
        `[notion:${objectType}] ${title}\nWorkspace: ${ctx.workspaceName ?? ctx.workspaceId}\nURL: ${url}\nLast edited: ${lastEdited} by ${editedBy ?? "?"}`,
      ),
      owner: editedBy ? `notion:${editedBy}` : "notion:unknown",
      detectedAt: lastEdited || undefined,
      externalId: `notion:${id}:${lastEdited}`,
      meta: {
        pageId: id,
        objectType,
        title,
        url,
        workspaceId: ctx.workspaceId,
        lastEditedBy: editedBy,
      },
    },
  ];
}

function extractNotionTitle(page: Record<string, unknown>): string | null {
  const properties = (page.properties as Record<string, unknown>) || {};
  for (const v of Object.values(properties)) {
    const prop = v as { type?: string; title?: { plain_text?: string }[] };
    if (prop?.type === "title" && Array.isArray(prop.title) && prop.title[0]?.plain_text) {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }
  /** Fallback for non-database pages. */
  const child = (page as any).child_page?.title || (page as any).child_database?.title;
  return typeof child === "string" ? child : null;
}

// =====================================================================
// Google (Calendar + Gmail)
// =====================================================================
//
// Calendar arrives via push notification + syncToken rotation; Gmail via
// historyId polling. The route layer supplies the resolved resource —
// these transformers stay pure.

interface GoogleCtx {
  userId: string;
  /** Google account email or sub for owner attribution. */
  accountEmail: string;
  /** Channel id (calendar) or historyId (gmail) for dedup partitioning. */
  partition: string;
}

export function transformGoogleCalendarEvent(
  event: Record<string, unknown>,
  ctx: GoogleCtx,
): IngestRecord[] {
  const id = String(event.id || "");
  const ical = String(event.iCalUID || "");
  const status = String(event.status || "confirmed");
  const action = status === "cancelled" ? "deleted" : "updated";
  const summary = String(event.summary || "(no title)");
  const description = String(event.description || "").slice(0, 400);
  const start =
    (event.start as { dateTime?: string; date?: string } | undefined)?.dateTime ??
    (event.start as { date?: string } | undefined)?.date ??
    "";
  const end =
    (event.end as { dateTime?: string; date?: string } | undefined)?.dateTime ??
    (event.end as { date?: string } | undefined)?.date ??
    "";
  const organizer = (event.organizer as { email?: string } | undefined)?.email;
  const attendees = ((event.attendees as { email?: string }[] | undefined) || [])
    .map((a) => a.email)
    .filter(Boolean) as string[];

  const head = `[google:calendar.${action}] organizer=${organizer ?? "?"} attendees=${attendees.length}`;
  const body = `Summary: ${summary}\nWhen: ${start} → ${end}\nWith: ${attendees.join(", ")}\n${description}`;
  return [
    {
      provider: "google",
      subtype: `google.calendar.event.${action}`,
      userId: ctx.userId,
      tenantKey: ctx.accountEmail,
      content: trimContent(`${head}\n${body}`),
      owner: organizer ? `google:${organizer}` : `google:${ctx.accountEmail}`,
      detectedAt: String(event.updated || ""),
      externalId: ical
        ? `google:cal:${ical}:${action}`
        : `google:cal:${id}:${action}`,
      meta: {
        eventId: id,
        iCalUID: ical,
        organizer,
        attendees,
        start,
        end,
        status,
      },
    },
  ];
}

interface GmailContext extends GoogleCtx {
  /** Optional from-domain allowlist (lowercase). Empty = ingest all. */
  fromAllowlist?: string[];
}

export function transformGmailMessage(
  message: Record<string, unknown>,
  ctx: GmailContext,
): IngestRecord[] {
  const id = String(message.id || "");
  const threadId = String(message.threadId || "");
  const labels = (message.labelIds as string[] | undefined) || [];
  /** Skip drafts and spam outright. */
  if (labels.includes("DRAFT") || labels.includes("SPAM") || labels.includes("TRASH")) return [];

  const payload = (message.payload as Record<string, unknown>) || {};
  const headers = (payload.headers as { name?: string; value?: string }[] | undefined) || [];
  const headerMap: Record<string, string> = {};
  for (const h of headers) {
    if (h.name && h.value) headerMap[h.name.toLowerCase()] = h.value;
  }
  const subject = headerMap["subject"] || "(no subject)";
  const from = headerMap["from"] || "";
  const to = headerMap["to"] || "";
  const fromAddr = extractEmail(from);
  const fromDomain = fromAddr.split("@")[1]?.toLowerCase() || "";

  if (
    ctx.fromAllowlist &&
    ctx.fromAllowlist.length > 0 &&
    !ctx.fromAllowlist.includes(fromDomain)
  ) {
    return [];
  }

  const snippet = String(message.snippet || "").slice(0, 400);
  const head = `[google:gmail] from=${fromAddr || "?"} to=${extractEmail(to) || "?"} labels=${labels.join(",")}`;
  return [
    {
      provider: "gmail",
      subtype: "google.gmail.message",
      userId: ctx.userId,
      tenantKey: fromDomain || ctx.accountEmail,
      content: trimContent(`${head}\nSubject: ${subject}\n${snippet}`),
      owner: fromAddr ? `gmail:${fromAddr}` : `gmail:${ctx.accountEmail}`,
      detectedAt: undefined,
      externalId: `gmail:${id}`,
      meta: { messageId: id, threadId, from: fromAddr, subject, labels },
    },
  ];
}

function extractEmail(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  return headerValue.trim().toLowerCase();
}

// =====================================================================
// Microsoft Graph (Teams + Outlook Calendar + Outlook Mail)
// =====================================================================
//
// Graph delivers change-notifications as POST envelopes — we already verified
// `clientState` upstream in the route handler, so these functions never run on
// untrusted input. Each transformer accepts the *resolved* resource (the JSON
// the route fetched via `GET <resource>`), not the lightweight notification
// envelope, so the IngestRecord has full context (subject, body, attendees…).

interface MsCtx {
  /** Hustronix tenant that owns the subscription. */
  userId: string;
  /** Graph subscription id — used as part of dedup. */
  subscriptionId: string;
  /** changeType from notification: created / updated / deleted. */
  changeType: string;
}

/**
 * Outlook mail message → signal. We capture sender, subject, plaintext body,
 * and the parent folder. Inboxes are noisy so the route layer applies an
 * allowlist before ever calling this; what reaches us is in-scope.
 */
export function transformOutlookMailMessage(
  message: Record<string, unknown>,
  ctx: MsCtx,
): IngestRecord[] {
  const id = String(message.id || "");
  const from = (message.from as { emailAddress?: { address?: string; name?: string } } | undefined)?.emailAddress;
  const subject = String(message.subject || "(no subject)");
  const preview = String(message.bodyPreview || "");
  const importance = String(message.importance || "normal");
  const head = `[outlook:mail.${ctx.changeType}] from=${from?.address ?? "?"} importance=${importance}`;
  return [
    {
      provider: "microsoft",
      subtype: `microsoft.outlook.mail.${ctx.changeType}`,
      userId: ctx.userId,
      tenantKey: from?.address ?? "",
      content: trimContent(`${head}\nSubject: ${subject}\n${preview}`),
      owner: from?.address ? `outlook:${from.address}` : "outlook:unknown",
      externalId: `${ctx.subscriptionId}:${id}:${ctx.changeType}`,
      meta: {
        messageId: id,
        from: from?.address,
        subject,
        importance,
        conversationId: message.conversationId,
      },
    },
  ];
}

/**
 * Outlook calendar event → signal. We pull subject, time window, and the
 * attendee list. Recurrence master events are kept; series instances are
 * deduped by `iCalUId`.
 */
export function transformOutlookCalendarEvent(
  event: Record<string, unknown>,
  ctx: MsCtx,
): IngestRecord[] {
  const id = String(event.id || "");
  const ical = String(event.iCalUId || "");
  const subject = String(event.subject || "(untitled meeting)");
  const start = (event.start as { dateTime?: string } | undefined)?.dateTime ?? "";
  const end = (event.end as { dateTime?: string } | undefined)?.dateTime ?? "";
  const organizer = (event.organizer as { emailAddress?: { address?: string } } | undefined)
    ?.emailAddress?.address;
  const attendees = (event.attendees as { emailAddress?: { address?: string } }[] | undefined) || [];
  const attendeeAddrs = attendees
    .map((a) => a.emailAddress?.address)
    .filter(Boolean) as string[];
  const head = `[outlook:calendar.${ctx.changeType}] organizer=${organizer ?? "?"} attendees=${attendeeAddrs.length}`;
  const body = `Subject: ${subject}\nWhen: ${start} → ${end}\nWith: ${attendeeAddrs.join(", ")}`;
  return [
    {
      provider: "microsoft",
      subtype: `microsoft.outlook.calendar.${ctx.changeType}`,
      userId: ctx.userId,
      tenantKey: organizer ?? "",
      content: trimContent(`${head}\n${body}`),
      owner: organizer ? `outlook:${organizer}` : "outlook:unknown",
      externalId: ical
        ? `${ctx.subscriptionId}:${ical}:${ctx.changeType}`
        : `${ctx.subscriptionId}:${id}:${ctx.changeType}`,
      meta: {
        eventId: id,
        iCalUId: ical,
        organizer,
        attendees: attendeeAddrs,
        start,
        end,
      },
    },
  ];
}

/**
 * Teams chat or channel message → signal. Strips HTML to plaintext snippet.
 */
export function transformMsTeamsMessage(
  msg: Record<string, unknown>,
  ctx: MsCtx,
): IngestRecord[] {
  const id = String(msg.id || "");
  const messageType = String(msg.messageType || "message");
  if (messageType === "systemEventMessage") return [];
  const from = (msg.from as { user?: { displayName?: string; id?: string }; application?: { displayName?: string } } | undefined);
  const sender = from?.user?.displayName || from?.application?.displayName || "unknown";
  const senderId = from?.user?.id || "unknown";
  const channelId = String(msg.channelIdentity ? (msg.channelIdentity as any).channelId : "");
  const teamId = String(msg.channelIdentity ? (msg.channelIdentity as any).teamId : "");
  const chatId = String(msg.chatId || "");
  const bodyHtml = (msg.body as { content?: string } | undefined)?.content || "";
  const text = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const head = teamId
    ? `[teams:channel.${ctx.changeType}] team=${teamId} channel=${channelId} user=${sender}`
    : `[teams:chat.${ctx.changeType}] chat=${chatId} user=${sender}`;
  return [
    {
      provider: "microsoft",
      subtype: teamId
        ? `microsoft.teams.channel.${ctx.changeType}`
        : `microsoft.teams.chat.${ctx.changeType}`,
      userId: ctx.userId,
      tenantKey: teamId || chatId,
      content: trimContent(`${head}\n${text || "[empty message]"}`),
      owner: `teams:${senderId}`,
      externalId: `${ctx.subscriptionId}:${id}:${ctx.changeType}`,
      meta: { messageId: id, teamId, channelId, chatId, sender, senderId },
    },
  ];
}

// =====================================================================
// Slack adapter (legacy bridge)
// =====================================================================

/**
 * Bridge for the existing `handleSlackEventsRequest`. Use when migrating Slack
 * to ingestRouter — it keeps the verified payload and produces an IngestRecord
 * without re-running HMAC. Note: existing slackEvents.ts still inserts
 * directly to remain backward-compatible; this adapter is opt-in.
 */
export function transformSlackEvent(args: {
  userId: string;
  teamId: string;
  channelId?: string;
  threadTs?: string;
  ts?: string;
  user?: string;
  text: string;
  files?: { name?: string; title?: string }[];
  eventId: string;
}): IngestRecord {
  const isThread = args.threadTs && args.ts && args.threadTs !== args.ts;
  const head = isThread
    ? `[Thread reply] channel=${args.channelId ?? "?"} thread=${args.threadTs} user=${args.user ?? "?"}`
    : `[Message] channel=${args.channelId ?? "?"} user=${args.user ?? "?"}`;
  let body = (args.text || "").trim();
  if (!body && args.files?.length) {
    body = args.files.map((f) => f.name || f.title || "file").filter(Boolean).join(", ");
    body = body ? `[attachment] ${body}` : "[attachment]";
  }
  if (!body) body = "[empty message]";

  return {
    provider: "slack",
    subtype: isThread ? "slack.thread_reply" : "slack.message",
    userId: args.userId,
    tenantKey: args.teamId,
    content: trimContent(`${head}\n${body}`),
    owner: args.user ? `slack:${args.user}` : "slack:unknown",
    externalId: args.eventId,
    meta: { channel: args.channelId, threadTs: args.threadTs, ts: args.ts },
  };
}
