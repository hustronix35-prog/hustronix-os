/**
 * Google Calendar push notification ingress.
 *
 * Endpoint: POST /api/ingest/google/calendar
 *
 * Google delivers an empty body and meaningful headers:
 *   - x-goog-channel-id     — channel UUID we created
 *   - x-goog-channel-token  — opaque token we set; must match
 *   - x-goog-resource-state — 'sync' (initial), 'exists', 'not_exists'
 *   - x-goog-resource-id    — resource the channel watches
 *   - x-goog-resource-uri   — calendar events URL
 *
 * We:
 *   1. Look up the channel by id
 *   2. Verify the token (timing-safe)
 *   3. If state is `sync`, ignore (initial handshake — already known)
 *   4. Otherwise call `pollCalendarChanges` which uses syncToken to fetch
 *      only the deltas, transforms, and ingests them.
 *
 * Always returns 200 quickly; Google retries on 5xx with exponential backoff.
 */

import type { Express, Request, Response } from "express";
import express from "express";

import {
  findCalendarSubscriptionForChannel,
  pollCalendarChanges,
} from "./googleConnector.js";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleGoogleCalendarIngest(req: Request, res: Response): Promise<void> {
  const channelId = String(req.headers["x-goog-channel-id"] || "");
  const channelToken = String(req.headers["x-goog-channel-token"] || "");
  const resourceState = String(req.headers["x-goog-resource-state"] || "");

  if (!channelId) {
    res.status(400).json({ ok: false, error: "missing_channel_id" });
    return;
  }

  /**
   * Always 200 first — Google's push system retries 5xx aggressively and we
   * don't want one slow tenant to back up the queue.
   */
  res.status(200).json({ ok: true });

  if (resourceState === "sync") {
    /** Initial handshake — no payload to process. */
    return;
  }

  const ownership = findCalendarSubscriptionForChannel(channelId);
  if (!ownership) {
    console.warn(`[google.calendar] notification for unknown channel ${channelId}`);
    return;
  }
  if (!timingSafeEqual(channelToken, ownership.channelToken)) {
    console.warn(`[google.calendar] channel-token mismatch for ${channelId}`);
    return;
  }

  void pollCalendarChanges(ownership.userId, channelId).catch((err) => {
    console.warn("[google.calendar] poll failed:", (err as Error).message);
  });
}

export function mountGoogleWebhook(app: Express): void {
  /** Body is always empty for Calendar push, but accept up to 1KB just in case. */
  app.post(
    "/api/ingest/google/calendar",
    express.raw({ type: "*/*", limit: "1kb" }),
    handleGoogleCalendarIngest,
  );
}
