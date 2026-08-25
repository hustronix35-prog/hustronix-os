import type { ConflictSeverity, ConflictType, OrgClaimRow } from "./types.js";
import { claimIdentityValue, isStateSettingClaim } from "./claim-store.js";

export function claimsIncompatible(a: OrgClaimRow, b: OrgClaimRow): boolean {
  if (a.entity_id !== b.entity_id) return false;
  if (a.dimension !== b.dimension) return false;
  if (!isStateSettingClaim(a) || !isStateSettingClaim(b)) return false;
  return claimIdentityValue(a) !== claimIdentityValue(b);
}

export function classifyConflictPair(
  a: OrgClaimRow,
  b: OrgClaimRow,
): { conflictType: ConflictType; severity: ConflictSeverity } {
  const dim = a.dimension;
  const scoreA = a.evidence_score ?? 0;
  const scoreB = b.evidence_score ?? 0;
  const newer = new Date(a.last_seen_at).getTime() >= new Date(b.last_seen_at).getTime() ? a : b;
  const older = newer.id === a.id ? b : a;
  const ageHoursOlder =
    (Date.now() - new Date(older.last_seen_at).getTime()) / 3_600_000;

  let conflictType: ConflictType = "STATE_MISMATCH";
  if (ageHoursOlder > 14 * 24 && (newer.evidence_score ?? 0) >= 0.5) {
    conflictType = "STALE_SIGNAL";
  } else if (
    Math.abs(new Date(a.last_seen_at).getTime() - new Date(b.last_seen_at).getTime()) > 3600_000 &&
    isLikelyTransition(older, newer)
  ) {
    conflictType = "TEMPORAL_MISMATCH";
  } else if (Math.abs(scoreA - scoreB) >= 0.25) {
    conflictType = "AUTHORITY_MISMATCH";
  }

  let severity: ConflictSeverity = "MEDIUM";
  if (dim === "DECISION" || dim === "DEADLINE" || dim === "LAUNCH_READINESS") {
    severity = "HIGH";
  } else if (dim === "CUSTOMER_READINESS" || dim === "DEPENDENCY") {
    severity = "MEDIUM";
  } else if (dim === "TASK_STATUS" || dim === "IMPLEMENTATION") {
    severity = "MEDIUM";
  } else {
    severity = "LOW";
  }
  if (conflictType === "STALE_SIGNAL") severity = severity === "HIGH" ? "MEDIUM" : "LOW";

  return { conflictType, severity };
}

function isLikelyTransition(older: OrgClaimRow, newer: OrgClaimRow): boolean {
  const o = claimIdentityValue(older);
  const n = claimIdentityValue(newer);
  const path = `${o}->${n}`;
  const allowed = new Set([
    "NOT_STARTED->IN_PROGRESS",
    "IN_PROGRESS->COMPLETE",
    "IN_PROGRESS->BLOCKED",
    "BLOCKED->IN_PROGRESS",
    "BLOCKED->COMPLETE",
    "AT_RISK->COMPLETE",
    "AT_RISK->BLOCKED",
    "READY->BLOCKED",
    "BLOCKED->READY",
  ]);
  return allowed.has(path);
}

/**
 * Find incompatible ACTIVE claim pairs for an entity×dimension set.
 */
/** Cross-dimension: code complete + customer blocked → launch partial state. */
export function hasLaunchPartialState(
  snaps: Array<{ dimension: string; state: string }>,
): boolean {
  const codeDone = snaps.some(
    (s) =>
      (s.dimension === "IMPLEMENTATION" || s.dimension === "CODE_INTEGRATION") &&
      String(s.state).toUpperCase() === "COMPLETE",
  );
  const custBlocked = snaps.some(
    (s) => s.dimension === "CUSTOMER_READINESS" && String(s.state).toUpperCase() === "BLOCKED",
  );
  return codeDone && custBlocked;
}

export function findConflictPairs(claims: OrgClaimRow[]): Array<[OrgClaimRow, OrgClaimRow]> {
  const active = claims.filter(isStateSettingClaim);
  const pairs: Array<[OrgClaimRow, OrgClaimRow]> = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      if (claimsIncompatible(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}
