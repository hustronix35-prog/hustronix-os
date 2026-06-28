import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { resolveTenantContext } from "./tenant-context.js";

export type DecisionLifecycleState =
  | "PROPOSED"
  | "UNDER_REVIEW"
  | "ACTIVE"
  | "SUPERSEDED"
  | "REVOKED"
  | "COMPLETED"
  | "ARCHIVED";

export type DecisionRelationshipType =
  | "SUPERSEDES"
  | "REVOKES"
  | "SUPPORTS"
  | "CONFLICTS_WITH"
  | "DEPENDS_ON";

const LEGACY_TO_LIFECYCLE: Record<string, DecisionLifecycleState> = {
  DRAFT: "PROPOSED",
  UNDER_REVIEW: "UNDER_REVIEW",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  REVERSED: "REVOKED",
};

const REVOCATION_PATTERNS =
  /\b(never\s+mind|actually\s+(wait|no|let'?s\s+wait)|delay|postpone|cancel|revoke|don'?t|do\s+not|hold\s+off|not\s+anymore)\b/i;

const AFFIRMATION_PATTERNS =
  /\b(we\s+will|let'?s|decided\s+to|go\s+ahead|launch|proceed|approved)\b/i;

export function mapLegacyStatus(status: string): DecisionLifecycleState {
  return LEGACY_TO_LIFECYCLE[status] ?? "PROPOSED";
}

export function syncDecisionLifecycleState(decisionId: string): void {
  const row = db.rawGet(`SELECT status, lifecycle_state FROM decision_ledger WHERE id = ?`, [
    decisionId,
  ]).at(0) as { status: string; lifecycle_state: string | null } | undefined;
  if (!row) return;
  const mapped = mapLegacyStatus(row.status);
  if (row.lifecycle_state !== mapped) {
    db.rawRun(`UPDATE decision_ledger SET lifecycle_state = ? WHERE id = ?`, [mapped, decisionId]);
  }
}

export function insertDecisionRelationship(params: {
  tenantId: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relationshipType: DecisionRelationshipType;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}): string {
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO decision_relationships (
      id, tenant_id, from_type, from_id, to_type, to_id, relationship_type, created_by, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.tenantId,
      params.fromType,
      params.fromId,
      params.toType,
      params.toId,
      params.relationshipType,
      params.createdBy ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  );
  return id;
}

function intentTokens(text: string): Set<string> {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function intentOverlap(a: string, b: string): number {
  const ta = intentTokens(a);
  const tb = intentTokens(b);
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / Math.max(ta.size, tb.size);
}

/**
 * Temporal resolution for decision signals — marks superseded signals and records relationships.
 * Does not auto-commit ledger decisions (human commit gate preserved).
 */
export function resolveTemporalDecisionSignal(params: {
  tenantId: string;
  userId?: string;
  signalId: string;
  content: string;
  opClassification?: string | null;
}): { supersededPriorIds: string[]; relationshipIds: string[] } {
  if (params.opClassification !== "decision_signal") {
    return { supersededPriorIds: [], relationshipIds: [] };
  }

  const orgId = params.tenantId;
  const userId = params.userId ?? params.tenantId;

  const prior = db.rawGet(
    `SELECT id, content, intent, resolution_state FROM external_signals
     WHERE user_id IN (?, ?) AND id != ? AND op_classification = 'decision_signal'
     AND COALESCE(resolution_state, 'ACTIVE') = 'ACTIVE'
     ORDER BY detected_at DESC LIMIT 20`,
    [orgId, userId, params.signalId],
  ) as Array<{ id: string; content: string; intent: string | null; resolution_state: string | null }>;

  const supersededPriorIds: string[] = [];
  const relationshipIds: string[] = [];
  const content = params.content;
  const isRevocation = REVOCATION_PATTERNS.test(content);
  const isAffirmation = AFFIRMATION_PATTERNS.test(content);

  for (const p of prior) {
    const priorText = p.intent || p.content;
    const overlap = intentOverlap(content, priorText);
    const overlapFloor = isRevocation ? 0.25 : 0.35;
    if (overlap < overlapFloor) continue;

    let relationship: DecisionRelationshipType = "CONFLICTS_WITH";
    if (isRevocation) relationship = "SUPERSEDES";
    else if (isAffirmation && REVOCATION_PATTERNS.test(priorText)) relationship = "SUPERSEDES";

    if (relationship === "SUPERSEDES" || (overlap >= 0.5 && isRevocation !== isAffirmation)) {
      db.rawRun(
        `UPDATE external_signals SET resolution_state = 'SUPERSEDED', superseded_by_signal_id = ? WHERE id = ?`,
        [params.signalId, p.id],
      );
      supersededPriorIds.push(p.id);
      relationshipIds.push(
        insertDecisionRelationship({
          tenantId: params.tenantId,
          fromType: "signal",
          fromId: params.signalId,
          toType: "signal",
          toId: p.id,
          relationshipType: relationship,
          metadata: { overlap, isRevocation, isAffirmation },
        }),
      );
    } else if (overlap >= 0.45) {
      relationshipIds.push(
        insertDecisionRelationship({
          tenantId: params.tenantId,
          fromType: "signal",
          fromId: params.signalId,
          toType: "signal",
          toId: p.id,
          relationshipType: "CONFLICTS_WITH",
          metadata: { overlap },
        }),
      );
    }
  }

  db.rawRun(
    `UPDATE external_signals SET resolution_state = COALESCE(resolution_state, 'ACTIVE') WHERE id = ?`,
    [params.signalId],
  );

  return { supersededPriorIds, relationshipIds };
}

export function getActiveDecisionSignals(tenantOrUserId: string, limit = 10): Array<{
  id: string;
  content: string;
  intent: string | null;
  detected_at: string;
  source?: string;
}> {
  const ctx = resolveTenantContext(tenantOrUserId);
  return db.rawGet(
    `SELECT id, content, intent, detected_at, source FROM external_signals
     WHERE user_id IN (?, ?) AND op_classification = 'decision_signal'
     AND COALESCE(resolution_state, 'ACTIVE') = 'ACTIVE'
     ORDER BY detected_at DESC LIMIT ?`,
    [ctx.orgId, ctx.userId, limit],
  ) as Array<{ id: string; content: string; intent: string | null; detected_at: string; source?: string }>;
}

export function getDecisionLifecycleSummary(tenantId: string): {
  activeSignals: number;
  supersededSignals: number;
  openConflicts: number;
  activeDecisions: number;
} {
  const activeSignals = (
    db.rawGet(
      `SELECT COUNT(*) AS c FROM external_signals
       WHERE user_id = ? AND op_classification = 'decision_signal'
       AND COALESCE(resolution_state, 'ACTIVE') = 'ACTIVE'`,
      [tenantId],
    ).at(0) as { c: number }
  ).c;
  const supersededSignals = (
    db.rawGet(
      `SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ? AND resolution_state = 'SUPERSEDED'`,
      [tenantId],
    ).at(0) as { c: number }
  ).c;
  const openConflicts = (
    db.rawGet(
      `SELECT COUNT(*) AS c FROM decision_relationships
       WHERE tenant_id = ? AND relationship_type = 'CONFLICTS_WITH'`,
      [tenantId],
    ).at(0) as { c: number }
  ).c;
  const activeDecisions = (
    db.rawGet(
      `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
      [tenantId],
    ).at(0) as { c: number }
  ).c;
  return { activeSignals, supersededSignals, openConflicts, activeDecisions };
}
