import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { upsertEntityFromRef } from "../entities/store.js";
import type { EntityType } from "../entities/types.js";

export type EvidenceNodeType =
  | "fact"
  | "decision"
  | "task"
  | "meeting"
  | "signal"
  | "person"
  | "project"
  | "customer"
  | "company"
  | "team"
  | "competitor"
  | "metric"
  | "feature"
  | "commitment";

export type EvidenceEdgeType =
  | "CAUSED_BY"
  | "OBSERVED_IN"
  | "OWNED_BY"
  | "SUPPORTS"
  | "CONTRADICTS"
  | "SUPERSEDES";

const ENTITY_NODE_TYPES = new Set<string>([
  "company",
  "team",
  "decision",
  "task",
  "customer",
  "competitor",
  "metric",
  "feature",
  "commitment",
  "meeting",
  "person",
  "project",
]);

function syncEntityForNode(params: {
  tenantId: string;
  nodeType: EvidenceNodeType;
  refId?: string | null;
  label: string;
  confidence?: number;
}): void {
  if (!ENTITY_NODE_TYPES.has(params.nodeType) || !params.refId) return;
  try {
    upsertEntityFromRef({
      tenantId: params.tenantId,
      type: params.nodeType as EntityType,
      refId: params.refId,
      label: params.label,
      confidence: params.confidence,
    });
  } catch {
    /* entity sync is best-effort */
  }
}

export function upsertEvidenceNode(params: {
  tenantId: string;
  nodeType: EvidenceNodeType;
  refId?: string | null;
  label: string;
  confidence?: number;
  verificationState?: string;
  sourceType?: string | null;
  sourceId?: string | null;
}): string {
  if (params.refId) {
    const existing = db
      .rawGet(
        `SELECT id FROM evidence_nodes WHERE tenant_id = ? AND node_type = ? AND ref_id = ?`,
        [params.tenantId, params.nodeType, params.refId],
      )
      .at(0) as { id: string } | undefined;
    if (existing) {
      syncEntityForNode({
        tenantId: params.tenantId,
        nodeType: params.nodeType,
        refId: params.refId,
        label: params.label,
        confidence: params.confidence,
      });
      return existing.id;
    }
  }
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO evidence_nodes (
      id, tenant_id, node_type, ref_id, label, confidence, verification_state, source_type, source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.nodeType,
      params.refId ?? null,
      params.label.slice(0, 500),
      params.confidence ?? 0.5,
      params.verificationState ?? "UNVERIFIED",
      params.sourceType ?? null,
      params.sourceId ?? null,
    ],
  );
  syncEntityForNode({
    tenantId: params.tenantId,
    nodeType: params.nodeType,
    refId: params.refId,
    label: params.label,
    confidence: params.confidence,
  });
  return id;
}

export function linkEvidence(params: {
  tenantId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: EvidenceEdgeType;
  confidence?: number;
}): string {
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO evidence_edges (id, tenant_id, from_node_id, to_node_id, edge_type, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.fromNodeId,
      params.toNodeId,
      params.edgeType,
      params.confidence ?? 0.5,
    ],
  );
  return id;
}

export function indexSignalAsEvidence(params: {
  tenantId: string;
  signalId: string;
  label: string;
  sourceType: string;
  confidence?: number;
}): string {
  return upsertEvidenceNode({
    tenantId: params.tenantId,
    nodeType: "signal",
    refId: params.signalId,
    label: params.label,
    confidence: params.confidence,
    sourceType: params.sourceType,
    sourceId: params.signalId,
  });
}

export function indexMemoryAsEvidence(params: {
  tenantId: string;
  memoryId: string;
  label: string;
  confidence?: number;
}): string {
  return upsertEvidenceNode({
    tenantId: params.tenantId,
    nodeType: "fact",
    refId: params.memoryId,
    label: params.label,
    confidence: params.confidence,
    sourceType: "memory_record",
    sourceId: params.memoryId,
  });
}

export function countEvidenceNodes(tenantId: string): number {
  const row = db
    .rawGet(`SELECT COUNT(*) AS c FROM evidence_nodes WHERE tenant_id = ?`, [tenantId])
    .at(0) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function countContradictionEdges(tenantId: string): number {
  const row = db
    .rawGet(
      `SELECT COUNT(*) AS c FROM evidence_edges WHERE tenant_id = ? AND edge_type = 'CONTRADICTS'`,
      [tenantId],
    )
    .at(0) as { c: number } | undefined;
  return row?.c ?? 0;
}

export interface GraphImpactNode {
  id: string;
  node_type: string;
  label: string;
  ref_id: string | null;
  confidence: number;
  depth: number;
}

export interface GraphImpactEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  confidence: number;
}

export function applyGraphPatch(params: {
  tenantId: string;
  refType: EvidenceNodeType;
  refId: string;
  label: string;
  linkToRefId?: string;
  linkToType?: EvidenceNodeType;
  edgeType?: EvidenceEdgeType;
}): { nodeId: string; edgeId?: string } {
  const nodeId = upsertEvidenceNode({
    tenantId: params.tenantId,
    nodeType: params.refType,
    refId: params.refId,
    label: params.label,
  });
  let edgeId: string | undefined;
  if (params.linkToRefId && params.linkToType) {
    const toId = upsertEvidenceNode({
      tenantId: params.tenantId,
      nodeType: params.linkToType,
      refId: params.linkToRefId,
      label: params.linkToRefId,
    });
    edgeId = linkEvidence({
      tenantId: params.tenantId,
      fromNodeId: nodeId,
      toNodeId: toId,
      edgeType: params.edgeType ?? "SUPPORTS",
    });
  }
  return { nodeId, edgeId };
}

export function getGraphImpact(params: {
  tenantId: string;
  entityId?: string;
  refId?: string;
  nodeType?: EvidenceNodeType;
  direction?: "upstream" | "downstream" | "both";
  depth?: number;
}): { nodes: GraphImpactNode[]; edges: GraphImpactEdge[] } {
  const depth = Math.min(Math.max(params.depth ?? 3, 1), 5);
  let rootNodeId: string | null = null;

  if (params.entityId) {
    const ent = db
      .rawGet(`SELECT metadata_json, ref_id, type, label FROM entities WHERE id = ? AND tenant_id = ?`, [
        params.entityId,
        params.tenantId,
      ])
      .at(0) as { metadata_json: string; ref_id: string | null; type: string; label: string } | undefined;
    if (ent) {
      try {
        const meta = JSON.parse(ent.metadata_json) as { evidence_node_id?: string };
        if (meta.evidence_node_id) rootNodeId = meta.evidence_node_id;
      } catch {
        /* ignore */
      }
      if (!rootNodeId && ent.ref_id) {
        rootNodeId = upsertEvidenceNode({
          tenantId: params.tenantId,
          nodeType: ent.type as EvidenceNodeType,
          refId: ent.ref_id,
          label: ent.label,
        });
      }
    }
  } else if (params.refId && params.nodeType) {
    rootNodeId = upsertEvidenceNode({
      tenantId: params.tenantId,
      nodeType: params.nodeType,
      refId: params.refId,
      label: params.refId,
    });
  }

  if (!rootNodeId) return { nodes: [], edges: [] };

  const nodes = new Map<string, GraphImpactNode>();
  const edges = new Map<string, GraphImpactEdge>();
  const visited = new Set<string>();
  let frontier = [{ id: rootNodeId, depth: 0 }];

  while (frontier.length) {
    const next: typeof frontier = [];
    for (const { id, depth: d } of frontier) {
      if (visited.has(id) || d > depth) continue;
      visited.add(id);
      const node = db
        .rawGet(`SELECT id, node_type, label, ref_id, confidence FROM evidence_nodes WHERE id = ?`, [id])
        .at(0) as GraphImpactNode | undefined;
      if (node) nodes.set(id, { ...node, depth: d });

      const outbound =
        params.direction !== "upstream"
          ? (db.rawGet(
              `SELECT id, from_node_id, to_node_id, edge_type, confidence FROM evidence_edges
               WHERE tenant_id = ? AND from_node_id = ?`,
              [params.tenantId, id],
            ) as GraphImpactEdge[])
          : [];
      const inbound =
        params.direction !== "downstream"
          ? (db.rawGet(
              `SELECT id, from_node_id, to_node_id, edge_type, confidence FROM evidence_edges
               WHERE tenant_id = ? AND to_node_id = ?`,
              [params.tenantId, id],
            ) as GraphImpactEdge[])
          : [];

      for (const e of [...outbound, ...inbound]) {
        edges.set(e.id, e);
        const neighbor = e.from_node_id === id ? e.to_node_id : e.from_node_id;
        if (!visited.has(neighbor) && d < depth) next.push({ id: neighbor, depth: d + 1 });
      }
    }
    frontier = next;
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
