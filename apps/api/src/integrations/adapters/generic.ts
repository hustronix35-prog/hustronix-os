/**
 * Fallback adapter — any Nango model → opaque evidence + JSON display text.
 * Keeps the seam open for providers without a specialized adapter yet.
 */

import type { EvidenceEnvelope } from "../ingest/types.js";
import {
  isDeletedRecord,
  recordExternalId,
  type AdapterContext,
  type NangoSyncRecord,
  type ProviderAdapter,
} from "./types.js";

function displayFrom(record: NangoSyncRecord, provider: string): string {
  for (const key of ["text", "title", "subject", "name", "summary", "body", "content"]) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 2000);
  }
  try {
    return `${provider} record: ${JSON.stringify(record).slice(0, 400)}`;
  } catch {
    return `${provider} sync record`;
  }
}

export const genericAdapter: ProviderAdapter = {
  providers: ["*"],
  adapt(record, ctx) {
    if (isDeletedRecord(record)) return null;
    const displayText = displayFrom(record, ctx.provider);
    if (displayText.length < 2) return null;

    return {
      tenantId: ctx.tenantId,
      connectionId: ctx.connectionId,
      nangoConnectionId: ctx.nangoConnectionId,
      provider: ctx.provider,
      sourceType: ctx.model || `${ctx.provider}.record`,
      externalId: recordExternalId(record, ctx.model || "Record"),
      occurredAt:
        record._nango_metadata?.last_modified_at ||
        record._nango_metadata?.first_seen_at ||
        undefined,
      receivedAt: ctx.receivedAt,
      content: record,
      displayText,
      metadata: {
        sourceSubtype: `nango.${ctx.provider}.${(ctx.model || "record").toLowerCase()}`,
        syncId: ctx.syncName,
        model: ctx.model,
        cursor: record._nango_metadata?.cursor,
      },
    } satisfies EvidenceEnvelope;
  },
};
