import { createEntity } from "../entities/store.js";
import { db } from "../database.js";
import type { EvidenceRecord } from "./types.js";

export function ensureEntityBridge(
  tenantId: string,
  entityType: "person" | "task" | "decision",
  refId: string,
  label?: string,
) {
  createEntity({
    tenantId,
    type: entityType,
    refId,
    label: label ?? refId,
  });
}

export function linkEvidenceToGraph(evidence: EvidenceRecord) {
  const tenantId = evidence.tenantId;
  ensureEntityBridge(
    tenantId,
    evidence.subjectEntityType as "person" | "task" | "decision",
    evidence.subjectEntityId,
    evidence.subjectEntityId,
  );

  if (evidence.sourceEntityType && evidence.sourceEntityId) {
    ensureEntityBridge(
      tenantId,
      evidence.sourceEntityType as "person" | "task" | "decision",
      evidence.sourceEntityId,
      evidence.sourceEntityId,
    );

    let edgeType = "RELATED";
    if (evidence.eventType.startsWith("task.")) edgeType = "OWNS";
    else if (evidence.eventType === "signal.linked") edgeType = "LINKED";
    else if (evidence.eventType === "decision.outcome") edgeType = "PART_OF";

    db.rawRun(
      `INSERT OR IGNORE INTO entity_edges (
        tenant_id, from_type, from_id, to_type, to_id, edge_type, evidence_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        tenantId,
        evidence.subjectEntityType,
        evidence.subjectEntityId,
        evidence.sourceEntityType,
        evidence.sourceEntityId,
        edgeType,
        evidence.id,
      ],
    );
  }

  const taskId = evidence.payload.task_id as string | undefined;
  const decisionId = evidence.payload.decision_id as string | undefined;
  if (taskId && decisionId && evidence.subjectEntityType === "person") {
    ensureEntityBridge(tenantId, "task", taskId, taskId);
    ensureEntityBridge(tenantId, "decision", decisionId, decisionId);
    db.rawRun(
      `INSERT OR IGNORE INTO entity_edges (
        tenant_id, from_type, from_id, to_type, to_id, edge_type, evidence_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [tenantId, "person", evidence.subjectEntityId, "task", taskId, "OWNS", evidence.id],
    );
    db.rawRun(
      `INSERT OR IGNORE INTO entity_edges (
        tenant_id, from_type, from_id, to_type, to_id, edge_type, evidence_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [tenantId, "task", taskId, "decision", decisionId, "PART_OF", evidence.id],
    );
  }
}

export function listGraphNeighbors(
  tenantId: string,
  entityType: string,
  entityId: string,
  limit = 20,
) {
  return db.rawGet(
    `SELECT from_type, from_id, to_type, to_id, edge_type, created_at
     FROM entity_edges
     WHERE tenant_id = ?
       AND ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?))
     ORDER BY created_at DESC LIMIT ?`,
    [tenantId, entityType, entityId, entityType, entityId, limit],
  );
}
