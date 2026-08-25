import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { scoreEvidence } from "./evidence-score.js";
import type {
  CandidateClaim,
  ClaimIntent,
  ExtractorKind,
  OrgClaimRow,
  ScoredEvidenceFactors,
} from "./types.js";
import { STATE_SETTING_INTENTS } from "./types.js";

function intentBucket(intent: ClaimIntent): string {
  if (intent === "DECISION" || intent === "COMMITMENT") return intent;
  if (intent === "PROPOSAL" || intent === "QUESTION" || intent === "OPINION" || intent === "PREDICTION") {
    return intent;
  }
  return "ASSERTION";
}

export function computeClaimKey(params: {
  tenantId: string;
  entityId: string;
  dimension: string;
  value: string;
  state: string | null;
  intent: ClaimIntent;
}): string {
  const normalized = String(params.state || params.value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const raw = [
    params.tenantId,
    params.entityId,
    params.dimension,
    normalized,
    intentBucket(params.intent),
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function signalAlreadyAttached(signalId: string): boolean {
  const row = db
    .rawGet(`SELECT 1 AS ok FROM claim_evidence WHERE signal_id = ? LIMIT 1`, [signalId])
    .at(0);
  return Boolean(row);
}

export interface UpsertClaimResult {
  claim: OrgClaimRow;
  created: boolean;
  evidenceId: string | null;
  factors: ScoredEvidenceFactors;
}

/**
 * Upsert first-class claim and attach signal as SUPPORTS evidence.
 */
export function upsertClaimWithEvidence(params: {
  tenantId: string;
  candidate: CandidateClaim;
  signalId: string;
  source: string;
  detectedAt?: string | null;
  extractor?: ExtractorKind;
}): UpsertClaimResult {
  const c = params.candidate;
  const now = new Date().toISOString();
  const claimKey = computeClaimKey({
    tenantId: params.tenantId,
    entityId: c.entityId,
    dimension: c.dimension,
    value: c.value,
    state: c.state,
    intent: c.intent,
  });

  const factors = scoreEvidence({
    tenantId: params.tenantId,
    source: params.source,
    dimension: c.dimension,
    detectedAt: params.detectedAt,
    specificity: c.specificity,
    directness: c.directness,
  });

  const existing = db
    .rawGet(`SELECT * FROM claims WHERE tenant_id = ? AND claim_key = ? LIMIT 1`, [
      params.tenantId,
      claimKey,
    ])
    .at(0) as OrgClaimRow | undefined;

  let claim: OrgClaimRow;
  let created = false;

  if (existing) {
    const newScore = Math.max(existing.evidence_score ?? 0, factors.score);
    const newConf = Math.max(existing.confidence, c.confidence);
    db.rawRun(
      `UPDATE claims SET
         last_seen_at = ?,
         evidence_score = ?,
         confidence = ?,
         entity_label = COALESCE(?, entity_label),
         status = CASE WHEN status = 'SUPERSEDED' THEN 'ACTIVE' ELSE status END,
         superseded_by_claim_id = CASE WHEN status = 'SUPERSEDED' THEN NULL ELSE superseded_by_claim_id END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [now, newScore, newConf, c.entityLabel, existing.id],
    );
    claim = {
      ...existing,
      last_seen_at: now,
      evidence_score: newScore,
      confidence: newConf,
      status: existing.status === "SUPERSEDED" ? "ACTIVE" : existing.status,
    };
  } else {
    const id = uuidv4();
    db.rawRun(
      `INSERT INTO claims (
        id, tenant_id, entity_id, entity_label, dimension, predicate, value, state,
        intent, status, confidence, evidence_score, claim_key,
        first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      [
        id,
        params.tenantId,
        c.entityId,
        c.entityLabel,
        c.dimension,
        c.predicate,
        c.value,
        c.state,
        c.intent,
        c.confidence,
        factors.score,
        claimKey,
        now,
        now,
      ],
    );
    created = true;
    claim = {
      id,
      tenant_id: params.tenantId,
      entity_id: c.entityId,
      entity_label: c.entityLabel,
      dimension: c.dimension,
      predicate: c.predicate,
      value: c.value,
      state: c.state,
      intent: c.intent,
      status: "ACTIVE",
      confidence: c.confidence,
      evidence_score: factors.score,
      claim_key: claimKey,
      first_seen_at: now,
      last_seen_at: now,
      superseded_by_claim_id: null,
    };
  }

  const evidenceId = uuidv4();
  let attached: string | null = evidenceId;
  try {
    db.rawRun(
      `INSERT INTO claim_evidence (
        id, tenant_id, claim_id, signal_id, relationship,
        authority, freshness, reliability, specificity, directness, score, extractor
      ) VALUES (?, ?, ?, ?, 'SUPPORTS', ?, ?, ?, ?, ?, ?, ?)`,
      [
        evidenceId,
        params.tenantId,
        claim.id,
        params.signalId,
        factors.authority,
        factors.freshness,
        factors.reliability,
        factors.specificity,
        factors.directness,
        factors.score,
        params.extractor ?? "heuristic",
      ],
    );
  } catch {
    /** UNIQUE(claim_id, signal_id, relationship) — already attached */
    attached = null;
  }

  return { claim, created, evidenceId: attached, factors };
}

export function listActiveClaimsForEntityDimension(
  tenantId: string,
  entityId: string,
  dimension: string,
): OrgClaimRow[] {
  return db.rawGet(
    `SELECT * FROM claims
     WHERE tenant_id = ? AND entity_id = ? AND dimension = ? AND status = 'ACTIVE'
     ORDER BY COALESCE(evidence_score, 0) DESC, last_seen_at DESC`,
    [tenantId, entityId, dimension],
  ) as OrgClaimRow[];
}

export function supersedeClaim(loserId: string, winnerId: string): void {
  db.rawRun(
    `UPDATE claims SET status = 'SUPERSEDED', superseded_by_claim_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [winnerId, loserId],
  );
}

export function isStateSettingClaim(claim: OrgClaimRow): boolean {
  return STATE_SETTING_INTENTS.has(claim.intent as ClaimIntent);
}

export function claimIdentityValue(claim: OrgClaimRow): string {
  return String(claim.state || claim.value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}
