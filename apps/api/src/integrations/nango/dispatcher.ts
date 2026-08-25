/**
 * Nango sync dispatcher — ACK webhook fast, then listRecords → adapter → ingestExternal.
 * Nango cache is ephemeral; evidence lives only in external_signals.
 */

import { adaptNangoRecord, type NangoSyncRecord } from "../adapters/index.js";
import { envelopeToIngestRecord } from "../ingest/fromEnvelope.js";
import { ingestExternal } from "../ingestRouter.js";
import { getNangoClient, isNangoConfigured } from "./nangoClient.js";
import {
  findNangoConnectionByRemoteId,
  getSyncCursor,
  setSyncCursor,
  touchNangoLastSync,
  type NangoConnectionRow,
} from "./nangoStore.js";

export type NangoSyncWebhookPayload = {
  type?: string;
  success?: boolean;
  connectionId?: string;
  providerConfigKey?: string;
  integrationId?: string;
  syncName?: string;
  model?: string;
  modifiedAfter?: string;
};

export type SyncDispatchResult = {
  connectionId: string;
  model: string;
  fetched: number;
  ingested: number;
  duplicates: number;
  skipped: number;
  errors: string[];
  nextCursor: string | null;
};

/**
 * Fire-and-forget from the webhook path. Never throw into the HTTP handler.
 */
export function dispatchNangoSyncFireAndForget(body: NangoSyncWebhookPayload): void {
  setImmediate(() => {
    processNangoSyncWebhook(body).catch((err) => {
      console.error(
        "[nango.dispatcher] sync processing failed:",
        err instanceof Error ? err.message : err,
      );
    });
  });
}

export async function processNangoSyncWebhook(
  body: NangoSyncWebhookPayload,
): Promise<SyncDispatchResult | null> {
  if (body.success === false) {
    console.warn("[nango.dispatcher] sync reported failure; skipping fetch", {
      connectionId: body.connectionId,
      model: body.model,
      syncName: body.syncName,
    });
    return null;
  }
  if (!isNangoConfigured()) {
    console.warn("[nango.dispatcher] Nango not configured; cannot listRecords");
    return null;
  }

  const nangoConnectionId = String(body.connectionId || "").trim();
  const integrationId = String(
    body.providerConfigKey || body.integrationId || "",
  ).trim();
  const model = String(body.model || "").trim();
  if (!nangoConnectionId || !integrationId || !model) {
    console.warn("[nango.dispatcher] incomplete sync webhook", body);
    return null;
  }

  const conn = findNangoConnectionByRemoteId(nangoConnectionId);
  if (!conn) {
    console.warn(
      "[nango.dispatcher] no local connection for",
      nangoConnectionId,
      "— connect via UI/sync first so tenant mapping exists",
    );
    return null;
  }

  return fetchAndIngestSyncRecords({
    conn,
    integrationId,
    model,
    syncName: body.syncName,
    modifiedAfter: body.modifiedAfter,
  });
}

/**
 * Core seam: already-fetched Nango records → EvidenceEnvelope → external_signals.
 * Used by fetchAndIngestSyncRecords and the Slack pilot proof (no live Nango required).
 */
export function ingestNangoRecords(opts: {
  conn: NangoConnectionRow;
  integrationId: string;
  model: string;
  syncName?: string;
  records: NangoSyncRecord[];
  receivedAt?: string;
}): SyncDispatchResult {
  const {
    conn,
    integrationId,
    model,
    syncName,
    records,
    receivedAt = new Date().toISOString(),
  } = opts;

  const errors: string[] = [];
  let ingested = 0;
  let duplicates = 0;
  let skipped = 0;
  let lastRecordCursor: string | null = null;

  for (const record of records) {
    const cursor = record._nango_metadata?.cursor;
    if (cursor) lastRecordCursor = cursor;

    const envelope = adaptNangoRecord(record, {
      tenantId: conn.user_id,
      connectionId: conn.id,
      nangoConnectionId: conn.connection_id,
      provider: conn.provider,
      integrationId,
      model,
      syncName,
      receivedAt,
    });
    if (!envelope) {
      skipped += 1;
      continue;
    }
    try {
      const out = ingestExternal(envelopeToIngestRecord(envelope));
      if (out.duplicate) duplicates += 1;
      else ingested += 1;
    } catch (e) {
      errors.push(
        `${envelope.externalId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (lastRecordCursor) {
    setSyncCursor(conn.id, model, lastRecordCursor);
  }
  touchNangoLastSync(conn.id);

  return {
    connectionId: conn.connection_id,
    model,
    fetched: records.length,
    ingested,
    duplicates,
    skipped,
    errors,
    nextCursor: lastRecordCursor,
  };
}

export async function fetchAndIngestSyncRecords(opts: {
  conn: NangoConnectionRow;
  integrationId: string;
  model: string;
  syncName?: string;
  modifiedAfter?: string;
  /** When true, ignore stored cursor and use modifiedAfter / full page. */
  resetCursor?: boolean;
}): Promise<SyncDispatchResult> {
  const { conn, integrationId, model, syncName, modifiedAfter, resetCursor } = opts;
  const nango = getNangoClient();
  const receivedAt = new Date().toISOString();
  const storedCursor = resetCursor
    ? null
    : getSyncCursor(conn.id, model)?.cursor ?? null;

  const errors: string[] = [];
  let fetched = 0;
  let ingested = 0;
  let duplicates = 0;
  let skipped = 0;
  let nextCursor: string | null = storedCursor;
  let lastRecordCursor: string | null = storedCursor;

  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listOpts: {
      providerConfigKey: string;
      connectionId: string;
      model: string;
      limit: number;
      cursor?: string;
      modifiedAfter?: string;
    } = {
      providerConfigKey: integrationId,
      connectionId: conn.connection_id,
      model,
      limit: 100,
    };
    if (nextCursor) {
      listOpts.cursor = nextCursor;
    } else if (modifiedAfter) {
      listOpts.modifiedAfter = modifiedAfter;
    }

    let result: {
      records: NangoSyncRecord[];
      next_cursor?: string | null;
    };
    try {
      result = (await nango.listRecords(listOpts)) as {
        records: NangoSyncRecord[];
        next_cursor?: string | null;
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`listRecords: ${msg}`);
      break;
    }

    const records = Array.isArray(result.records) ? result.records : [];
    if (!records.length) break;

    const pageResult = ingestNangoRecords({
      conn,
      integrationId,
      model,
      syncName,
      records,
      receivedAt,
    });
    fetched += pageResult.fetched;
    ingested += pageResult.ingested;
    duplicates += pageResult.duplicates;
    skipped += pageResult.skipped;
    errors.push(...pageResult.errors);
    if (pageResult.nextCursor) lastRecordCursor = pageResult.nextCursor;

    nextCursor =
      result.next_cursor != null && result.next_cursor !== ""
        ? result.next_cursor
        : lastRecordCursor;
    if (!result.next_cursor) break;
  }

  const summary: SyncDispatchResult = {
    connectionId: conn.connection_id,
    model,
    fetched,
    ingested,
    duplicates,
    skipped,
    errors,
    nextCursor: lastRecordCursor,
  };
  console.log("[nango.dispatcher] ingest complete", summary);
  return summary;
}
