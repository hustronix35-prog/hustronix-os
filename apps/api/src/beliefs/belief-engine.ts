import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { computeDynamicConfidence } from "../state/confidence.js";
import { linkEvidence, upsertEvidenceNode } from "../security/evidence-graph.js";
import { resolveTenantContext } from "../security/tenant-context.js";

export type BeliefStatus = "PROPOSED" | "CONFIRMED" | "REFUTED" | "SUPERSEDED";

export interface BeliefRow {
  id: string;
  tenant_id: string;
  entity_id: string | null;
  statement: string;
  confidence: number;
  status: BeliefStatus;
  evidence_count: number;
  contradiction_count: number;
  factors_json: string;
  source_decision_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BeliefEvidenceInput {
  evidenceType: "signal" | "fact" | "decision" | "meeting" | "belief" | "entity";
  evidenceId: string;
  relationship?: "SUPPORTS" | "CONTRADICTS" | "OBSERVED_IN";
  sourceQuality?: number;
}

export function createBelief(params: {
  tenantId: string;
  statement: string;
  entityId?: string | null;
  sourceDecisionId?: string | null;
  initialConfidence?: number;
}): BeliefRow {
  const id = uuidv4();
  const factors = computeDynamicConfidence({
    baseEvidenceWeight: params.initialConfidence ?? 0.45,
    evidenceCount: 0,
  });
  db.rawRun(
    `INSERT INTO beliefs (
      id, tenant_id, entity_id, statement, confidence, status, factors_json, source_decision_id
    ) VALUES (?, ?, ?, ?, ?, 'PROPOSED', ?, ?)`,
    [
      id,
      params.tenantId,
      params.entityId ?? null,
      params.statement.trim(),
      factors.confidence,
      JSON.stringify(factors),
      params.sourceDecisionId ?? null,
    ],
  );
  return getBelief(id)!;
}

export function getBelief(id: string): BeliefRow | null {
  return (db.rawGet(`SELECT * FROM beliefs WHERE id = ?`, [id]).at(0) as BeliefRow | undefined) ?? null;
}

export function listBeliefs(tenantId: string, status?: BeliefStatus): BeliefRow[] {
  if (status) {
    return db.rawGet(
      `SELECT * FROM beliefs WHERE tenant_id = ? AND status = ? ORDER BY updated_at DESC`,
      [tenantId, status],
    ) as BeliefRow[];
  }
  return db.rawGet(
    `SELECT * FROM beliefs WHERE tenant_id = ? ORDER BY updated_at DESC`,
    [tenantId],
  ) as BeliefRow[];
}

/**
 * Apply evidence to a belief — updates confidence via dynamic formula and may promote/refute.
 */
export function applyEvidence(beliefId: string, evidence: BeliefEvidenceInput): BeliefRow {
  const belief = getBelief(beliefId);
  if (!belief) throw new Error("Belief not found.");

  const rel = evidence.relationship ?? "SUPPORTS";
  const linkId = uuidv4();
  db.rawRun(
    `INSERT INTO belief_evidence (id, tenant_id, belief_id, evidence_type, evidence_id, relationship, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      linkId,
      belief.tenant_id,
      beliefId,
      evidence.evidenceType,
      evidence.evidenceId,
      rel,
      evidence.sourceQuality ?? 0.6,
    ],
  );

  const supportCount =
    rel === "SUPPORTS" ? belief.evidence_count + 1 : belief.evidence_count;
  const contradictionCount =
    rel === "CONTRADICTS" ? belief.contradiction_count + 1 : belief.contradiction_count;

  const ageDays =
    (Date.now() - new Date(belief.updated_at).getTime()) / (1000 * 60 * 60 * 24);
  const factors = computeDynamicConfidence({
    baseEvidenceWeight: belief.confidence,
    sourceQuality: evidence.sourceQuality ?? 0.6,
    evidenceCount: supportCount,
    contradictionPenalty: Math.min(0.4, 0.12 * contradictionCount),
    ageDays,
    humanVerificationBoost: rel === "SUPPORTS" && evidence.evidenceType === "fact" ? 0.08 : 0,
  });

  let status: BeliefStatus = belief.status;
  if (rel === "CONTRADICTS" && factors.confidence < 0.35) status = "REFUTED";
  else if (factors.confidence >= 0.72 && supportCount >= 2) status = "CONFIRMED";
  else if (belief.status === "PROPOSED" && factors.confidence >= 0.55) status = "PROPOSED";

  if (rel === "CONTRADICTS" && belief.status === "CONFIRMED") {
    db.rawRun(
      `INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`,
      [
        "BELIEF_CONFLICT",
        `Contradicting evidence on CONFIRMED belief ${beliefId}`,
        beliefId,
      ],
    );
  }

  db.rawRun(
    `UPDATE beliefs SET confidence = ?, status = ?, evidence_count = ?, contradiction_count = ?,
     factors_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [
      factors.confidence,
      status,
      supportCount,
      contradictionCount,
      JSON.stringify(factors),
      beliefId,
    ],
  );

  if (belief.entity_id) {
    const nodeId = upsertEvidenceNode({
      tenantId: belief.tenant_id,
      nodeType: "fact",
      refId: beliefId,
      label: belief.statement.slice(0, 500),
      confidence: factors.confidence,
    });
    const evidenceNode = upsertEvidenceNode({
      tenantId: belief.tenant_id,
      nodeType: evidence.evidenceType === "decision" ? "decision" : "signal",
      refId: evidence.evidenceId,
      label: `${evidence.evidenceType}:${evidence.evidenceId}`.slice(0, 500),
    });
    linkEvidence({
      tenantId: belief.tenant_id,
      fromNodeId: nodeId,
      toNodeId: evidenceNode,
      edgeType: rel === "CONTRADICTS" ? "CONTRADICTS" : "SUPPORTS",
      confidence: factors.confidence,
    });
  }

  return getBelief(beliefId)!;
}

/** Promote ranked hypotheses from an ACTIVE decision commit into beliefs. */
export function promoteBeliefsFromDecision(tenantId: string, decisionId: string): string[] {
  const row = db.getDecisionLedgerRow(decisionId);
  if (!row?.decision_reasoning) return [];

  let memo: { ranked_hypotheses?: { id?: string; statement?: string; probability_0_1?: number }[] };
  try {
    memo = JSON.parse(String(row.decision_reasoning));
  } catch {
    return [];
  }

  const created: string[] = [];
  for (const h of memo.ranked_hypotheses ?? []) {
    if (!h?.statement?.trim()) continue;
    const belief = createBelief({
      tenantId,
      statement: h.statement.trim(),
      sourceDecisionId: decisionId,
      initialConfidence: h.probability_0_1 ?? 0.4,
    });
    applyEvidence(belief.id, {
      evidenceType: "decision",
      evidenceId: decisionId,
      relationship: "SUPPORTS",
      sourceQuality: 0.75,
    });
    created.push(belief.id);
  }
  return created;
}

export function explainBelief(beliefId: string): Record<string, unknown> | null {
  const belief = getBelief(beliefId);
  if (!belief) return null;

  const evidence = db.rawGet(
    `SELECT evidence_type, evidence_id, relationship, confidence, created_at
     FROM belief_evidence WHERE belief_id = ? ORDER BY created_at DESC`,
    [beliefId],
  );

  let factors: Record<string, unknown> = {};
  try {
    factors = JSON.parse(belief.factors_json || "{}");
  } catch {
    /* ignore */
  }

  return {
    id: belief.id,
    tenant_id: belief.tenant_id,
    entity_id: belief.entity_id,
    statement: belief.statement,
    status: belief.status,
    confidence: belief.confidence,
    confidence_factors: factors,
    supporting_evidence_count: belief.evidence_count,
    contradiction_count: belief.contradiction_count,
    source_decision_id: belief.source_decision_id,
    evidence_links: evidence,
    created_at: belief.created_at,
    updated_at: belief.updated_at,
  };
}

export function onDecisionCommitted(userId: string, decisionId: string): void {
  const ctx = resolveTenantContext(userId);
  promoteBeliefsFromDecision(ctx.orgId, decisionId);
}
