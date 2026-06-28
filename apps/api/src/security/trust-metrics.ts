import { db } from "../database.js";
import { countDeniedAgentActions } from "./agent-audit.js";
import { getDecisionLifecycleSummary } from "./decision-lifecycle.js";
import { countContradictionEdges, countEvidenceNodes } from "./evidence-graph.js";
import { listOpenMemoryConflicts } from "./memory-store.js";
import { resolveTenantContext } from "./tenant-context.js";
import { ledgerTenantInClause, memoryTenantInClause } from "./tenant-scope.js";

export interface TrustMetrics {
  trustScore: number;
  memoryConfidence: number;
  decisionConfidence: number;
  evidenceCount: number;
  contradictionCount: number;
  sourceDiversity: number;
  openMemoryConflicts: number;
  deniedAgentActions24h: number;
  activeDecisionSignals: number;
  supersededSignals: number;
  breakdown: {
    security: number;
    reliability: number;
    provenance: number;
  };
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function computeTrustMetrics(tenantOrUserId: string): TrustMetrics {
  const ctx = resolveTenantContext(tenantOrUserId);
  const orgId = ctx.orgId;
  const userId = ctx.userId;
  const ledgerIn = ledgerTenantInClause();
  const memIn = memoryTenantInClause();
  const ledgerParams = [orgId, userId];

  const lifecycle = getDecisionLifecycleSummary(orgId);
  const openMemoryConflicts = listOpenMemoryConflicts(orgId).length;
  const evidenceCount = countEvidenceNodes(orgId);
  const contradictionCount =
    countContradictionEdges(orgId) + lifecycle.openConflicts + openMemoryConflicts;
  const deniedAgentActions24h = countDeniedAgentActions(orgId, 24);

  const memoryRows = db.rawGet(
    `SELECT AVG(confidence) AS avg_conf, COUNT(DISTINCT source_type) AS sources
     FROM memory_records WHERE ${memIn} AND verification_state NOT IN ('REVOKED', 'ARCHIVED')`,
    ledgerParams,
  ).at(0) as { avg_conf: number | null; sources: number } | undefined;

  const decisionRow = db.rawGet(
    `SELECT AVG(confidence) AS avg_conf FROM decision_ledger WHERE ${ledgerIn} AND status IN ('ACTIVE', 'DRAFT', 'UNDER_REVIEW')`,
    ledgerParams,
  ).at(0) as { avg_conf: number | null } | undefined;

  const signalSources = db.rawGet(
    `SELECT COUNT(DISTINCT source) AS c FROM external_signals WHERE ${ledgerIn}`,
    ledgerParams,
  ).at(0) as { c: number } | undefined;

  const memoryConfidence = clamp((memoryRows?.avg_conf ?? 0.5) * 100);
  const decisionConfidence = clamp((decisionRow?.avg_conf ?? 0.5) * 100);
  const sourceDiversity = (memoryRows?.sources ?? 0) + (signalSources?.c ?? 0);

  const maliciousSignals = (
    db.rawGet(
      `SELECT COUNT(*) AS c FROM external_signals WHERE ${ledgerIn} AND injection_classification = 'MALICIOUS'`,
      ledgerParams,
    ).at(0) as { c: number }
  ).c;

  let security = 100;
  security -= deniedAgentActions24h * 2;
  security -= maliciousSignals * 5;
  security -= openMemoryConflicts * 4;
  security = clamp(security);

  let reliability = 100;
  reliability -= lifecycle.openConflicts * 8;
  reliability -= Math.max(0, lifecycle.activeSignals - 1) * 5;
  reliability -= contradictionCount * 3;
  reliability = clamp(reliability);

  let provenance = 100;
  if (evidenceCount === 0) provenance -= 15;
  provenance -= openMemoryConflicts * 10;
  provenance += Math.min(10, sourceDiversity);
  provenance = clamp(provenance);

  const trustScore = clamp(Math.round(security * 0.4 + reliability * 0.35 + provenance * 0.25));

  return {
    trustScore,
    memoryConfidence,
    decisionConfidence,
    evidenceCount,
    contradictionCount,
    sourceDiversity,
    openMemoryConflicts,
    deniedAgentActions24h,
    activeDecisionSignals: lifecycle.activeSignals,
    supersededSignals: lifecycle.supersededSignals,
    breakdown: { security, reliability, provenance },
  };
}
