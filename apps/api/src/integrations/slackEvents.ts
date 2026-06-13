import crypto from "crypto";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { ingestExternal, IngestError } from "./ingestRouter.js";

const SLACK_SIG_VERSION = "v0";
/** Slack docs: reject if timestamp older than 5 minutes. */
const REPLAY_SKEW_SEC = 60 * 5;

function verifySlackSignature(
  signingSecret: string,
  timestamp: string | undefined,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !timestamp) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > REPLAY_SKEW_SEC) return false;

  const base = `${SLACK_SIG_VERSION}:${timestamp}:${rawBody.toString("utf8")}`;
  const digestHex = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const expectedSig = `${SLACK_SIG_VERSION}=${digestHex}`;
  const slackSig = signatureHeader.trim();

  try {
    const a = Buffer.from(expectedSig, "utf8");
    const b = Buffer.from(slackSig, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function slackSigningSecret(): string | null {
  const s = process.env.SLACK_SIGNING_SECRET?.trim();
  return s || null;
}

function parseChannelList(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Returns false if this channel should not become a signal (backpressure / noise control). */
function channelAllowedForIngest(channelId: string | undefined): boolean {
  if (!channelId) return true;
  const deny = parseChannelList(process.env.SLACK_INGEST_CHANNEL_DENYLIST);
  if (deny.size > 0 && deny.has(channelId)) return false;
  const allow = parseChannelList(process.env.SLACK_INGEST_CHANNEL_ALLOWLIST);
  if (allow.size > 0 && !allow.has(channelId)) return false;
  return true;
}

type SlackUrlVerification = { type: "url_verification"; challenge: string };
type SlackEventCallback = {
  type: "event_callback";
  token?: string;
  team_id?: string;
  enterprise_id?: string;
  api_app_id?: string;
  event_id?: string;
  event_time?: number;
  event?: SlackMessageEvent & { type?: string };
};

type SlackMessageEvent = {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  channel?: string;
  channel_type?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
  files?: { name?: string; title?: string }[];
};

function shouldIngestMessage(ev: SlackMessageEvent): boolean {
  if (ev.type !== "message") return false;
  if (ev.bot_id) return false;
  const st = ev.subtype;
  if (st && st !== "file_share" && st !== "thread_broadcast") {
    if (
      [
        "message_deleted",
        "message_changed",
        "channel_join",
        "channel_leave",
        "group_join",
        "group_leave",
        "file_comment",
        "me_message",
      ].includes(st)
    ) {
      return false;
    }
  }
  return true;
}

function buildSignalContent(ev: SlackMessageEvent, teamId: string): string {
  const ch = ev.channel || "unknown-channel";
  const user = ev.user || "unknown";
  const isThread = ev.thread_ts && ev.ts && ev.thread_ts !== ev.ts;
  const head = isThread
    ? `[Thread reply] channel=${ch} thread=${ev.thread_ts} user=${user}`
    : `[Message] channel=${ch} user=${user}`;

  let body = (ev.text || "").trim();
  if (!body && ev.files?.length) {
    body = ev.files
      .map((f) => f.name || f.title || "file")
      .filter(Boolean)
      .join(", ");
    body = body ? `[attachment] ${body}` : "[attachment]";
  }
  if (!body) body = "[empty message]";

  const permalinkHint = `team=${teamId}`;
  return `${head}\n${permalinkHint}\n\n${body}`;
}

/**
 * Slack Events API → `external_signals` (source SLACK).
 * Mount with `express.raw({ type: "application/json" })` so the signing secret matches Slack’s payload.
 */
export function handleSlackEventsRequest(req: Request, res: Response) {
  const signingSecret = slackSigningSecret();
  const raw = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const ts = req.headers["x-slack-request-timestamp"] as string | undefined;
  const sig = req.headers["x-slack-signature"] as string | undefined;

  if (!signingSecret) {
    console.error("[Slack events] SLACK_SIGNING_SECRET is not set — refusing requests.");
    res.status(503).json({ ok: false, error: "missing_slack_signing_secret" });
    return;
  }

  if (!verifySlackSignature(signingSecret, ts, raw, sig)) {
    res.status(401).send("");
    return;
  }

  let payload: SlackUrlVerification | SlackEventCallback | { type?: string };
  try {
    payload = JSON.parse(raw.toString("utf8")) as SlackUrlVerification | SlackEventCallback;
  } catch {
    res.status(400).send("invalid_json");
    return;
  }

  if (payload.type === "url_verification" && "challenge" in payload) {
    res.status(200).type("application/json").send(JSON.stringify({ challenge: payload.challenge }));
    return;
  }

  if (payload.type !== "event_callback") {
    res.status(200).json({ ok: true });
    return;
  }

  const cb = payload as SlackEventCallback;
  const teamId = cb.team_id || cb.event?.team;
  if (!teamId) {
    res.status(200).json({ ok: true });
    return;
  }

  const ev = cb.event;
  const dedupBase = `${teamId}:${ev?.ts || ""}:${ev?.user || ""}:${ev?.channel || ""}:${ev?.thread_ts ?? ""}`;
  const eventId = cb.event_id || (dedupBase.length > 12 ? dedupBase : uuidv4());

  if (!db.tryInsertSlackEventId(eventId, teamId)) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  const inner = ev;
  if (!inner || !shouldIngestMessage(inner as SlackMessageEvent)) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  if (!channelAllowedForIngest(inner.channel)) {
    res.status(200).json({ ok: true, ignored: true, channel_filtered: true });
    return;
  }

  const tenant = db.getSlackTenantForTeam(teamId);
  if (!tenant) {
    console.warn(`[Slack events] No oauth_connections row for team ${teamId} — install the app via Settings → Slack.`);
    res.status(200).json({ ok: true, no_installation: true });
    return;
  }

  const content = buildSignalContent(inner as SlackMessageEvent, teamId);
  const owner = inner.user ? `slack:${inner.user}` : "slack:unknown";
  const isThread = !!(inner.thread_ts && inner.ts && inner.thread_ts !== inner.ts);
  const subtype = isThread ? "slack.thread_reply" : "slack.message";

  /**
   * Route through the unified ingest router so Slack signals get the same
   * `source_subtype` + `ingest_meta` treatment as GitHub/Jira/CRM. We DO NOT
   * pass `externalId` — `tryInsertSlackEventId` above is the primary
   * idempotency gate for Slack and we don't want to dedup twice. (The
   * legacy `slack_event_receipts` table is the source of truth for Slack
   * dedup; `external_event_dedup` is for non-Slack providers.)
   */
  try {
    const result = ingestExternal(
      {
        provider: "slack",
        subtype,
        userId: tenant.user_id,
        tenantKey: teamId,
        content,
        owner,
        meta: {
          team_id: teamId,
          channel: inner.channel ?? null,
          ts: inner.ts ?? null,
          thread_ts: inner.thread_ts ?? null,
          channel_type: inner.channel_type ?? null,
          event_id: cb.event_id ?? null,
        },
      },
      { allowSystemFallback: false },
    );
    db.rawRun(`INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`, [
      "SLACK_SIGNAL_INGESTED",
      `team=${teamId} subtype=${subtype}`,
      result.signalId,
    ]);
    console.log(`[Slack events] Signal ${result.signalId} for user ${tenant.user_id} team=${teamId} subtype=${subtype}`);
  } catch (e) {
    if (e instanceof IngestError) {
      console.error(`[Slack events] ingest router rejected: ${e.code} ${e.message}`);
      res.status(500).json({ ok: false, error: e.code });
      return;
    }
    console.error("[Slack events] insert failed:", e);
    res.status(500).json({ ok: false });
    return;
  }

  res.status(200).json({ ok: true });
}
