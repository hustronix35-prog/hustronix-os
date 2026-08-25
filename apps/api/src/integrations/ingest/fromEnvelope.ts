/**
 * Map EvidenceEnvelope → existing IngestRecord without forking a second ledger path.
 */

import type { IngestRecord } from "../ingestRouter.js";
import type { EvidenceEnvelope } from "./types.js";

export function envelopeToIngestRecord(env: EvidenceEnvelope): IngestRecord {
  const text = env.displayText.trim();
  const owner =
    env.actor?.display ||
    (env.actor?.id ? `${env.provider}:${env.actor.id}` : `${env.provider}:unknown`);

  return {
    provider: env.provider,
    subtype: env.metadata?.sourceSubtype || env.sourceType,
    userId: env.tenantId,
    tenantKey: env.nangoConnectionId,
    content: text,
    owner,
    externalId: env.externalId,
    detectedAt: env.occurredAt,
    meta: {
      connection_id: env.connectionId,
      nango_connection_id: env.nangoConnectionId,
      source_type: env.sourceType,
      received_at: env.receivedAt,
      actor: env.actor ?? null,
      evidence: env.content,
      sync_id: env.metadata?.syncId ?? null,
      model: env.metadata?.model ?? null,
      cursor: env.metadata?.cursor ?? null,
      integration_runtime: env.metadata?.runtime ?? "nango",
      entity_type: env.metadata?.entity_type ?? null,
      entity_id: env.metadata?.entity_id ?? null,
      event: env.metadata?.event ?? null,
      previous: env.metadata?.previous ?? null,
      current: env.metadata?.current ?? null,
      owner: env.metadata?.owner ?? env.actor?.id ?? null,
      feature_hint: env.metadata?.feature_hint ?? null,
      aliases: env.metadata?.aliases ?? null,
    },
  };
}
