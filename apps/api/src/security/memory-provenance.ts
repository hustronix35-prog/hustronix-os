import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";

export type ProvenanceEventType =
  | "ORIGIN"
  | "VALIDATION"
  | "HUMAN_REVIEW"
  | "CONTRADICTION"
  | "VERIFICATION"
  | "TRUST_CHANGE"
  | "REVOCATION";

export function recordMemoryProvenance(params: {
  tenantId: string;
  factId?: string | null;
  eventType: ProvenanceEventType;
  actorId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  payload?: Record<string, unknown>;
}): string {
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO memory_provenance_events (
      id, tenant_id, fact_id, event_type, actor_id, source_type, source_id, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.factId ?? null,
      params.eventType,
      params.actorId ?? null,
      params.sourceType ?? null,
      params.sourceId ?? null,
      params.payload ? JSON.stringify(params.payload) : null,
    ],
  );
  return id;
}

export function listMemoryProvenance(factId: string): Array<{
  id: string;
  event_type: string;
  actor_id: string | null;
  source_type: string | null;
  source_id: string | null;
  payload_json: string | null;
  created_at: string;
}> {
  return db.rawGet(
    `SELECT id, event_type, actor_id, source_type, source_id, payload_json, created_at
     FROM memory_provenance_events WHERE fact_id = ? ORDER BY created_at ASC`,
    [factId],
  ) as Array<{
    id: string;
    event_type: string;
    actor_id: string | null;
    source_type: string | null;
    source_id: string | null;
    payload_json: string | null;
    created_at: string;
  }>;
}
