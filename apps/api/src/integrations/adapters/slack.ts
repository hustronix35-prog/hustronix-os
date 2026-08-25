/**
 * Slack Nango sync records → EvidenceEnvelope.
 * Primary shape: Nango prebuilt `messages-received` sync model `Message`
 * (channel_id, user_id, text, timestamp, created_at, …).
 * Also tolerates raw Slack event-like fields.
 */

import type { EvidenceEnvelope } from "../ingest/types.js";
import { guessFeatureHint } from "../claimReady.js";
import {
  isDeletedRecord,
  recordExternalId,
  type AdapterContext,
  type NangoSyncRecord,
  type ProviderAdapter,
} from "./types.js";

function pickText(record: NangoSyncRecord): string {
  const candidates = [
    record.text,
    record.message,
    record.content,
    record.body,
    typeof record.blocks === "string" ? record.blocks : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  const name =
    (typeof record.name === "string" && record.name) ||
    (typeof record.real_name === "string" && record.real_name) ||
    (record.profile &&
      typeof record.profile === "object" &&
      typeof (record.profile as { display_name?: string }).display_name === "string" &&
      (record.profile as { display_name: string }).display_name);
  if (name) return `Slack entity: ${name}`;
  try {
    return JSON.stringify(record).slice(0, 500);
  } catch {
    return "Slack sync record";
  }
}

function pickActor(record: NangoSyncRecord): EvidenceEnvelope["actor"] {
  const user =
    (typeof record.user_id === "string" && record.user_id) ||
    (typeof record.user === "string" && record.user) ||
    (typeof record.sender === "string" && record.sender) ||
    null;
  if (!user) return undefined;
  const display =
    (typeof record.user_name === "string" && record.user_name) ||
    (typeof record.username === "string" && record.username) ||
    undefined;
  return { id: user, display: display || undefined };
}

function pickChannelLabel(record: NangoSyncRecord): string | null {
  const name =
    (typeof record.channel_name === "string" && record.channel_name) ||
    (typeof record.channel === "string" && record.channel) ||
    null;
  const id =
    (typeof record.channel_id === "string" && record.channel_id) || null;
  if (name) return name;
  return id;
}

function pickOccurredAt(record: NangoSyncRecord): string | undefined {
  if (typeof record.created_at === "string" && record.created_at) {
    return record.created_at;
  }
  const ts =
    (typeof record.timestamp === "string" && record.timestamp) ||
    (typeof record.ts === "string" && record.ts) ||
    (typeof record.event_ts === "string" && record.event_ts) ||
    (typeof record.created === "string" && record.created) ||
    record._nango_metadata?.first_seen_at ||
    record._nango_metadata?.last_modified_at ||
    undefined;
  if (!ts) return undefined;
  if (/^\d+(\.\d+)?$/.test(ts)) {
    const sec = Number(ts);
    if (Number.isFinite(sec)) return new Date(sec * 1000).toISOString();
  }
  return ts;
}

export const slackAdapter: ProviderAdapter = {
  providers: ["slack"],
  adapt(record, ctx) {
    if (isDeletedRecord(record)) return null;
    const displayText = pickText(record);
    if (!displayText || displayText.length < 2) return null;

    const channel = pickChannelLabel(record);
    const thread =
      record.is_thread_reply === true
        ? " (thread)"
        : "";
    const actor = pickActor(record);
    const channelId =
      (typeof record.channel_id === "string" && record.channel_id) ||
      (typeof record.channel === "string" && record.channel) ||
      "ch";
    const ts =
      (typeof record.timestamp === "string" && record.timestamp) ||
      (typeof record.ts === "string" && record.ts) ||
      String(record.id || "");
    const entityId = `slack:${channelId}:${ts}`;

    return {
      tenantId: ctx.tenantId,
      connectionId: ctx.connectionId,
      nangoConnectionId: ctx.nangoConnectionId,
      provider: "slack",
      sourceType: ctx.model || "Message",
      externalId: recordExternalId(record, ctx.model || "Message"),
      occurredAt: pickOccurredAt(record),
      receivedAt: ctx.receivedAt,
      actor,
      content: record,
      displayText: channel
        ? `[#${channel}]${thread} ${displayText}`
        : `${displayText}${thread}`,
      metadata: {
        sourceSubtype: `nango.slack.${(ctx.model || "Message").toLowerCase()}`,
        syncId: ctx.syncName,
        model: ctx.model,
        cursor: record._nango_metadata?.cursor,
        entity_type: "message",
        entity_id: entityId,
        event: record.is_thread_reply === true ? "thread_reply" : "message",
        previous: null,
        current: record.is_thread_reply === true ? "thread_reply" : "message",
        owner: actor?.id ? `slack:${actor.id}` : undefined,
        feature_hint: guessFeatureHint(displayText),
      },
    };
  },
};
