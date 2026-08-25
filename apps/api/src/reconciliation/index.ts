import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { resolveTenantContext } from "../security/tenant-context.js";
import { reconciliationConfig } from "./config.js";
import { extractClaimsHeuristic } from "./claim-extract.js";
import {
  isStateSettingClaim,
  listActiveClaimsForEntityDimension,
  signalAlreadyAttached,
  upsertClaimWithEvidence,
} from "./claim-store.js";
import { findConflictPairs, hasLaunchPartialState } from "./conflict-detect.js";
import { ensurePartialLaunchConflict, resolveConflictPair } from "./conflict-resolve.js";
import { refreshSnapshotFromClaims } from "./state-snapshot.js";
import { escalateConflictToDraftDecision } from "./escalate.js";
import { seedGlobalAuthorityRules } from "./authority.js";
import type { OrgClaimRow, ReconciliationResult } from "./types.js";

let seeded = false;

function ensureSeeded(): void {
  if (seeded) return;
  try {
    seedGlobalAuthorityRules();
    seeded = true;
  } catch (e) {
    console.warn("[reconciliation] authority seed failed:", e);
  }
}

export interface RunReconciliationOptions {
  force?: boolean;
}

/**
 * Phase 1 reconciliation orchestrator.
 * LLM proposes claims later; Phase 1 uses heuristic extract only by default.
 * Failures must never break ingest/enrich/link — callers wrap in try/catch.
 */
export function runReconciliationForSignal(
  signalId: string,
  opts: RunReconciliationOptions = {},
): ReconciliationResult {
  ensureSeeded();

  const empty = (extra: Partial<ReconciliationResult> = {}): ReconciliationResult => ({
    signalId,
    claimsUpserted: 0,
    evidenceAttached: 0,
    conflictsOpened: 0,
    conflictsResolved: 0,
    conflictsEscalated: 0,
    snapshotsUpdated: 0,
    ...extra,
  });

  if (!reconciliationConfig.enabled()) {
    return empty({ skippedReason: "disabled" });
  }

  const sig = db.getSignalById(signalId);
  if (!sig) return empty({ skippedReason: "missing-signal" });
  if (sig.state === "KILLED") return empty({ skippedReason: "killed" });

  if (!opts.force && signalAlreadyAttached(signalId)) {
    return empty({ skippedReason: "already-processed" });
  }

  const tenant = resolveTenantContext(sig.user_id);
  const source = String(sig.source || "manual").toLowerCase();

  const candidates = extractClaimsHeuristic({
    tenantId: tenant.orgId,
    userId: sig.user_id,
    source,
    content: sig.content,
    affectedSystemsJson: sig.affected_systems,
    opClassification: sig.op_classification,
    sourceSubtype: sig.source_subtype,
    ingestMeta: sig.ingest_meta,
  });

  if (!candidates.length) {
    return empty({ skippedReason: "no-claims" });
  }

  let claimsUpserted = 0;
  let evidenceAttached = 0;
  const touched = new Map<string, { entityId: string; dimension: string }>();
  const claimRows: OrgClaimRow[] = [];

  for (const candidate of candidates) {
    const res = upsertClaimWithEvidence({
      tenantId: tenant.orgId,
      candidate,
      signalId,
      source,
      detectedAt: sig.detected_at,
      extractor: "heuristic",
    });
    if (res.created) claimsUpserted += 1;
    if (res.evidenceId) evidenceAttached += 1;
    claimRows.push(res.claim);
    if (isStateSettingClaim(res.claim)) {
      touched.set(`${res.claim.entity_id}|${res.claim.dimension}`, {
        entityId: res.claim.entity_id,
        dimension: res.claim.dimension,
      });
    }
  }

  let conflictsOpened = 0;
  let conflictsResolved = 0;
  let conflictsEscalated = 0;
  let snapshotsUpdated = 0;

  for (const { entityId, dimension } of touched.values()) {
    const active = listActiveClaimsForEntityDimension(tenant.orgId, entityId, dimension);
    const pairs = findConflictPairs(active);

    if (!pairs.length) {
      refreshSnapshotFromClaims(tenant.orgId, entityId, dimension, "DETERMINISTIC");
      snapshotsUpdated += 1;
      continue;
    }

    for (const [a, b] of pairs) {
      const outcome = resolveConflictPair({
        tenantId: tenant.orgId,
        a,
        b,
        sourceHint: source,
      });
      if (outcome.status === "OPEN" || outcome.status === "ESCALATED") conflictsOpened += 1;
      if (outcome.status === "RESOLVED") conflictsResolved += 1;

      if (outcome.escalated) {
        const decisionId = escalateConflictToDraftDecision({
          tenantId: tenant.orgId,
          userId: sig.user_id,
          conflictId: outcome.conflictId,
          entityId,
          dimension,
          claims: [a, b],
          explanation: outcome.explanation,
        });
        if (decisionId) conflictsEscalated += 1;
      }
    }

    refreshSnapshotFromClaims(
      tenant.orgId,
      entityId,
      dimension,
      conflictsResolved > 0 ? "DETERMINISTIC" : "UNKNOWN",
    );
    snapshotsUpdated += 1;
  }

  for (const entityId of new Set([...touched.values()].map((t) => t.entityId))) {
    const snaps = db.rawGet(
      `SELECT dimension, state FROM entity_state_snapshots WHERE tenant_id = ? AND entity_id = ?`,
      [tenant.orgId, entityId],
    ) as Array<{ dimension: string; state: string }>;
    if (!hasLaunchPartialState(snaps)) continue;
    ensurePartialLaunchConflict(tenant.orgId, entityId);
    conflictsOpened += 1;
    const existingLaunch = snaps.find((s) => s.dimension === "LAUNCH_READINESS");
    if (!existingLaunch || String(existingLaunch.state).toUpperCase() !== "BLOCKED") {
      const row = db
        .rawGet(
          `SELECT id FROM entity_state_snapshots
           WHERE tenant_id = ? AND entity_id = ? AND dimension = 'LAUNCH_READINESS' LIMIT 1`,
          [tenant.orgId, entityId],
        )
        .at(0) as { id: string } | undefined;
      const now = new Date().toISOString();
      if (row) {
        db.rawRun(
          `UPDATE entity_state_snapshots SET state = 'AT_RISK', value = 'AT_RISK',
             resolution_method = 'PARTIAL_STATE', last_updated_at = ? WHERE id = ?`,
          [now, row.id],
        );
      } else {
        db.rawRun(
          `INSERT INTO entity_state_snapshots (
             id, tenant_id, entity_id, dimension, state, value, confidence,
             resolution_method, last_updated_at
           ) VALUES (?, ?, ?, 'LAUNCH_READINESS', 'AT_RISK', 'AT_RISK', 0.72, 'PARTIAL_STATE', ?)`,
          [uuidv4(), tenant.orgId, entityId, now],
        );
      }
      snapshotsUpdated += 1;
    }
  }

  return {
    signalId,
    claimsUpserted,
    evidenceAttached,
    conflictsOpened,
    conflictsResolved,
    conflictsEscalated,
    snapshotsUpdated,
  };
}

/** Fire-and-forget for processSignal hot path. */
export function runReconciliationFireAndForget(signalId: string): void {
  try {
    runReconciliationForSignal(signalId);
  } catch (err) {
    console.error(`[reconciliation] runForSignal(${signalId}) failed:`, err);
  }
}

export { ensureReconciliationSchema } from "./schema.js";
export { seedGlobalAuthorityRules } from "./authority.js";
export type { ReconciliationResult } from "./types.js";
