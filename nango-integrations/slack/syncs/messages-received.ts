/**
 * Nango Slack pilot — messages-received sync model `Message`.
 *
 * Enable the prebuilt Slack sync in Nango dashboard (or deploy this file via
 * Nango CLI). Hustronix consumes model name `Message` via:
 *   POST /api/nango/webhook (type=sync) → listRecords → slackAdapter → external_signals
 *
 * Source template:
 * https://github.com/NangoHQ/integration-templates/blob/main/integrations/slack/syncs/messages-received.ts
 *
 * Deploy (from this directory, with Nango CLI + secret key):
 *   npx nango deploy
 *
 * Do not treat Nango's records cache as long-term storage — Hustronix
 * external_signals is the evidence ledger.
 */

import { createSync } from "nango";
import { z } from "zod";

/** Matches Hustronix Slack adapter expectations. */
export const MessageSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  channel_name: z.string(),
  user_id: z.string(),
  user_name: z.string().optional(),
  text: z.string(),
  timestamp: z.string(),
  thread_ts: z.string().optional(),
  parent_ts: z.string().optional(),
  is_thread_reply: z.boolean().optional(),
  reactions: z
    .array(
      z.object({
        name: z.string(),
        count: z.number(),
        users: z.array(z.string()),
      }),
    )
    .optional(),
  reply_count: z.number().optional(),
  reply_users: z.array(z.string()).optional(),
  created_at: z.string(),
});

const CheckpointSchema = z.object({
  channelsLastSyncDateJson: z.string(),
  lastSyncDate: z.string(),
});

type Message = z.infer<typeof MessageSchema>;

const sync = createSync({
  description:
    "Hustronix Slack pilot: sync channel messages the bot can access into Nango model Message for ingest into external_signals.",
  version: "1.0.0",
  endpoints: [
    { method: "POST", path: "/syncs/messages-received", group: "Messages" },
  ],
  frequency: "every hour",
  autoStart: true,
  checkpoint: CheckpointSchema,
  models: {
    Message: MessageSchema,
  },
  exec: async (nango) => {
    const checkpoint = await nango.getCheckpoint();
    let channelsLastSyncDate: Record<string, string> = {};
    const checkpointJson = checkpoint?.channelsLastSyncDateJson;
    if (checkpointJson && typeof checkpointJson === "string") {
      try {
        channelsLastSyncDate = JSON.parse(checkpointJson);
      } catch {
        /* ignore */
      }
    }

    const tenDaysAgo = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const updatedChannelsLastSyncDate: Record<string, string> = {
      ...channelsLastSyncDate,
    };

    const channelsResponse = await nango.get({
      endpoint: "conversations.list",
      params: {
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: "100",
      },
      retries: 3,
    });

    if (
      !channelsResponse.data?.channels ||
      !Array.isArray(channelsResponse.data.channels)
    ) {
      throw new Error("Failed to fetch channels from Slack");
    }

    const channelsToProcess = channelsResponse.data.channels.slice(0, 5);
    const allMessages: Message[] = [];

    for (const channel of channelsToProcess) {
      const channelId: string = channel.id;
      const channelName: string = channel.name || "unknown";
      let isJoined: boolean = Boolean(channel.is_member);

      if (!isJoined && channel.is_channel && !channel.is_private) {
        try {
          await nango.post({
            endpoint: "conversations.join",
            data: { channel: channelId },
            retries: 3,
          });
          isJoined = true;
        } catch {
          continue;
        }
      }
      if (!isJoined && channel.is_private) continue;

      const lastSync = channelsLastSyncDate[channelId];
      const isNewChannel = !lastSync;
      const tenDaysAgoTs = String(new Date(tenDaysAgo).getTime() / 1000);
      const effectiveOldest = isNewChannel
        ? "0"
        : Math.max(
            parseFloat(lastSync),
            parseFloat(tenDaysAgoTs),
          ).toString();

      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const historyResponse = await nango.get({
          endpoint: "conversations.history",
          params: {
            channel: channelId,
            oldest: effectiveOldest,
            limit: "100",
            ...(cursor ? { cursor } : {}),
          },
          retries: 3,
        });

        if (
          !historyResponse.data?.messages ||
          !Array.isArray(historyResponse.data.messages)
        ) {
          break;
        }

        for (const msg of historyResponse.data.messages) {
          if (msg.subtype && msg.subtype !== "thread_broadcast") continue;

          allMessages.push({
            id: `${channelId}-${msg.ts}`,
            channel_id: channelId,
            channel_name: channelName,
            user_id: msg.user || "unknown",
            text: msg.text || "",
            timestamp: msg.ts,
            thread_ts: msg.thread_ts,
            is_thread_reply: false,
            reactions: msg.reactions?.map(
              (r: { name: string; count: number; users?: string[] }) => ({
                name: r.name,
                count: r.count,
                users: r.users || [],
              }),
            ),
            reply_count: msg.reply_count,
            reply_users: msg.reply_users,
            created_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          });
        }

        hasMore = Boolean(historyResponse.data.has_more);
        cursor = historyResponse.data.response_metadata?.next_cursor;
        if (!hasMore || !cursor) break;
      }

      updatedChannelsLastSyncDate[channelId] = String(Date.now() / 1000);
    }

    if (allMessages.length > 0) {
      await nango.batchSave(allMessages, "Message");
    }

    await nango.saveCheckpoint({
      channelsLastSyncDateJson: JSON.stringify(updatedChannelsLastSyncDate),
      lastSyncDate: new Date().toISOString(),
    });
  },
});

export type NangoSyncLocal = Parameters<(typeof sync)["exec"]>[0];
export default sync;
