import { db } from "../database.js";
import { cosine, ensureEmbedding } from "./embeddings.js";
import { hybridSearch, type SearchHit } from "./hybridSearch.js";

/**
 * Operational Query — turn the company into a queryable system.
 *
 * The use cases the user asked for explicitly:
 *   - drift queries
 *   - overloaded teams
 *   - conflicting executions
 *   - related signals
 *   - operational search
 *
 * Each function is a tight read against `external_signals` / `execution_ledger`
 * / `decision_ledger`, with optional embedding-aware ranking where it adds
 * value (related-signals + free-form search). All tenant-scoped (`system`
 * sees everything).
 *
 * No LLM in this module. The point of operational queries is determinism — if
 * the same data produces a different answer tomorrow, we lose trust. LLMs are
 * for upstream extraction (detector/enricher/meeting), not for read paths.
 */

// =====================================================================
// Drift
// =====================================================================

export interface DriftSignal {
  id: string;
  source: string;
  source_subtype: string | null;
  content: string;
  owner: string;
  detected_at: string;
  intent: string | null;
  risk: string | null;
  intent_confidence: number | null;
  related_decision_id: string | null;
  urgency: string | null;
  op_classification: string | null;
  state: string;
  age_minutes: number;
}

export interface DriftQueryOptions {
  /** "high" | "medium" | "any". Defaults to "high". */
  riskAtLeast?: "high" | "medium" | "any";
  /** Minimum age (minutes) before a signal counts as drifted. Default 10. */
  minAgeMinutes?: number;
  /** Cap. Default 100. */
  limit?: number;
}

/**
 * Drift = a signal that crossed the risk bar but is still floating
 * (not LINKED, not KILLED) past the grace window. This is the auditor's
 * "things falling through cracks" view.
 */
export function findDriftSignals(userId: string, opts: DriftQueryOptions = {}): DriftSignal[] {
  const minAge = opts.minAgeMinutes ?? 10;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const tenantSql = userId === "system" ? "" : "AND user_id = ?";
  const tenantParams: unknown[] = userId === "system" ? [] : [userId];

  let riskFilter = "AND risk = 'high'";
  if (opts.riskAtLeast === "medium") riskFilter = "AND risk IN ('high','medium')";
  else if (opts.riskAtLeast === "any") riskFilter = "";

  const rows = db.rawGet(
    `SELECT id, source, source_subtype, content, owner, detected_at, intent, risk,
            intent_confidence, related_decision_id, urgency, op_classification, state,
            CAST((julianday('now') - julianday(detected_at)) * 24 * 60 AS INTEGER) AS age_minutes
       FROM external_signals
      WHERE state IN ('UNVERIFIED', 'GRACE')
        AND CAST((julianday('now') - julianday(detected_at)) * 24 * 60 AS INTEGER) >= ?
        ${riskFilter}
        ${tenantSql}
      ORDER BY risk DESC, age_minutes DESC
      LIMIT ?`,
    [minAge, ...tenantParams, limit],
  ) as DriftSignal[];

  return rows;
}

// =====================================================================
// Overloaded owners (people / teams)
// =====================================================================

export interface OwnerLoad {
  owner: string;
  active: number;
  pending: number;
  blocked: number;
  total: number;
  high_risk_signals: number;
}

/**
 * "Who is over their head?" Counts ACTIVE+PENDING+BLOCKED tasks per owner and
 * how many high-risk floating signals are pointed at them. Returns owners
 * over the threshold, sorted by load.
 *
 * Default threshold: 5 in-flight tasks OR 1 high-risk signal.
 */
export function findOverloadedOwners(
  userId: string,
  opts: { minTotal?: number; minHighRiskSignals?: number; limit?: number } = {},
): OwnerLoad[] {
  const minTotal = opts.minTotal ?? 5;
  const minHigh = opts.minHighRiskSignals ?? 1;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const tenantSql = userId === "system" ? "" : "AND d.user_id = ?";
  const tenantParams: unknown[] = userId === "system" ? [] : [userId];
  const sigTenantSql = userId === "system" ? "" : "AND user_id = ?";
  const sigTenantParams: unknown[] = userId === "system" ? [] : [userId];

  const taskRows = db.rawGet(
    `SELECT e.owner,
            SUM(CASE WHEN e.status='ACTIVE'  THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN e.status='PENDING' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN e.status='BLOCKED' THEN 1 ELSE 0 END) AS blocked
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
      WHERE e.status IN ('ACTIVE','PENDING','BLOCKED')
        ${tenantSql}
      GROUP BY e.owner`,
    tenantParams,
  ) as { owner: string; active: number; pending: number; blocked: number }[];

  const sigRows = db.rawGet(
    `SELECT owner, COUNT(*) AS high_risk_signals
       FROM external_signals
      WHERE risk = 'high' AND state IN ('UNVERIFIED','GRACE')
        ${sigTenantSql}
      GROUP BY owner`,
    sigTenantParams,
  ) as { owner: string; high_risk_signals: number }[];

  const sigMap = new Map<string, number>();
  for (const r of sigRows) sigMap.set(r.owner, Number(r.high_risk_signals) || 0);

  const out: OwnerLoad[] = taskRows.map((r) => {
    const total = (Number(r.active) || 0) + (Number(r.pending) || 0) + (Number(r.blocked) || 0);
    return {
      owner: r.owner,
      active: Number(r.active) || 0,
      pending: Number(r.pending) || 0,
      blocked: Number(r.blocked) || 0,
      total,
      high_risk_signals: sigMap.get(r.owner) ?? 0,
    };
  });

  /** Include signal-only overload (e.g. a person isn't on a task yet but has 3 high-risk floating signals). */
  for (const [owner, n] of sigMap.entries()) {
    if (!out.find((x) => x.owner === owner)) {
      out.push({ owner, active: 0, pending: 0, blocked: 0, total: 0, high_risk_signals: n });
    }
  }

  return out
    .filter((r) => r.total >= minTotal || r.high_risk_signals >= minHigh)
    .sort((a, b) => (b.total + b.high_risk_signals * 3) - (a.total + a.high_risk_signals * 3))
    .slice(0, limit);
}

// =====================================================================
// Conflicting executions vs. ACTIVE decision NO list
// =====================================================================

export interface ConflictingExecution {
  taskId: string;
  decisionId: string;
  owner: string;
  status: string;
  successCondition: string | null;
  matchedConstraint: string;
}

/**
 * Surfaces executions whose `success_condition` (or `failure_condition`)
 * tokens overlap a NO-list entry of the active decision. This is the
 * auditor's "you have a task that aims to do something we banned" check —
 * the kind of structural conflict a human would miss.
 */
export function findConflictingExecutions(userId: string, limit = 100): ConflictingExecution[] {
  const dec = db.getActiveDecision(userId);
  if (!dec) return [];

  let constraints: string[] = [];
  try {
    constraints = JSON.parse(dec.constraints || "[]") as string[];
  } catch {
    constraints = [];
  }
  if (!Array.isArray(constraints) || constraints.length === 0) return [];

  const execs = db.getActiveExecutions(userId, 500);

  const out: ConflictingExecution[] = [];
  for (const exec of execs) {
    const text = `${exec.success_condition ?? ""} ${exec.failure_condition ?? ""}`.toLowerCase();
    if (!text.trim()) continue;
    for (const c of constraints) {
      const tokens = String(c).toLowerCase().split(/\s+/).filter((t) => t.length >= 4);
      const hits = tokens.filter((t) => text.includes(t)).length;
      if (hits >= Math.max(1, Math.floor(tokens.length / 3))) {
        out.push({
          taskId: exec.task_id,
          decisionId: exec.decision_id,
          owner: exec.owner,
          status: exec.status,
          successCondition: exec.success_condition,
          matchedConstraint: String(c),
        });
        break;
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

// =====================================================================
// Related signals (semantic + keyword)
// =====================================================================

export interface RelatedSignal {
  signalId: string;
  content: string;
  owner: string;
  source: string;
  cosineScore: number;
}

/**
 * Find signals semantically similar to a task's success condition. Used to
 * answer "what signals are about this task?" without forcing the operator to
 * eyeball the raw stream.
 *
 * Falls back to FTS-only when embeddings are unavailable.
 */
export async function findSignalsRelatedToTask(
  userId: string,
  taskId: string,
  k = 10,
): Promise<RelatedSignal[]> {
  const task = db.rawGet(
    `SELECT e.task_id, e.success_condition, e.failure_condition, e.decision_id, d.user_id
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
      WHERE e.task_id = ? LIMIT 1`,
    [taskId],
  ) as { task_id: string; success_condition: string | null; failure_condition: string | null; user_id: string }[];

  const row = task[0];
  if (!row) return [];
  if (userId !== "system" && row.user_id !== userId) return [];

  const queryText = [row.success_condition, row.failure_condition].filter(Boolean).join(" ").trim();
  if (!queryText) return [];

  /** Make sure the task itself has an embedding for future calls; cheap idempotent. */
  await ensureEmbedding("execution", row.task_id, row.user_id, queryText).catch(() => false);

  const sigs = db.listEmbeddingsForUser(userId, "signal");
  if (sigs.length === 0) {
    /** No embeddings — degrade to hybrid-search keyword recall. */
    const hits = await hybridSearch(userId, queryText, { types: ["signal"], limit: k });
    return hits
      .filter((h: SearchHit) => h.signalId)
      .map((h: SearchHit) => ({
        signalId: h.signalId as string,
        content: h.snippet,
        owner: "?",
        source: "?",
        cosineScore: 0,
      }));
  }

  const taskVec = db.rawGet(
    `SELECT vector, dim FROM entity_embeddings WHERE entity_type='execution' AND entity_id=? LIMIT 1`,
    [row.task_id],
  ) as { vector: Buffer; dim: number }[];
  const tv = taskVec[0];
  if (!tv) return [];

  const taskF32 = bufToF32(tv.vector);

  const scored: { signalId: string; cosineScore: number }[] = [];
  for (const s of sigs) {
    const score = cosine(taskF32, s.vector);
    if (Number.isFinite(score)) scored.push({ signalId: s.entityId, cosineScore: score });
  }
  scored.sort((a, b) => b.cosineScore - a.cosineScore);
  const top = scored.slice(0, k);

  if (top.length === 0) return [];

  const ids = top.map((t) => t.signalId);
  const placeholders = ids.map(() => "?").join(",");
  const meta = db.rawGet(
    `SELECT id, content, owner, source FROM external_signals WHERE id IN (${placeholders})`,
    ids,
  ) as { id: string; content: string; owner: string; source: string }[];
  const byId = new Map(meta.map((m) => [m.id, m]));

  return top
    .map((t) => {
      const m = byId.get(t.signalId);
      if (!m) return null;
      return {
        signalId: t.signalId,
        content: m.content,
        owner: m.owner,
        source: m.source,
        cosineScore: t.cosineScore,
      };
    })
    .filter((x): x is RelatedSignal => !!x);
}

// =====================================================================
// Operational search (thin wrapper over hybridSearch with op defaults)
// =====================================================================

/**
 * Free-form operational search. Same engine as `hybridSearch`, but defaults
 * tuned for operators ("show me everything that mentions onboarding"):
 *   - includes all three entity types
 *   - bigger limit
 *   - no minScore floor (operators want recall, not precision, here)
 */
export async function operationalSearch(userId: string, query: string, limit = 30) {
  return hybridSearch(userId, query, {
    types: ["signal", "execution", "decision"],
    limit: Math.min(Math.max(limit, 1), 100),
  });
}

// =====================================================================
// helpers
// =====================================================================

function bufToF32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
