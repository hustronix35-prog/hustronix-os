/**
 * Microsoft Graph webhook ingress.
 *
 * Endpoint: POST/GET /api/ingest/microsoft
 *
 * Three responsibilities:
 *
 *   1. **Validation handshake** — When we POST /subscriptions, Graph hits
 *      `notificationUrl?validationToken=…` (GET) within 10 seconds. We MUST
 *      respond 200 with the raw token in `text/plain`. Without this, Graph
 *      rejects the subscription create.
 *
 *   2. **Notification dispatch** — Real notifications arrive as POST with a
 *      `{ value: [...] }` body. Each item carries `subscriptionId`,
 *      `clientState`, `changeType`, `resource`. We:
 *        - timing-safe compare clientState
 *        - reverse-lookup the owning connection
 *        - GET the resource using the user's stored access token
 *        - run the matching transformer → ingestRouter
 *      We always return 200 quickly even on partial failures: Graph retries
 *      4xx/5xx, and we don't want one bad event to blow up the whole batch.
 *
 *   3. **Lifecycle notifications** — Same endpoint receives lifecycle events
 *      (`reauthorizationRequired`, `subscriptionRemoved`, `missed`). We log
 *      and let the renewal worker handle recovery on next tick.
 */

import type { Express, Request, Response } from "express";
import express from "express";

import { ingestExternalBatch } from "./ingestRouter.js";
import {
  transformMsTeamsMessage,
  transformOutlookCalendarEvent,
  transformOutlookMailMessage,
} from "./webhookTransforms.js";
import {
  fetchNotificationResource,
  findConnectionForSubscription,
  microsoftClientState,
  type GraphResourceKind,
} from "./microsoftConnector.js";

interface GraphNotification {
  subscriptionId: string;
  subscriptionExpirationDateTime?: string;
  changeType: string;
  resource: string;
  resourceData?: Record<string, unknown>;
  clientState: string;
  tenantId?: string;
  /** Lifecycle-only field. */
  lifecycleEvent?: "reauthorizationRequired" | "subscriptionRemoved" | "missed";
}

interface GraphNotificationEnvelope {
  value: GraphNotification[];
  validationTokens?: string[];
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleNotification(notif: GraphNotification): Promise<void> {
  if (notif.lifecycleEvent) {
    /** Renewal worker handles recovery; just log so ops can audit. */
    console.log(
      `[microsoft] lifecycle ${notif.lifecycleEvent} for sub ${notif.subscriptionId}`,
    );
    return;
  }

  const ownership = findConnectionForSubscription(notif.subscriptionId);
  if (!ownership) {
    /** Stale subscription — Graph still pushing to a webhook for a connection we revoked. */
    console.warn(
      `[microsoft] notification for unknown subscription ${notif.subscriptionId}; skipping`,
    );
    return;
  }

  const transformer = transformerForKind(ownership.kind);
  let resource: Record<string, unknown> | null = notif.resourceData ?? null;
  if (!resource || !resource.id) {
    resource = await fetchNotificationResource(ownership.userId, notif.resource);
  }
  if (!resource) return;

  const records = transformer(resource, {
    userId: ownership.userId,
    subscriptionId: notif.subscriptionId,
    changeType: notif.changeType,
  });
  if (!records.length) return;

  try {
    ingestExternalBatch(records);
  } catch (err) {
    console.warn("[microsoft] ingestExternalBatch failed:", (err as Error).message);
  }
}

function transformerForKind(kind: GraphResourceKind) {
  switch (kind) {
    case "outlook_mail":
      return transformOutlookMailMessage;
    case "outlook_calendar":
      return transformOutlookCalendarEvent;
    case "teams_chats":
      return transformMsTeamsMessage;
    default:
      return transformOutlookMailMessage;
  }
}

async function handleMicrosoftIngest(req: Request, res: Response): Promise<void> {
  /** GET = synchronous validation handshake. Reply with the raw token. */
  if (req.method === "GET") {
    const token = String((req.query.validationToken as string) || "").trim();
    if (!token) {
      res.status(400).send("missing_validation_token");
      return;
    }
    res.status(200).type("text/plain").send(token);
    return;
  }

  /**
   * Some Graph subscriptions also do a one-shot validation via POST with a
   * `validationToken` query param. Honor that case too.
   */
  const validation = String((req.query.validationToken as string) || "").trim();
  if (validation) {
    res.status(200).type("text/plain").send(validation);
    return;
  }

  const raw = req.body;
  let envelope: GraphNotificationEnvelope;
  try {
    envelope = raw instanceof Buffer ? JSON.parse(raw.toString("utf8")) : (raw as GraphNotificationEnvelope);
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  if (!envelope || !Array.isArray(envelope.value)) {
    res.status(400).json({ error: "missing_value" });
    return;
  }

  const expected = microsoftClientState();
  /** Acknowledge synchronously; process asynchronously so we never exceed the 30s response budget. */
  res.status(200).json({ ok: true });

  void Promise.allSettled(
    envelope.value.map(async (notif) => {
      if (!timingSafeEqual(notif.clientState || "", expected)) {
        console.warn(
          `[microsoft] clientState mismatch for subscription ${notif.subscriptionId}`,
        );
        return;
      }
      try {
        await handleNotification(notif);
      } catch (err) {
        console.warn("[microsoft] handleNotification failed:", (err as Error).message);
      }
    }),
  );
}

export function mountMicrosoftWebhook(app: Express): void {
  /**
   * Mount the GET (validation) and POST (notification) handlers. Both go to
   * the same dispatcher. We use express.raw + JSON.parse so we never need to
   * re-encode for downstream signature checks (Graph doesn't sign payloads,
   * relying on `clientState` instead).
   */
  app.get("/api/ingest/microsoft", handleMicrosoftIngest);
  app.post(
    "/api/ingest/microsoft",
    express.raw({ type: "application/json", limit: "5mb" }),
    handleMicrosoftIngest,
  );
}
