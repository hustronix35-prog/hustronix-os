/**
 * Provider adapters: Nango sync records → EvidenceEnvelope.
 * Only place Hustronix should branch on provider shape.
 */

import type { EvidenceEnvelope } from "../ingest/types.js";

export type NangoSyncRecord = Record<string, unknown> & {
  id?: string;
  _nango_metadata?: {
    deleted_at?: string | null;
    last_action?: string;
    cursor?: string;
    first_seen_at?: string;
    last_modified_at?: string;
  };
};

export type AdapterContext = {
  tenantId: string;
  connectionId: string;
  nangoConnectionId: string;
  provider: string;
  integrationId: string;
  model: string;
  syncName?: string;
  receivedAt: string;
};

export type ProviderAdapter = {
  /** Nango provider / integration slugs this adapter accepts. */
  providers: string[];
  /** Optional model names; empty = all models for those providers. */
  models?: string[];
  adapt(record: NangoSyncRecord, ctx: AdapterContext): EvidenceEnvelope | null;
};

export function isDeletedRecord(record: NangoSyncRecord): boolean {
  return Boolean(record._nango_metadata?.deleted_at);
}

export function recordExternalId(record: NangoSyncRecord, model: string): string {
  const id = record.id != null ? String(record.id) : "";
  if (id) return `nango:${model}:${id}`;
  const cursor = record._nango_metadata?.cursor;
  if (cursor) return `nango:${model}:cursor:${cursor}`;
  return `nango:${model}:hash:${stableHash(record)}`;
}

function stableHash(record: NangoSyncRecord): string {
  try {
    const s = JSON.stringify(record);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  } catch {
    return String(Date.now());
  }
}
