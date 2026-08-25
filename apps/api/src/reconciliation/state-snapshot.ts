import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import {
  claimIdentityValue,
  isStateSettingClaim,
  listActiveClaimsForEntityDimension,
} from "./claim-store.js";
import type { OrgClaimRow } from "./types.js";

/**
 * Typed entity × dimension snapshot — separate from organizational_truth_snapshots.
 */
export function upsertEntityStateSnapshot(params: {
  tenantId: string;
  entityId: string;
  dimension: string;
  winningClaim?: OrgClaimRow | null;
  supporting?: OrgClaimRow[];
  contradicting?: OrgClaimRow[];
  resolutionMethod: string;
  unknownReason?: string | null;
}): void {
  const winning = params.winningClaim;
  const state = winning
    ? String(winning.state || claimIdentityValue(winning) || "UNKNOWN")
    : "UNKNOWN";
  const value = winning?.value ?? null;
  const confidence = winning?.evidence_score ?? winning?.confidence ?? 0.3;
  const now = new Date().toISOString();

  const existing = db
    .rawGet(
      `SELECT id FROM entity_state_snapshots
       WHERE tenant_id = ? AND entity_id = ? AND dimension = ? LIMIT 1`,
      [params.tenantId, params.entityId, params.dimension],
    )
    .at(0) as { id: string } | undefined;

  const supportingJson = JSON.stringify((params.supporting ?? []).map((c) => c.id));
  const contradictingJson = JSON.stringify((params.contradicting ?? []).map((c) => c.id));

  if (existing) {
    db.rawRun(
      `UPDATE entity_state_snapshots SET
         state = ?, value = ?, confidence = ?, winning_claim_id = ?,
         supporting_claim_ids_json = ?, contradicting_claim_ids_json = ?,
         resolution_method = ?, unknown_reason = ?, last_updated_at = ?
       WHERE id = ?`,
      [
        state,
        value,
        confidence,
        winning?.id ?? null,
        supportingJson,
        contradictingJson,
        params.resolutionMethod,
        params.unknownReason ?? null,
        now,
        existing.id,
      ],
    );
    return;
  }

  db.rawRun(
    `INSERT INTO entity_state_snapshots (
      id, tenant_id, entity_id, dimension, state, value, confidence,
      winning_claim_id, supporting_claim_ids_json, contradicting_claim_ids_json,
      resolution_method, unknown_reason, last_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      params.tenantId,
      params.entityId,
      params.dimension,
      state,
      value,
      confidence,
      winning?.id ?? null,
      supportingJson,
      contradictingJson,
      params.resolutionMethod,
      params.unknownReason ?? null,
      now,
    ],
  );
}

/** Refresh snapshot from current ACTIVE claims for entity×dimension. */
export function refreshSnapshotFromClaims(
  tenantId: string,
  entityId: string,
  dimension: string,
  resolutionMethod = "DETERMINISTIC",
): void {
  const active = listActiveClaimsForEntityDimension(tenantId, entityId, dimension).filter(
    isStateSettingClaim,
  );
  if (!active.length) {
    upsertEntityStateSnapshot({
      tenantId,
      entityId,
      dimension,
      winningClaim: null,
      supporting: [],
      contradicting: [],
      resolutionMethod: "UNKNOWN",
      unknownReason: "No active state-setting claims",
    });
    return;
  }

  /** Group by identity value */
  const byVal = new Map<string, OrgClaimRow[]>();
  for (const c of active) {
    const k = claimIdentityValue(c);
    const arr = byVal.get(k) ?? [];
    arr.push(c);
    byVal.set(k, arr);
  }

  if (byVal.size === 1) {
    const winner = active.sort(
      (x, y) => (y.evidence_score ?? 0) - (x.evidence_score ?? 0),
    )[0]!;
    upsertEntityStateSnapshot({
      tenantId,
      entityId,
      dimension,
      winningClaim: winner,
      supporting: active,
      contradicting: [],
      resolutionMethod,
    });
    return;
  }

  /** Still conflicting ACTIVE claims — pick top score but mark UNKNOWN method if open conflict */
  const sorted = [...active].sort(
    (x, y) => (y.evidence_score ?? 0) - (x.evidence_score ?? 0),
  );
  const top = sorted[0]!;
  const topVal = claimIdentityValue(top);
  const supporting = sorted.filter((c) => claimIdentityValue(c) === topVal);
  const contradicting = sorted.filter((c) => claimIdentityValue(c) !== topVal);
  upsertEntityStateSnapshot({
    tenantId,
    entityId,
    dimension,
    winningClaim: top,
    supporting,
    contradicting,
    resolutionMethod: contradicting.length ? "UNKNOWN" : resolutionMethod,
    unknownReason: contradicting.length
      ? "Open competing claims; snapshot shows best-supported value"
      : null,
  });
}
