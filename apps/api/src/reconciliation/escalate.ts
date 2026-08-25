import { db } from "../database.js";
import { attachDecisionToConflict } from "./conflict-resolve.js";
import { claimIdentityValue } from "./claim-store.js";
import type { OrgClaimRow } from "./types.js";

/**
 * Escalate unresolved material conflict → DRAFT decision only.
 * Never transitions to ACTIVE.
 */
export function escalateConflictToDraftDecision(params: {
  tenantId: string;
  userId: string;
  conflictId: string;
  entityId: string;
  dimension: string;
  claims: OrgClaimRow[];
  explanation: string;
}): string | null {
  const existing = db
    .rawGet(`SELECT decision_id, status FROM conflicts WHERE id = ?`, [params.conflictId])
    .at(0) as { decision_id: string | null; status: string } | undefined;
  if (existing?.decision_id) {
    attachDecisionToConflict(params.conflictId, existing.decision_id);
    return existing.decision_id;
  }

  const claimSummary = params.claims
    .map((c) => `${c.dimension}=${claimIdentityValue(c)} (score ${(c.evidence_score ?? 0).toFixed(2)})`)
    .join(" vs ");

  const vow = `Reconcile ${params.dimension} for ${params.entityId}: ${claimSummary}`;
  const decisionId = db.saveDecisionEvent(params.userId, {
    vow,
    expected_outcomes: [
      "Authoritative organizational state confirmed",
      "Downstream execution unblocked or explicitly deferred",
    ],
    constraints: [
      "Do not auto-activate from reconciliation",
      `conflict_id:${params.conflictId}`,
    ],
    reversal_conditions: "New authoritative evidence supersedes this draft",
    confidence: 0.55,
    institutional_reasoning: {
      institutional_version: 2,
      source: "reconciliation",
      conflict_id: params.conflictId,
      entity_id: params.entityId,
      dimension: params.dimension,
      explanation: params.explanation,
      ranked_hypotheses: params.claims.slice(0, 5).map((c, i) => ({
        rank: i + 1,
        statement: `${c.dimension} is ${claimIdentityValue(c)}`,
        probability: Math.max(0.05, c.evidence_score ?? 0.3),
        claim_id: c.id,
      })),
    },
  });

  /** Guard: ensure DRAFT — never ACTIVE */
  const row = db
    .rawGet(`SELECT status FROM decision_ledger WHERE id = ?`, [decisionId])
    .at(0) as { status: string } | undefined;
  if (row && row.status !== "DRAFT") {
    throw new Error(
      `Reconciliation escalation must create DRAFT decisions; got ${row.status}`,
    );
  }

  attachDecisionToConflict(params.conflictId, decisionId);
  return decisionId;
}
