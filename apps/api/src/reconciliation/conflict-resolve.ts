import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { reconciliationConfig } from "./config.js";
import { classifyConflictPair } from "./conflict-detect.js";
import { claimIdentityValue, supersedeClaim } from "./claim-store.js";
import { hoursSince } from "./evidence-score.js";
import { lookupAuthority } from "./authority.js";
import type {
  ConflictStatus,
  OrgClaimRow,
  ResolutionType,
} from "./types.js";

export interface ResolveOutcome {
  conflictId: string;
  status: ConflictStatus;
  resolutionType?: ResolutionType;
  winningClaimId?: string;
  explanation: string;
  confidence: number;
  escalated: boolean;
}

function writeResolution(params: {
  tenantId: string;
  conflictId: string;
  resolutionType: ResolutionType;
  winningClaimId?: string | null;
  explanation: string;
  confidence: number;
  resolvedBy?: "SYSTEM" | "USER" | "NEW_EVIDENCE";
}): void {
  db.rawRun(`DELETE FROM conflict_resolutions WHERE conflict_id = ?`, [params.conflictId]);
  db.rawRun(
    `INSERT INTO conflict_resolutions (
      id, tenant_id, conflict_id, resolution_type, winning_claim_id,
      explanation, confidence, resolved_by, supporting_evidence_json, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      params.tenantId,
      params.conflictId,
      params.resolutionType,
      params.winningClaimId ?? null,
      params.explanation,
      params.confidence,
      params.resolvedBy ?? "SYSTEM",
      JSON.stringify(params.winningClaimId ? [params.winningClaimId] : []),
      new Date().toISOString(),
    ],
  );
}

function upsertOpenConflict(params: {
  tenantId: string;
  entityId: string;
  dimension: string;
  claimIds: string[];
  conflictType: string;
  severity: string;
  confidence: number;
}): string {
  const existing = db
    .rawGet(
      `SELECT id FROM conflicts
       WHERE tenant_id = ? AND entity_id = ? AND dimension = ?
         AND status IN ('OPEN','ESCALATED')
       ORDER BY detected_at DESC LIMIT 1`,
      [params.tenantId, params.entityId, params.dimension],
    )
    .at(0) as { id: string } | undefined;

  const now = new Date().toISOString();
  if (existing) {
    db.rawRun(
      `UPDATE conflicts SET
         conflict_type = ?, severity = ?, confidence = ?,
         claim_ids_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        params.conflictType,
        params.severity,
        params.confidence,
        JSON.stringify(params.claimIds),
        now,
        existing.id,
      ],
    );
    return existing.id;
  }

  const id = uuidv4();
  db.rawRun(
    `INSERT INTO conflicts (
      id, tenant_id, entity_id, dimension, conflict_type, severity,
      confidence, status, claim_ids_json, detected_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.entityId,
      params.dimension,
      params.conflictType,
      params.severity,
      params.confidence,
      JSON.stringify(params.claimIds),
      now,
      now,
    ],
  );
  return id;
}

function markConflictStatus(
  conflictId: string,
  status: ConflictStatus,
  decisionId?: string | null,
): void {
  db.rawRun(
    `UPDATE conflicts SET status = ?, decision_id = COALESCE(?, decision_id), updated_at = ?
     WHERE id = ?`,
    [status, decisionId ?? null, new Date().toISOString(), conflictId],
  );
}

/**
 * Attempt deterministic resolution of an incompatible claim pair.
 */
export function resolveConflictPair(params: {
  tenantId: string;
  a: OrgClaimRow;
  b: OrgClaimRow;
  sourceHint?: string;
}): ResolveOutcome {
  const { tenantId, a, b } = params;
  const { conflictType, severity } = classifyConflictPair(a, b);
  const claimIds = [a.id, b.id];
  const conflictId = upsertOpenConflict({
    tenantId,
    entityId: a.entity_id,
    dimension: a.dimension,
    claimIds,
    conflictType,
    severity,
    confidence: Math.min(a.confidence, b.confidence),
  });

  const scoreA = a.evidence_score ?? 0;
  const scoreB = b.evidence_score ?? 0;
  const newer = new Date(a.last_seen_at).getTime() >= new Date(b.last_seen_at).getTime() ? a : b;
  const older = newer.id === a.id ? b : a;
  const margin = reconciliationConfig.authorityMargin();
  const minScore = reconciliationConfig.autoResolveMinScore();

  /** Temporal / stale path */
  const olderAge = hoursSince(older.last_seen_at);
  const halfLife = lookupAuthority(tenantId, params.sourceHint || "manual", a.dimension).halfLifeHours;
  if (olderAge > halfLife * 3 && (newer.evidence_score ?? 0) >= 0.5) {
    supersedeClaim(older.id, newer.id);
    writeResolution({
      tenantId,
      conflictId,
      resolutionType: "STALE",
      winningClaimId: newer.id,
      explanation: `Older claim (${claimIdentityValue(older)}) exceeded freshness window; newer evidence (${claimIdentityValue(newer)}) prevails.`,
      confidence: Math.min(0.9, (newer.evidence_score ?? 0.6) + 0.1),
    });
    markConflictStatus(conflictId, "RESOLVED");
    return {
      conflictId,
      status: "RESOLVED",
      resolutionType: "STALE",
      winningClaimId: newer.id,
      explanation: "Stale evidence superseded",
      confidence: newer.evidence_score ?? 0.6,
      escalated: false,
    };
  }

  if (
    conflictType === "TEMPORAL_MISMATCH" &&
    new Date(newer.last_seen_at).getTime() - new Date(older.last_seen_at).getTime() >= 3600_000
  ) {
    supersedeClaim(older.id, newer.id);
    writeResolution({
      tenantId,
      conflictId,
      resolutionType: "SUPERSEDED",
      winningClaimId: newer.id,
      explanation: `Temporal progression: ${claimIdentityValue(older)} → ${claimIdentityValue(newer)}.`,
      confidence: Math.min(0.92, (newer.evidence_score ?? 0.6) + 0.15),
    });
    markConflictStatus(conflictId, "RESOLVED");
    return {
      conflictId,
      status: "RESOLVED",
      resolutionType: "SUPERSEDED",
      winningClaimId: newer.id,
      explanation: "Temporally superseded",
      confidence: newer.evidence_score ?? 0.6,
      escalated: false,
    };
  }

  /** Authority-weighted resolve */
  const high = scoreA >= scoreB ? a : b;
  const low = high.id === a.id ? b : a;
  const highScore = high.evidence_score ?? 0;
  const lowScore = low.evidence_score ?? 0;
  if (highScore >= minScore && highScore >= lowScore * margin && highScore > lowScore) {
    supersedeClaim(low.id, high.id);
    writeResolution({
      tenantId,
      conflictId,
      resolutionType: "SUPERSEDED",
      winningClaimId: high.id,
      explanation: `Authority-weighted resolution: ${high.dimension}=${claimIdentityValue(high)} (score ${highScore.toFixed(2)}) over ${claimIdentityValue(low)} (score ${lowScore.toFixed(2)}).`,
      confidence: highScore,
    });
    markConflictStatus(conflictId, "RESOLVED");
    return {
      conflictId,
      status: "RESOLVED",
      resolutionType: "SUPERSEDED",
      winningClaimId: high.id,
      explanation: "Authority margin met",
      confidence: highScore,
      escalated: false,
    };
  }

  /** Unresolved — leave OPEN; escalate.ts decides DRAFT */
  const conf = Math.max(0.2, 1 - Math.abs(highScore - lowScore));
  const explanation = `Unresolved ${a.dimension} conflict: ${claimIdentityValue(a)} vs ${claimIdentityValue(b)} (scores ${scoreA.toFixed(2)} / ${scoreB.toFixed(2)}).`;
  writeResolution({
    tenantId,
    conflictId,
    resolutionType: "UNKNOWN",
    winningClaimId: null,
    explanation,
    confidence: conf,
  });

  /** HIGH/CRITICAL unresolved pairs need a human — close scores are exactly when auto-resolve failed. */
  const shouldEscalate =
    reconciliationConfig.escalate() &&
    (severity === "HIGH" || severity === "CRITICAL");

  if (shouldEscalate) {
    markConflictStatus(conflictId, "OPEN"); // escalate.ts flips to ESCALATED
    return {
      conflictId,
      status: "OPEN",
      resolutionType: "UNKNOWN",
      explanation,
      confidence: conf,
      escalated: true,
    };
  }

  markConflictStatus(conflictId, "OPEN");
  return {
    conflictId,
    status: "OPEN",
    resolutionType: "UNKNOWN",
    explanation,
    confidence: conf,
    escalated: false,
  };
}

export function attachDecisionToConflict(conflictId: string, decisionId: string): void {
  markConflictStatus(conflictId, "ESCALATED", decisionId);
}

/** Engineering complete vs customer blocked — PARTIAL_STATE, stays OPEN (no auto-DRAFT). */
export function ensurePartialLaunchConflict(tenantId: string, entityId: string): string {
  const explanation =
    "Engineering considers implementation complete, but customer readiness is blocked (e.g. OAuth). Launch may slip.";
  const conflictId = upsertOpenConflict({
    tenantId,
    entityId,
    dimension: "LAUNCH_READINESS",
    claimIds: [],
    conflictType: "PARTIAL_STATE",
    severity: "HIGH",
    confidence: 0.72,
  });
  writeResolution({
    tenantId,
    conflictId,
    resolutionType: "UNKNOWN",
    winningClaimId: null,
    explanation,
    confidence: 0.72,
  });
  markConflictStatus(conflictId, "OPEN");
  return conflictId;
}
