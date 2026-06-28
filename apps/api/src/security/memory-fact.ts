import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import {
  insertMemoryRecord,
  type MemoryRecordInput,
  type MemoryRecordRow,
  type MemoryVerificationState,
} from "./memory-store.js";
import { validateAiClaim } from "./claim-validation.js";
import { recordSecurityEventV8 } from "./security-observability.js";
import { recordMemoryProvenance, listMemoryProvenance } from "./memory-provenance.js";

export type MemoryEvidenceType = "signal" | "meeting" | "decision" | "email" | "user" | "task";

export interface MemoryFact extends MemoryRecordRow {
  evidence_count: number;
  contradiction_count: number;
  created_by: string | null;
  updated_by: string | null;
}

export interface MemoryFactInput extends MemoryRecordInput {
  createdBy: string;
  workspaceId?: string | null;
  approvalId?: string | null;
  evidenceLinks?: Array<{
    type: MemoryEvidenceType;
    id: string;
    relationship?: "SUPPORTS" | "CONTRADICTS" | "OBSERVED_IN";
    confidence?: number;
  }>;
  /** Skip claim validation only for human-verified direct input. */
  skipClaimValidation?: boolean;
}

export function linkMemoryEvidence(params: {
  tenantId: string;
  factId: string;
  evidenceType: MemoryEvidenceType;
  evidenceId: string;
  relationship?: "SUPPORTS" | "CONTRADICTS" | "OBSERVED_IN";
  confidence?: number;
}): string {
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO memory_evidence (id, tenant_id, fact_id, evidence_type, evidence_id, relationship, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.factId,
      params.evidenceType,
      params.evidenceId,
      params.relationship ?? "SUPPORTS",
      params.confidence ?? 0.5,
    ],
  );
  const rel = params.relationship ?? "SUPPORTS";
  const col = rel === "CONTRADICTS" ? "contradiction_count" : "evidence_count";
  db.rawRun(
    `UPDATE memory_records SET ${col} = COALESCE(${col}, 0) + 1, updated_by = ? WHERE id = ?`,
    [params.tenantId, params.factId],
  );
  return id;
}

/**
 * Store a MemoryFact with mandatory provenance and claim validation for AI-sourced facts.
 */
export function storeMemoryFact(input: MemoryFactInput): MemoryFact {
  if (!input.skipClaimValidation && (input.sourceType === "agent_tool" || input.sourceType === "system")) {
    const validation = validateAiClaim({
      tenantId: input.tenantId,
      userId: input.createdBy,
      claimText: input.content,
      sourceType: input.sourceType,
      actorId: input.createdBy,
      hasApproval: Boolean(input.approvalId),
    });
    if (!validation.allowedToStore) {
      recordSecurityEventV8({
        actorId: input.createdBy,
        action: "memory.poisoning_blocked",
        resourceType: "memory_fact",
        tenantId: input.tenantId,
        result: "BLOCKED",
        riskLevel: "HIGH",
        metadata: { validationState: validation.state, claimId: validation.id },
      });
      throw new Error(
        `Memory fact rejected by claim validation (${validation.state}). Human review required.`,
      );
    }
    input.confidence = Math.min(input.confidence ?? 0.7, validation.confidence);
    if (validation.canVerify) {
      input.verificationState = "VERIFIED";
    } else {
      input.verificationState = "UNVERIFIED";
    }
    recordMemoryProvenance({
      tenantId: input.tenantId,
      eventType: "VALIDATION",
      actorId: input.createdBy,
      sourceType: input.sourceType,
      payload: {
        validationId: validation.id,
        state: validation.state,
        weightedScore: validation.weightedScore,
        sourceDiversity: validation.sourceDiversity,
      },
    });
  }

  const row = insertMemoryRecord(input);
  db.rawRun(
    `UPDATE memory_records SET created_by = ?, updated_by = ?, workspace_id = COALESCE(?, workspace_id) WHERE id = ?`,
    [input.createdBy, input.createdBy, input.workspaceId ?? null, row.id],
  );

  recordMemoryProvenance({
    tenantId: input.tenantId,
    factId: row.id,
    eventType: "ORIGIN",
    actorId: input.createdBy,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    payload: { contentPreview: input.content.slice(0, 120) },
  });

  for (const link of input.evidenceLinks ?? []) {
    linkMemoryEvidence({
      tenantId: input.tenantId,
      factId: row.id,
      evidenceType: link.type,
      evidenceId: link.id,
      relationship: link.relationship,
      confidence: link.confidence,
    });
  }

  if (input.sourceId && input.sourceType) {
    const evType = sourceTypeToEvidence(input.sourceType);
    if (evType) {
      linkMemoryEvidence({
        tenantId: input.tenantId,
        factId: row.id,
        evidenceType: evType,
        evidenceId: input.sourceId,
      });
    }
  }

  const fact = getMemoryFact(input.tenantId, row.id);
  if (!fact) throw new Error("Failed to load memory fact after store.");
  return fact;
}

function sourceTypeToEvidence(
  sourceType: MemoryRecordInput["sourceType"],
): MemoryEvidenceType | null {
  switch (sourceType) {
    case "slack":
      return "signal";
    case "email":
      return "email";
    case "meeting":
      return "meeting";
    case "user_chat":
      return "user";
    default:
      return null;
  }
}

export function getMemoryFact(tenantId: string, factId: string): MemoryFact | null {
  const row = db
    .rawGet(`SELECT * FROM memory_records WHERE id = ? AND tenant_id = ?`, [factId, tenantId])
    .at(0) as MemoryFact | undefined;
  return row ?? null;
}

export function getMemoryFactProvenance(factId: string): {
  fact: MemoryFact | null;
  evidence: Array<{
    evidence_type: string;
    evidence_id: string;
    relationship: string;
    confidence: number;
  }>;
} {
  const fact = db.rawGet(`SELECT * FROM memory_records WHERE id = ?`, [factId]).at(0) as MemoryFact | null;
  const evidence = db.rawGet(
    `SELECT evidence_type, evidence_id, relationship, confidence FROM memory_evidence WHERE fact_id = ?`,
    [factId],
  ) as Array<{
    evidence_type: string;
    evidence_id: string;
    relationship: string;
    confidence: number;
  }>;
  return { fact, evidence };
}

export function explainMemoryFact(factId: string): Record<string, unknown> | null {
  const { fact, evidence } = getMemoryFactProvenance(factId);
  if (!fact) return null;
  return {
    id: fact.id,
    tenant_id: fact.tenant_id,
    who: fact.author,
    source: { type: fact.source_type, id: fact.source_id },
    when: fact.observed_at,
    confidence: fact.confidence,
    verification_state: fact.verification_state as MemoryVerificationState,
    supporting_evidence_count: fact.evidence_count ?? 0,
    contradiction_count: fact.contradiction_count ?? 0,
    evidence_links: evidence,
    provenance_chain: listMemoryProvenance(factId),
    content: fact.content,
  };
}
