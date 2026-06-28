import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { computeDigitalTwin } from "../state/digital-twin.js";

export type PropagationEdge = "CAUSED_BY" | "SUPPORTS" | "CONTRADICTS" | "DEPENDS_ON" | "AFFECTS";

export interface SimulationInput {
  tenantId: string;
  decisionId?: string;
  vow: string;
  /** Optional task fanout weights keyed by owner. */
  capacityDelta?: Record<string, number>;
  revenueDeltaPct?: number;
  churnRiskDelta?: number;
  createdBy?: string;
}

export interface ScenarioProjection {
  label: string;
  probability: number;
  capacity_hours_delta: number;
  revenue_delta_pct: number;
  churn_risk_delta: number;
  risk_score: number;
  affected_entities: string[];
  narrative_hint?: string;
}

export interface SimulationResult {
  runId: string;
  input_graph_hash: string;
  scenarios: ScenarioProjection[];
  twin_snapshot: ReturnType<typeof computeDigitalTwin>;
  max_risk: number;
}

function graphHash(tenantId: string, decisionId?: string): string {
  const nodes = db.rawGet(
    `SELECT id, node_type, ref_id FROM evidence_nodes WHERE tenant_id = ? LIMIT 500`,
    [tenantId],
  );
  const edges = db.rawGet(
    `SELECT from_node_id, to_node_id, edge_type FROM evidence_edges WHERE tenant_id = ? LIMIT 1000`,
    [tenantId],
  );
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ nodes, edges, decisionId }))
    .digest("hex");
}

function collectAffectedEntities(tenantId: string, decisionId?: string): string[] {
  const ids: string[] = [];
  if (decisionId) {
    const node = db.rawGet(
      `SELECT id FROM evidence_nodes WHERE tenant_id = ? AND node_type = 'decision' AND ref_id = ?`,
      [tenantId, decisionId],
    ).at(0) as { id: string } | undefined;
    if (node) ids.push(node.id);
  }

  const edges = db.rawGet(
    `SELECT from_node_id, to_node_id, edge_type FROM evidence_edges
     WHERE tenant_id = ? AND edge_type IN ('CAUSED_BY', 'SUPPORTS', 'CONTRADICTS') LIMIT 200`,
    [tenantId],
  ) as { from_node_id: string; to_node_id: string; edge_type: string }[];

  const seed = new Set(ids);
  for (const e of edges) {
    if (seed.has(e.from_node_id)) seed.add(e.to_node_id);
    if (seed.has(e.to_node_id)) seed.add(e.from_node_id);
  }
  return [...seed].slice(0, 50);
}

function propagateCapacity(tenantId: string, delta: Record<string, number> = {}): number {
  const tasks = db.rawGet(
    `SELECT e.owner, e.weight, e.status FROM execution_ledger e
     JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ? AND e.status IN ('ACTIVE','PENDING')`,
    [tenantId],
  ) as { owner: string; weight: number; status: string }[];

  let hours = 0;
  for (const t of tasks) {
    const ownerDelta = delta[t.owner] ?? 0;
    hours += (t.weight ?? 1) * (1 + ownerDelta);
  }
  return hours;
}

/**
 * Deterministic graph propagation — no LLM simulation.
 */
export function runCausalSimulation(input: SimulationInput): SimulationResult {
  const hash = graphHash(input.tenantId, input.decisionId);
  const affected = collectAffectedEntities(input.tenantId, input.decisionId);
  const twin = computeDigitalTwin(input.tenantId);

  const baseCapacity = propagateCapacity(input.tenantId);
  const stressedCapacity = propagateCapacity(input.tenantId, input.capacityDelta ?? { system: 0.15 });
  const capacityDelta = stressedCapacity - baseCapacity;

  const revenueBase = input.revenueDeltaPct ?? 0;
  const churnBase = input.churnRiskDelta ?? 0;

  const scenarios: ScenarioProjection[] = [
    {
      label: "Base case",
      probability: 0.55,
      capacity_hours_delta: capacityDelta * 0.5,
      revenue_delta_pct: revenueBase * 0.6,
      churn_risk_delta: churnBase * 0.5,
      risk_score: Math.min(1, Math.abs(capacityDelta) * 0.05 + churnBase * 0.3),
      affected_entities: affected,
    },
    {
      label: "Optimistic",
      probability: 0.25,
      capacity_hours_delta: capacityDelta * 0.25,
      revenue_delta_pct: revenueBase,
      churn_risk_delta: churnBase * 0.25,
      risk_score: Math.min(1, Math.abs(capacityDelta) * 0.03),
      affected_entities: affected,
    },
    {
      label: "Stress",
      probability: 0.2,
      capacity_hours_delta: capacityDelta,
      revenue_delta_pct: revenueBase * 0.4,
      churn_risk_delta: Math.min(1, churnBase + 0.12),
      risk_score: Math.min(1, Math.abs(capacityDelta) * 0.08 + churnBase * 0.5 + 0.1),
      affected_entities: affected,
      narrative_hint: "High dependency fan-in or blocker rate may amplify downside.",
    },
  ];

  const maxRisk = Math.max(...scenarios.map((s) => s.risk_score));
  const runId = uuidv4();
  const output = { scenarios, twin_snapshot: twin, max_risk: maxRisk };

  db.rawRun(
    `INSERT INTO simulation_runs (
      id, tenant_id, decision_id, input_graph_hash, input_json, output_projection_json, risk_score, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      input.tenantId,
      input.decisionId ?? null,
      hash,
      JSON.stringify({ vow: input.vow, capacityDelta: input.capacityDelta, revenueDeltaPct: input.revenueDeltaPct }),
      JSON.stringify(output),
      maxRisk,
      input.createdBy ?? null,
    ],
  );

  return {
    runId,
    input_graph_hash: hash,
    scenarios,
    twin_snapshot: twin,
    max_risk: maxRisk,
  };
}

export function getSimulationRun(runId: string): Record<string, unknown> | null {
  const row = db.rawGet(`SELECT * FROM simulation_runs WHERE id = ?`, [runId]).at(0);
  if (!row) return null;
  return row as Record<string, unknown>;
}
