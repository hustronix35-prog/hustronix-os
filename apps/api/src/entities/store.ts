import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { linkEvidence, upsertEvidenceNode, type EvidenceEdgeType } from "../security/evidence-graph.js";
import { computeDynamicConfidence } from "../state/confidence.js";
import { memoryTenantInClause, memoryTenantParams } from "../security/tenant-scope.js";
import type { TenantContext } from "../security/tenant-context.js";
import type {
  EntityNeighbor,
  EntityRecord,
  EntityTimelineEvent,
  EntityType,
} from "./types.js";
import { ENTITY_TYPES } from "./types.js";

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function evidenceNodeTypeForEntity(type: EntityType): Parameters<typeof upsertEvidenceNode>[0]["nodeType"] {
  const map: Partial<Record<EntityType, Parameters<typeof upsertEvidenceNode>[0]["nodeType"]>> = {
    decision: "decision",
    task: "task",
    meeting: "meeting",
    person: "person",
    project: "project",
    customer: "customer",
  };
  return map[type] ?? "fact";
}

function ensureEvidenceNodeForEntity(entity: EntityRecord): string {
  const meta = parseMetadata(entity.metadata_json);
  const existing = meta.evidence_node_id;
  if (typeof existing === "string" && existing) return existing;

  const nodeId = upsertEvidenceNode({
    tenantId: entity.tenant_id,
    nodeType: evidenceNodeTypeForEntity(entity.type),
    refId: entity.ref_id,
    label: entity.label,
    confidence: entity.confidence,
  });
  meta.evidence_node_id = nodeId;
  db.rawRun(`UPDATE entities SET metadata_json = ? WHERE id = ?`, [JSON.stringify(meta), entity.id]);
  return nodeId;
}

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

export function createEntity(params: {
  tenantId: string;
  type: EntityType;
  label: string;
  refId?: string | null;
  metadata?: Record<string, unknown>;
  confidence?: number;
  freshnessAt?: string;
}): EntityRecord {
  if (params.refId) {
    const existing = db
      .rawGet(
        `SELECT * FROM entities WHERE tenant_id = ? AND type = ? AND ref_id = ? LIMIT 1`,
        [params.tenantId, params.type, params.refId],
      )
      .at(0) as EntityRecord | undefined;
    if (existing) return existing;
  }

  const factors = computeDynamicConfidence({
    baseEvidenceWeight: params.confidence ?? 0.5,
    freshnessAt: params.freshnessAt ?? new Date().toISOString(),
    evidenceCount: 1,
  });

  const id = uuidv4();
  const now = new Date().toISOString();
  const metadata = { ...(params.metadata ?? {}), confidence_factors: factors };

  db.rawRun(
    `INSERT INTO entities (
      id, tenant_id, type, label, ref_id, metadata_json, confidence, freshness_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.type,
      params.label.slice(0, 500),
      params.refId ?? null,
      JSON.stringify(metadata),
      factors.confidence,
      params.freshnessAt ?? now,
    ],
  );

  const row = getEntity(params.tenantId, id);
  if (!row) throw new Error("Failed to create entity.");
  ensureEvidenceNodeForEntity(row);
  return row;
}

export function getEntity(tenantId: string, entityId: string): EntityRecord | null {
  const row = db
    .rawGet(`SELECT * FROM entities WHERE id = ? AND tenant_id = ?`, [entityId, tenantId])
    .at(0) as EntityRecord | undefined;
  return row ?? null;
}

export function listEntities(
  ctx: TenantContext,
  filters?: { type?: EntityType; limit?: number },
): EntityRecord[] {
  const [orgId, userId] = memoryTenantParams(ctx);
  const limit = Math.min(filters?.limit ?? 100, 500);
  const params: unknown[] = [orgId, userId];
  let typeClause = "";
  if (filters?.type) {
    typeClause = " AND type = ? ";
    params.push(filters.type);
  }
  params.push(limit);
  return db.rawGet(
    `SELECT * FROM entities WHERE ${memoryTenantInClause()} ${typeClause}
     ORDER BY freshness_at DESC LIMIT ?`,
    params,
  ) as EntityRecord[];
}

export function linkEntityNeighbor(params: {
  tenantId: string;
  fromEntityId: string;
  toEntityId: string;
  edgeType: EvidenceEdgeType | "RELATED_TO";
  confidence?: number;
}): string {
  const from = getEntity(params.tenantId, params.fromEntityId);
  const to = getEntity(params.tenantId, params.toEntityId);
  if (!from || !to) throw new Error("Entity not found for neighbor link.");

  const fromNode = ensureEvidenceNodeForEntity(from);
  const toNode = ensureEvidenceNodeForEntity(to);
  const edgeType = params.edgeType === "RELATED_TO" ? "SUPPORTS" : params.edgeType;

  const factors = computeDynamicConfidence({
    baseEvidenceWeight: params.confidence ?? 0.5,
    evidenceCount: 1,
    freshnessAt: new Date().toISOString(),
  });

  return linkEvidence({
    tenantId: params.tenantId,
    fromNodeId: fromNode,
    toNodeId: toNode,
    edgeType,
    confidence: factors.confidence,
  });
}

export function getEntityNeighbors(tenantId: string, entityId: string): EntityNeighbor[] {
  const entity = getEntity(tenantId, entityId);
  if (!entity) return [];

  const nodeId = ensureEvidenceNodeForEntity(entity);
  const rows = db.rawGet(
    `SELECT e.id AS entity_id, e.type, e.label, ee.edge_type, ee.confidence, 'outbound' AS direction
       FROM evidence_edges ee
       JOIN entities e ON e.metadata_json LIKE '%' || ee.to_node_id || '%'
      WHERE ee.tenant_id = ? AND ee.from_node_id = ?
     UNION ALL
     SELECT e.id AS entity_id, e.type, e.label, ee.edge_type, ee.confidence, 'inbound' AS direction
       FROM evidence_edges ee
       JOIN entities e ON e.metadata_json LIKE '%' || ee.from_node_id || '%'
      WHERE ee.tenant_id = ? AND ee.to_node_id = ?`,
    [tenantId, nodeId, tenantId, nodeId],
  ) as EntityNeighbor[];

  if (rows.length > 0) return rows;

  const outbound = db.rawGet(
    `SELECT en2.ref_id, en2.node_type, en2.label, ee.edge_type, ee.confidence
       FROM evidence_edges ee
       JOIN evidence_nodes en2 ON en2.id = ee.to_node_id
      WHERE ee.tenant_id = ? AND ee.from_node_id = ?`,
    [tenantId, nodeId],
  ) as { ref_id: string | null; node_type: string; label: string; edge_type: string; confidence: number }[];

  const inbound = db.rawGet(
    `SELECT en2.ref_id, en2.node_type, en2.label, ee.edge_type, ee.confidence
       FROM evidence_edges ee
       JOIN evidence_nodes en2 ON en2.id = ee.from_node_id
      WHERE ee.tenant_id = ? AND ee.to_node_id = ?`,
    [tenantId, nodeId],
  ) as { ref_id: string | null; node_type: string; label: string; edge_type: string; confidence: number }[];

  const neighbors: EntityNeighbor[] = [];
  for (const row of outbound) {
    if (row.ref_id) {
      const ent = db
        .rawGet(`SELECT id, type, label FROM entities WHERE tenant_id = ? AND ref_id = ? LIMIT 1`, [
          tenantId,
          row.ref_id,
        ])
        .at(0) as { id: string; type: EntityType; label: string } | undefined;
      if (ent) {
        neighbors.push({
          entity_id: ent.id,
          type: ent.type,
          label: ent.label,
          edge_type: row.edge_type as EntityNeighbor["edge_type"],
          confidence: row.confidence,
          direction: "outbound",
        });
      }
    }
  }
  for (const row of inbound) {
    if (row.ref_id) {
      const ent = db
        .rawGet(`SELECT id, type, label FROM entities WHERE tenant_id = ? AND ref_id = ? LIMIT 1`, [
          tenantId,
          row.ref_id,
        ])
        .at(0) as { id: string; type: EntityType; label: string } | undefined;
      if (ent) {
        neighbors.push({
          entity_id: ent.id,
          type: ent.type,
          label: ent.label,
          edge_type: row.edge_type as EntityNeighbor["edge_type"],
          confidence: row.confidence,
          direction: "inbound",
        });
      }
    }
  }
  return neighbors;
}

export function getEntityTimeline(tenantId: string, entityId: string): EntityTimelineEvent[] {
  const entity = getEntity(tenantId, entityId);
  if (!entity) return [];

  const events: EntityTimelineEvent[] = [];

  if (entity.ref_id) {
    if (entity.type === "decision") {
      const dec = db
        .rawGet(`SELECT id, vow, created_at, confidence FROM decision_ledger WHERE id = ?`, [
          entity.ref_id,
        ])
        .at(0) as { id: string; vow: string; created_at: string; confidence: number } | undefined;
      if (dec) {
        events.push({
          at: dec.created_at,
          kind: "decision",
          label: dec.vow,
          ref_id: dec.id,
          confidence: dec.confidence,
        });
      }
    }
    if (entity.type === "task") {
      const task = db
        .rawGet(
          `SELECT task_id, status, last_update FROM execution_ledger WHERE task_id = ?`,
          [entity.ref_id],
        )
        .at(0) as { task_id: string; status: string; last_update: string } | undefined;
      if (task) {
        events.push({
          at: task.last_update,
          kind: "execution",
          label: `Task ${task.status}`,
          ref_id: task.task_id,
        });
      }
    }
    if (entity.type === "meeting") {
      const sig = db
        .rawGet(`SELECT id, content, detected_at FROM external_signals WHERE id = ?`, [
          entity.ref_id,
        ])
        .at(0) as { id: string; content: string; detected_at: string } | undefined;
      if (sig) {
        events.push({
          at: sig.detected_at,
          kind: "signal",
          label: sig.content.slice(0, 200),
          ref_id: sig.id,
        });
      }
    }
  }

  events.push({
    at: entity.freshness_at,
    kind: "entity",
    label: `Entity registered: ${entity.label}`,
    ref_id: entity.id,
    confidence: entity.confidence,
  });

  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function upsertEntityFromRef(params: {
  tenantId: string;
  type: EntityType;
  refId: string;
  label: string;
  confidence?: number;
}): EntityRecord {
  return createEntity({
    tenantId: params.tenantId,
    type: params.type,
    refId: params.refId,
    label: params.label,
    confidence: params.confidence,
  });
}
