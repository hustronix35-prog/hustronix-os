import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import type { EvidenceInput, EvidenceRecord } from "./types.js";
import { extractFeaturesFromEvidence } from "./feature-extractor.js";
import { applyFeaturesToBeliefs } from "./belief-engine.js";
import { linkEvidenceToGraph } from "./graph-linker.js";

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Append-only evidence with idempotency. Returns existing row on duplicate key.
 */
export function recordEvidence(input: EvidenceInput): EvidenceRecord | null {
  const existing = db
    .rawGet(`SELECT * FROM execution_evidence WHERE tenant_id = ? AND idempotency_key = ?`, [
      input.tenantId,
      input.idempotencyKey,
    ])
    .at(0) as
    | {
        id: string;
        tenant_id: string;
        event_type: string;
        subject_entity_type: string;
        subject_entity_id: string;
        source_entity_type: string | null;
        source_entity_id: string | null;
        payload_json: string;
        observed_at: string;
        idempotency_key: string;
      }
    | undefined;

  if (existing) {
    return {
      id: existing.id,
      tenantId: existing.tenant_id,
      eventType: existing.event_type as EvidenceInput["eventType"],
      subjectEntityType: existing.subject_entity_type as EvidenceInput["subjectEntityType"],
      subjectEntityId: existing.subject_entity_id,
      sourceEntityType: (existing.source_entity_type as EvidenceInput["subjectEntityType"]) ?? undefined,
      sourceEntityId: existing.source_entity_id ?? undefined,
      payload: parsePayload(existing.payload_json),
      observedAt: existing.observed_at,
      idempotencyKey: existing.idempotency_key,
    };
  }

  const id = uuidv4();
  const observedAt = input.observedAt ?? new Date().toISOString();
  const r = db.rawRun(
    `INSERT INTO execution_evidence (
      id, tenant_id, event_type, subject_entity_type, subject_entity_id,
      source_entity_type, source_entity_id, payload_json, observed_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.eventType,
      input.subjectEntityType,
      input.subjectEntityId,
      input.sourceEntityType ?? null,
      input.sourceEntityId ?? null,
      JSON.stringify(input.payload),
      observedAt,
      input.idempotencyKey,
    ],
  );
  if (!r.changes) return null;

  const evidence: EvidenceRecord = { ...input, id, observedAt };
  const features = extractFeaturesFromEvidence(evidence);
  if (features.length) {
    applyFeaturesToBeliefs(input.tenantId, features, observedAt);
  }
  linkEvidenceToGraph(evidence);
  return evidence;
}

export function listEvidenceForEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
  limit = 50,
): EvidenceRecord[] {
  const rows = db.rawGet(
    `SELECT * FROM execution_evidence
     WHERE tenant_id = ? AND subject_entity_type = ? AND subject_entity_id = ?
     ORDER BY observed_at DESC LIMIT ?`,
    [tenantId, entityType, entityId, limit],
  ) as {
    id: string;
    tenant_id: string;
    event_type: string;
    subject_entity_type: string;
    subject_entity_id: string;
    source_entity_type: string | null;
    source_entity_id: string | null;
    payload_json: string;
    observed_at: string;
    idempotency_key: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    eventType: r.event_type as EvidenceInput["eventType"],
    subjectEntityType: r.subject_entity_type as EvidenceInput["subjectEntityType"],
    subjectEntityId: r.subject_entity_id,
    sourceEntityType: (r.source_entity_type as EvidenceInput["subjectEntityType"]) ?? undefined,
    sourceEntityId: r.source_entity_id ?? undefined,
    payload: parsePayload(r.payload_json),
    observedAt: r.observed_at,
    idempotencyKey: r.idempotency_key,
  }));
}
