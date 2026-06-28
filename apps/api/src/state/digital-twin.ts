import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { computeDynamicConfidence } from "./confidence.js";

export interface TeamTwinMetrics {
  team_id: string;
  label: string;
  morale: number;
  velocity: number;
  focus: number;
  communication_load: number;
  dependency_risk: number;
  learning_rate: number;
  confidence: number;
  factors: ReturnType<typeof computeDynamicConfidence>;
}

export interface DigitalTwinSnapshot {
  tenant_id: string;
  teams: TeamTwinMetrics[];
  org_learning_rate: number;
  compiled_at: string;
}

function weekAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function computeMorale(tenantId: string, owner: string): number {
  const blockers = db.rawGet(
    `SELECT COUNT(*) AS c FROM execution_ledger e
     JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ? AND e.owner = ? AND e.status = 'BLOCKED'`,
    [tenantId, owner],
  ).at(0) as { c: number };
  const signals = db.rawGet(
    `SELECT content FROM external_signals WHERE user_id = ? AND owner = ?
     AND detected_at >= ? LIMIT 30`,
    [tenantId, owner, weekAgoIso()],
  ) as { content: string }[];

  let neg = 0;
  for (const s of signals) {
    if (/\b(blocked|delay|frustrat|incident|outage|bug)\b/i.test(s.content)) neg++;
  }
  const blockerPenalty = Math.min(0.4, (blockers?.c ?? 0) * 0.08);
  const sentimentPenalty = Math.min(0.35, neg * 0.05);
  return Math.max(0.2, Math.min(1, 0.85 - blockerPenalty - sentimentPenalty));
}

function computeVelocity(tenantId: string, owner: string): number {
  const done = db.rawGet(
    `SELECT COUNT(*) AS c FROM execution_ledger e
     JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ? AND e.owner = ? AND e.status = 'DONE'
     AND e.completed_at >= ?`,
    [tenantId, owner, weekAgoIso()],
  ).at(0) as { c: number };
  const count = done?.c ?? 0;
  return Math.min(1, count / 10);
}

function computeFocus(tenantId: string, owner: string): number {
  const active = db.rawGet(
    `SELECT COUNT(*) AS c FROM execution_ledger e
     JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ? AND d.status = 'ACTIVE' AND e.owner = ? AND e.status IN ('ACTIVE','PENDING')`,
    [tenantId, owner],
  ).at(0) as { c: number };
  const total = db.rawGet(
    `SELECT COUNT(*) AS c FROM execution_ledger e
     JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ? AND e.owner = ? AND e.status IN ('ACTIVE','PENDING','DONE')`,
    [tenantId, owner],
  ).at(0) as { c: number };
  if (!total?.c) return 0.5;
  return Math.min(1, (active?.c ?? 0) / total.c);
}

function computeCommunicationLoad(tenantId: string, owner: string): number {
  const n = db.rawGet(
    `SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ? AND owner = ? AND detected_at >= ?`,
    [tenantId, owner, weekAgoIso()],
  ).at(0) as { c: number };
  return Math.min(1, (n?.c ?? 0) / 40);
}

function computeDependencyRisk(tenantId: string, owner: string): number {
  const tasks = db.rawGet(
    `SELECT dependencies FROM execution_ledger e
     JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ? AND e.owner = ?`,
    [tenantId, owner],
  ) as { dependencies: string }[];

  let fanIn = 0;
  for (const t of tasks) {
    try {
      const deps = JSON.parse(t.dependencies || "[]");
      if (Array.isArray(deps) && deps.length > 2) fanIn++;
    } catch {
      /* ignore */
    }
  }
  return Math.min(1, fanIn / Math.max(1, tasks.length));
}

function computeLearningRate(tenantId: string): number {
  const outcomes = db.rawGet(
    `SELECT COUNT(*) AS c FROM decision_outcomes WHERE tenant_id = ? AND evaluated_at >= ?`,
    [tenantId, weekAgoIso()],
  ).at(0) as { c: number };
  const learning = db.rawGet(
    `SELECT COUNT(*) AS c FROM learning_log WHERE user_id = ? AND timestamp >= ?`,
    [tenantId, weekAgoIso()],
  ).at(0) as { c: number };
  return Math.min(1, ((outcomes?.c ?? 0) + (learning?.c ?? 0)) / 8);
}

/** v1: capacity + workload from teams[]; v2: richer per-team metrics. */
export function computeDigitalTwin(tenantId: string): DigitalTwinSnapshot {
  const owners = db.rawGet(
    `SELECT DISTINCT e.owner AS owner FROM execution_ledger e
     JOIN decision_ledger d ON e.decision_id = d.id WHERE d.user_id = ?`,
    [tenantId],
  ) as { owner: string }[];

  const teams: TeamTwinMetrics[] = owners.map((o) => {
    const owner = o.owner || "system";
    const morale = computeMorale(tenantId, owner);
    const velocity = computeVelocity(tenantId, owner);
    const focus = computeFocus(tenantId, owner);
    const communication_load = computeCommunicationLoad(tenantId, owner);
    const dependency_risk = computeDependencyRisk(tenantId, owner);
    const learning_rate = computeLearningRate(tenantId);

    const factors = computeDynamicConfidence({
      baseEvidenceWeight: (morale + velocity + focus) / 3,
      evidenceCount: 5,
      freshnessBonus: 0.05,
    });

    return {
      team_id: owner,
      label: owner,
      morale,
      velocity,
      focus,
      communication_load,
      dependency_risk,
      learning_rate,
      confidence: factors.confidence,
      factors,
    };
  });

  return {
    tenant_id: tenantId,
    teams,
    org_learning_rate: computeLearningRate(tenantId),
    compiled_at: new Date().toISOString(),
  };
}

export function hashTwinSnapshot(snapshot: DigitalTwinSnapshot): string {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
