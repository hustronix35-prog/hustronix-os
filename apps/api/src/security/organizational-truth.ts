import crypto from "crypto";
import { db } from "../database.js";
import { getActiveDecisionSignals } from "./decision-lifecycle.js";
import { computeEntityTrustScore } from "./trust-engine.js";
import { ledgerTenantInClause } from "./tenant-scope.js";
import { resolveTenantContext } from "./tenant-context.js";

export type TruthStatus = "ACTIVE" | "SUPERSEDED" | "HISTORICAL" | "REVOKED";

export interface OrganizationalTruthItem {
  id: string;
  topic: string;
  activeStatement: string;
  truthConfidence: number;
  status: TruthStatus;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  supersededBy?: string | null;
  computedAt: string;
  evidenceQuality?: number;
}

export interface OrganizationalTruthSnapshot {
  tenantId: string;
  workspaceId?: string | null;
  computedAt: string;
  truths: OrganizationalTruthItem[];
}

const truthDebounceTimers = new Map<string, NodeJS.Timeout>();

function topicHash(statement: string): string {
  return crypto.createHash("sha256").update(statement.toLowerCase().slice(0, 120)).digest("hex");
}

function intentKey(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .sort()
    .slice(0, 8)
    .join("|");
}

function resolveTenantPair(tenantOrUserId: string): [string, string] {
  const ctx = resolveTenantContext(tenantOrUserId);
  return [ctx.orgId, ctx.userId];
}

function weightedSignalTrust(source: string, recencyHours: number): number {
  const sourceQuality =
    source.toLowerCase() === "slack" ? 0.45 : source.toLowerCase() === "meeting" ? 0.8 : 0.55;
  return computeEntityTrustScore({
    entityType: "signal",
    evidenceCount: 1,
    contradictionCount: 0,
    sourceQuality,
    humanVerified: false,
    recencyHours,
  }).score;
}

/**
 * Debounced truth recompute — avoids synchronous death-spiral on high ingest volume.
 */
export function scheduleOrganizationalTruthRecompute(
  tenantOrUserId: string,
  workspaceId?: string | null,
  delayMs = 750,
): void {
  const [orgId] = resolveTenantPair(tenantOrUserId);
  const existing = truthDebounceTimers.get(orgId);
  if (existing) clearTimeout(existing);
  truthDebounceTimers.set(
    orgId,
    setTimeout(() => {
      truthDebounceTimers.delete(orgId);
      try {
        computeOrganizationalTruth(orgId, workspaceId);
      } catch {
        /* non-blocking */
      }
    }, delayMs),
  );
}

/**
 * Truth Resolution V2 — weighted evidence quality; human decisions dominate signals.
 */
export function computeOrganizationalTruth(
  tenantOrUserId: string,
  workspaceId?: string | null,
): OrganizationalTruthSnapshot {
  const [orgId, userId] = resolveTenantPair(tenantOrUserId);
  const ledgerIn = ledgerTenantInClause();
  const ledgerParams = [orgId, userId];

  const signals = getActiveDecisionSignals(userId, 30);
  const superseded = db.rawGet(
    `SELECT id, content, intent, source, superseded_by_signal_id, detected_at FROM external_signals
     WHERE ${ledgerIn} AND resolution_state = 'SUPERSEDED'
     ORDER BY detected_at DESC LIMIT 30`,
    ledgerParams,
  ) as Array<{
    id: string;
    content: string;
    intent: string | null;
    source: string;
    superseded_by_signal_id: string | null;
    detected_at: string;
  }>;

  const activeDecisions = db.rawGet(
    `SELECT id, vow, lifecycle_state, activated_at, approved_by FROM decision_ledger
     WHERE ${ledgerIn} AND status = 'ACTIVE'`,
    ledgerParams,
  ) as Array<{
    id: string;
    vow: string;
    lifecycle_state: string | null;
    activated_at: string | null;
    approved_by: string | null;
  }>;

  const topicMap = new Map<string, { active?: OrganizationalTruthItem; historical: OrganizationalTruthItem[] }>();

  for (const sig of signals) {
    const statement = sig.intent || sig.content;
    const key = intentKey(statement);
    if (!key) continue;
    const trustScore = weightedSignalTrust(sig.source || "signal", hoursSince(sig.detected_at));
    const item: OrganizationalTruthItem = {
      id: sig.id,
      topic: key,
      activeStatement: statement.slice(0, 300),
      truthConfidence: trustScore,
      status: "ACTIVE",
      supportingEvidence: [`signal:${sig.id}`],
      contradictingEvidence: [],
      computedAt: new Date().toISOString(),
      evidenceQuality: trustScore,
    };
    const bucket = topicMap.get(key) ?? { historical: [] };
    if (!bucket.active || trustScore > bucket.active.truthConfidence) {
      if (bucket.active) bucket.historical.push({ ...bucket.active, status: "HISTORICAL" });
      bucket.active = item;
    }
    topicMap.set(key, bucket);
  }

  for (const s of superseded) {
    const statement = s.intent || s.content;
    const key = intentKey(statement);
    if (!key) continue;
    const bucket = topicMap.get(key) ?? { historical: [] };
    bucket.historical.push({
      id: s.id,
      topic: key,
      activeStatement: statement.slice(0, 300),
      truthConfidence: 0.35,
      status: "SUPERSEDED",
      supportingEvidence: [],
      contradictingEvidence: s.superseded_by_signal_id ? [`signal:${s.superseded_by_signal_id}`] : [],
      supersededBy: s.superseded_by_signal_id,
      computedAt: s.detected_at,
      evidenceQuality: 0.35,
    });
    topicMap.set(key, bucket);
  }

  for (const d of activeDecisions) {
    const key = intentKey(d.vow);
    const trust = computeEntityTrustScore({
      entityType: "decision",
      evidenceCount: d.approved_by ? 3 : 2,
      contradictionCount: 0,
      sourceQuality: 0.95,
      humanVerified: true,
      recencyHours: d.activated_at ? hoursSince(d.activated_at) : 24,
      historicalAccuracy: 0.85,
    });
    const item: OrganizationalTruthItem = {
      id: d.id,
      topic: key || `decision:${d.id.slice(0, 8)}`,
      activeStatement: d.vow,
      truthConfidence: trust.score,
      status: "ACTIVE",
      supportingEvidence: [`decision:${d.id}`],
      contradictingEvidence: [],
      computedAt: new Date().toISOString(),
      evidenceQuality: trust.score,
    };
    const bucket = topicMap.get(key) ?? { historical: [] };
    if (bucket.active && bucket.active.status === "ACTIVE") {
      bucket.historical.push({ ...bucket.active, status: "HISTORICAL" });
    }
    bucket.active = item;
    topicMap.set(key, bucket);
  }

  const truths: OrganizationalTruthItem[] = [];
  for (const bucket of topicMap.values()) {
    if (bucket.active) truths.push(bucket.active);
    truths.push(...bucket.historical);
  }

  const computedAt = new Date().toISOString();
  db.rawRun("BEGIN IMMEDIATE");
  try {
    for (const t of truths.filter((x) => x.status === "ACTIVE")) {
      persistTruthSnapshot(orgId, workspaceId, t);
    }
    db.rawRun("COMMIT");
  } catch (e) {
    db.rawRun("ROLLBACK");
    throw e;
  }

  return { tenantId: orgId, workspaceId, computedAt, truths };
}

function persistTruthSnapshot(
  tenantId: string,
  workspaceId: string | null | undefined,
  item: OrganizationalTruthItem,
): void {
  const hash = topicHash(item.topic);
  db.rawRun(
    `UPDATE organizational_truth_snapshots SET status = 'SUPERSEDED'
     WHERE tenant_id = ? AND topic_hash = ? AND status = 'ACTIVE' AND id != ?`,
    [tenantId, hash, item.id],
  );
  db.rawRun(
    `INSERT OR REPLACE INTO organizational_truth_snapshots (
      id, tenant_id, workspace_id, topic_hash, active_statement, truth_confidence, status,
      supporting_evidence_json, contradicting_evidence_json, superseded_by_id, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      item.id,
      tenantId,
      workspaceId ?? null,
      hash,
      item.activeStatement,
      item.truthConfidence,
      item.status,
      JSON.stringify(item.supportingEvidence),
      JSON.stringify(item.contradictingEvidence),
      item.supersededBy ?? null,
    ],
  );
}

function hoursSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, ms / 3_600_000);
}

export function getCurrentOrganizationalTruth(tenantOrUserId: string): OrganizationalTruthItem[] {
  const [orgId] = resolveTenantPair(tenantOrUserId);
  const rows = db.rawGet(
    `SELECT id, topic_hash, active_statement, truth_confidence, status,
            supporting_evidence_json, contradicting_evidence_json, superseded_by_id, computed_at
     FROM organizational_truth_snapshots
     WHERE tenant_id = ? AND status = 'ACTIVE'
     ORDER BY truth_confidence DESC LIMIT 50`,
    [orgId],
  ) as Array<{
    id: string;
    topic_hash: string;
    active_statement: string;
    truth_confidence: number;
    status: TruthStatus;
    supporting_evidence_json: string | null;
    contradicting_evidence_json: string | null;
    superseded_by_id: string | null;
    computed_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    topic: r.topic_hash,
    activeStatement: r.active_statement,
    truthConfidence: r.truth_confidence,
    status: r.status,
    supportingEvidence: parseJsonArray(r.supporting_evidence_json),
    contradictingEvidence: parseJsonArray(r.contradicting_evidence_json),
    supersededBy: r.superseded_by_id,
    computedAt: r.computed_at,
  }));
}

function parseJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
