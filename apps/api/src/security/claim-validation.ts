import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { listOpenMemoryConflicts } from "./memory-store.js";
import { recordSecurityEventV8 } from "./security-observability.js";
import { ledgerTenantInClause, memoryTenantInClause } from "./tenant-scope.js";
import { resolveTenantContext } from "./tenant-context.js";

export type ClaimValidationState =
  | "PENDING"
  | "SUPPORTED"
  | "CONTRADICTED"
  | "AMBIGUOUS"
  | "REJECTED";

export interface ClaimValidationResult {
  id: string;
  state: ClaimValidationState;
  confidence: number;
  weightedScore: number;
  sourceDiversity: number;
  requiresHumanReview: boolean;
  evidence: string[];
  contradictions: string[];
  allowedToStore: boolean;
  canVerify: boolean;
}

interface WeightedEvidence {
  key: string;
  type: string;
  source: string;
  weight: number;
  content: string;
  humanVerified: boolean;
}

const SOURCE_WEIGHT: Record<string, number> = {
  decision: 0.95,
  meeting: 0.8,
  email: 0.75,
  slack: 0.45,
  github: 0.5,
  linear: 0.55,
  signal: 0.45,
  user: 0.35,
  agent_tool: 0.2,
};

const LOW_TRUST_ONLY = new Set(["slack", "github", "signal", "user", "agent_tool"]);

function claimHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

function claimTokens(claim: string): string[] {
  return claim
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .slice(0, 6);
}

function normalizeSource(source: string | null | undefined): string {
  return String(source || "signal").toLowerCase();
}

function retrieveWeightedEvidence(tenantId: string, userId: string, claim: string): WeightedEvidence[] {
  const tokens = claimTokens(claim);
  if (!tokens.length) return [];
  const ledgerIn = ledgerTenantInClause();
  const params = [tenantId, userId];
  const byKey = new Map<string, WeightedEvidence>();

  for (const tok of tokens) {
    const signals = db.rawGet(
      `SELECT id, content, source FROM external_signals
       WHERE ${ledgerIn} AND content LIKE ? LIMIT 5`,
      [...params, `%${tok}%`],
    ) as Array<{ id: string; content: string; source: string }>;
    for (const s of signals) {
      const source = normalizeSource(s.source);
      const key = `signal:${s.id}`;
      byKey.set(key, {
        key,
        type: "signal",
        source,
        weight: SOURCE_WEIGHT[source] ?? SOURCE_WEIGHT.signal,
        content: s.content.slice(0, 160),
        humanVerified: false,
      });
    }

    const decisions = db.rawGet(
      `SELECT id, vow, status FROM decision_ledger
       WHERE ${ledgerIn} AND vow LIKE ? AND status IN ('ACTIVE', 'UNDER_REVIEW') LIMIT 3`,
      [...params, `%${tok}%`],
    ) as Array<{ id: string; vow: string; status: string }>;
    for (const d of decisions) {
      const key = `decision:${d.id}`;
      byKey.set(key, {
        key,
        type: "decision",
        source: "decision",
        weight: SOURCE_WEIGHT.decision,
        content: d.vow.slice(0, 160),
        humanVerified: d.status === "ACTIVE",
      });
    }
  }

  return [...byKey.values()].slice(0, 12);
}

function scoreEvidence(items: WeightedEvidence[]): {
  weightedScore: number;
  sourceDiversity: number;
  hasHighTrust: boolean;
  hasHumanVerified: boolean;
  lowTrustOnly: boolean;
} {
  if (!items.length) {
    return {
      weightedScore: 0,
      sourceDiversity: 0,
      hasHighTrust: false,
      hasHumanVerified: false,
      lowTrustOnly: true,
    };
  }
  const sources = new Set(items.map((i) => i.source));
  const types = new Set(items.map((i) => i.type));
  const weightedScore = Math.min(
    0.95,
    items.reduce((sum, i) => sum + i.weight, 0) / Math.max(1, items.length) +
      Math.min(0.15, types.size * 0.05),
  );
  const hasHumanVerified = items.some((i) => i.humanVerified);
  const hasHighTrust = items.some((i) => i.weight >= 0.75);
  const lowTrustOnly = [...sources].every((s) => LOW_TRUST_ONLY.has(s));
  return {
    weightedScore,
    sourceDiversity: types.size,
    hasHighTrust,
    hasHumanVerified,
    lowTrustOnly,
  };
}

function findContradictions(tenantId: string, userId: string, claim: string): string[] {
  const conflicts = listOpenMemoryConflicts(tenantId);
  const memIn = memoryTenantInClause();
  const out: string[] = [];
  for (const c of conflicts) {
    const rows = db.rawGet(`SELECT content FROM memory_records WHERE id IN (?, ?) AND ${memIn}`, [
      c.memory_a_id,
      c.memory_b_id,
      tenantId,
      userId,
    ]) as { content: string }[];
    for (const r of rows) {
      if (r.content.toLowerCase().includes(claim.slice(0, 40).toLowerCase())) {
        out.push(r.content.slice(0, 160));
      }
    }
  }
  return out.slice(0, 5);
}

/**
 * V9 Claim Validation — weighted evidence graph; repetition of untrusted sources cannot verify memory.
 */
export function validateAiClaim(params: {
  tenantId: string;
  userId?: string;
  claimText: string;
  sourceType: string;
  actorId?: string;
  minConfidence?: number;
  hasApproval?: boolean;
}): ClaimValidationResult {
  const id = uuidv4();
  const hash = claimHash(params.claimText);
  const ctx = params.userId ? resolveTenantContext(params.userId) : null;
  const orgId = ctx?.orgId ?? params.tenantId;
  const userId = ctx?.userId ?? params.userId ?? params.tenantId;

  const weighted = retrieveWeightedEvidence(orgId, userId, params.claimText);
  const scored = scoreEvidence(weighted);
  const contradictions = findContradictions(orgId, userId, params.claimText);
  const evidence = weighted.map((w) => `${w.type}:${w.content}`);

  let state: ClaimValidationState = "PENDING";
  let confidence = 0.35;
  let requiresHumanReview = true;

  if (contradictions.length > 0) {
    state = "CONTRADICTED";
    confidence = 0.15;
  } else if (
    scored.sourceDiversity >= 2 &&
    scored.weightedScore >= 0.55 &&
    !scored.lowTrustOnly &&
    (scored.hasHighTrust || scored.hasHumanVerified)
  ) {
    state = "SUPPORTED";
    confidence = scored.weightedScore;
    requiresHumanReview = !scored.hasHumanVerified && confidence < 0.72;
  } else if (weighted.length >= 1) {
    state = "AMBIGUOUS";
    confidence = Math.min(0.5, scored.weightedScore);
    requiresHumanReview = true;
  } else {
    state = "REJECTED";
    confidence = 0.2;
    requiresHumanReview = true;
  }

  const minConf = params.minConfidence ?? 0.6;
  const allowedToStore =
    state === "SUPPORTED" &&
    confidence >= minConf &&
    contradictions.length === 0 &&
    scored.sourceDiversity >= 2 &&
    !scored.lowTrustOnly;

  const canVerify =
    allowedToStore && (scored.hasHumanVerified || params.hasApproval === true) && confidence >= 0.7;

  db.rawRun(
    `INSERT INTO ai_claim_validations (
      id, tenant_id, claim_text, claim_hash, validation_state, confidence,
      evidence_json, contradiction_json, requires_human_review, weighted_score, source_diversity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      orgId,
      params.claimText,
      hash,
      state,
      confidence,
      JSON.stringify(evidence),
      JSON.stringify(contradictions),
      requiresHumanReview ? 1 : 0,
      scored.weightedScore,
      scored.sourceDiversity,
    ],
  );

  if (!allowedToStore) {
    recordSecurityEventV8({
      actorId: params.actorId ?? null,
      action: "claim.validation_rejected",
      resourceType: "claim",
      resourceId: id,
      tenantId: orgId,
      result: "BLOCKED",
      riskLevel: state === "CONTRADICTED" ? "HIGH" : "MEDIUM",
      metadata: {
        state,
        sourceType: params.sourceType,
        weightedScore: scored.weightedScore,
        sourceDiversity: scored.sourceDiversity,
        lowTrustOnly: scored.lowTrustOnly,
      },
    });
  }

  return {
    id,
    state,
    confidence,
    weightedScore: scored.weightedScore,
    sourceDiversity: scored.sourceDiversity,
    requiresHumanReview,
    evidence,
    contradictions,
    allowedToStore,
    canVerify,
  };
}
