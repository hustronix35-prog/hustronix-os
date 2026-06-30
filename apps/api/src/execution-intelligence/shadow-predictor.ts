import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import {
  ALGORITHM_VERSION,
  FEATURE_VERSION,
  MODEL_VERSION,
  loadBucketFor,
} from "./config.js";
import type { BeliefView, PredictionExplanation, PredictionRecord } from "./types.js";
import { listBeliefsForEntity, beliefConfidence } from "./derived-views.js";

function ownerActiveLoad(owner: string): number {
  const row = db
    .rawGet(
      `SELECT COALESCE(SUM(weight), 0) AS w FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'`,
      [owner],
    )
    .at(0) as { w: number } | undefined;
  return Number(row?.w ?? 0);
}

function beliefMap(beliefs: BeliefView[]): Map<string, BeliefView> {
  return new Map(beliefs.map((b) => [b.beliefKey, b]));
}

export function predictTaskSuccess(
  tenantId: string,
  owner: string,
  context?: { domain?: string; activeLoad?: number; evidenceId?: string },
): PredictionRecord {
  const beliefs = listBeliefsForEntity(tenantId, "person", owner);
  const bm = beliefMap(beliefs);
  const activeLoad = context?.activeLoad ?? ownerActiveLoad(owner);
  const bucket = loadBucketFor(activeLoad);
  const loadBelief = bm.get(`performance_at_load:${bucket}`);
  const reliability = bm.get("reliability");
  const speed = bm.get("execution_speed");
  const domain = context?.domain;
  const expertise = domain ? bm.get(`expertise:${domain}`) : undefined;

  const explanation: PredictionExplanation[] = [];
  let score = 0.5;
  let weightSum = 0;

  const add = (factor: string, belief: BeliefView | undefined, w: number, extra?: Partial<PredictionExplanation>) => {
    if (!belief) return;
    const contrib = belief.mean * belief.confidence * w;
    score += contrib;
    weightSum += w;
    explanation.push({
      factor,
      belief_key: belief.beliefKey,
      contribution: Math.round(contrib * 100) / 100,
      ...extra,
    });
  };

  add("reliability", reliability, 0.31);
  if (loadBelief) {
    add("low_workload", loadBelief, 0.24, { active_load: activeLoad });
  } else {
    explanation.push({
      factor: "low_workload",
      active_load: activeLoad,
      contribution: Math.round((1 - Math.min(1, activeLoad / 3)) * 0.24 * 100) / 100,
    });
    score += (1 - Math.min(1, activeLoad / 3)) * 0.24;
    weightSum += 0.24;
  }
  if (domain && expertise) {
    add("domain_match", expertise, 0.22, { domain });
  } else {
    add("execution_speed", speed, 0.15);
  }
  const recentRel = reliability?.nObs ?? 0;
  if (recentRel >= 3) {
    explanation.push({
      factor: "recent_success_streak",
      contribution: 0.1,
    });
    score += 0.1;
    weightSum += 0.1;
  }

  const predicted = weightSum > 0 ? Math.max(0, Math.min(1, score / (0.5 + weightSum * 0.5))) : 0.5;
  const confidences = [reliability, loadBelief, speed, expertise].filter(Boolean) as BeliefView[];
  const confidence =
    confidences.length > 0
      ? confidences.reduce((s, b) => s + b.confidence, 0) / confidences.length
      : 0.35;

  if (explanation.length === 0) {
    explanation.push({
      factor: "prior_baseline",
      contribution: 0.5,
    });
  }

  if (explanation.length === 0) {
    explanation.push({
      factor: "baseline_prior",
      contribution: 0.5,
    });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const features = { active_load: activeLoad, load_bucket: bucket, domain: domain ?? null };

  db.rawRun(
    `INSERT INTO execution_predictions (
      id, tenant_id, entity_type, entity_id, prediction_type, predicted_value, confidence,
      explanation_json, features_json, model_version, feature_version, algorithm_version,
      evidence_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tenantId,
      "person",
      owner,
      "task_success",
      predicted,
      confidence,
      JSON.stringify(explanation),
      JSON.stringify(features),
      MODEL_VERSION,
      FEATURE_VERSION,
      ALGORITHM_VERSION,
      context?.evidenceId ?? null,
      now,
    ],
  );

  return {
    id,
    tenantId,
    entityType: "person",
    entityId: owner,
    predictionType: "task_success",
    predictedValue: predicted,
    actualValue: null,
    confidence,
    explanation,
    modelVersion: MODEL_VERSION,
    featureVersion: FEATURE_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    evidenceId: context?.evidenceId ?? null,
    createdAt: now,
    resolvedAt: null,
  };
}

export function predictCapacityHeadroom(
  tenantId: string,
  owner: string,
): PredictionRecord {
  const derived = listBeliefsForEntity(tenantId, "person", owner);
  const load = ownerActiveLoad(owner);
  const headroom = Math.max(0, 1 - load / 3);
  const reliability = derived.find((b) => b.beliefKey === "reliability");
  const predicted = Math.max(
    0,
    Math.min(1, headroom * (reliability?.mean ?? 0.5) * (reliability?.confidence ?? 0.5) + 0.25),
  );
  const explanation: PredictionExplanation[] = [
    {
      factor: "active_load",
      active_load: load,
      contribution: Math.round((1 - headroom) * 100) / 100,
    },
    {
      factor: "reliability",
      belief_key: "reliability",
      contribution: reliability ? Math.round(reliability.mean * 0.3 * 100) / 100 : 0.1,
    },
  ];

  const id = uuidv4();
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO execution_predictions (
      id, tenant_id, entity_type, entity_id, prediction_type, predicted_value, confidence,
      explanation_json, features_json, model_version, feature_version, algorithm_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tenantId,
      "person",
      owner,
      "capacity_headroom",
      predicted,
      reliability?.confidence ?? 0.4,
      JSON.stringify(explanation),
      JSON.stringify({ active_load: load }),
      MODEL_VERSION,
      FEATURE_VERSION,
      ALGORITHM_VERSION,
      now,
    ],
  );

  return {
    id,
    tenantId,
    entityType: "person",
    entityId: owner,
    predictionType: "capacity_headroom",
    predictedValue: predicted,
    actualValue: null,
    confidence: reliability?.confidence ?? 0.4,
    explanation,
    modelVersion: MODEL_VERSION,
    featureVersion: FEATURE_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    evidenceId: null,
    createdAt: now,
    resolvedAt: null,
  };
}

export function listPredictions(
  tenantId: string,
  entityType: string,
  entityId: string,
  limit = 20,
): PredictionRecord[] {
  const rows = db.rawGet(
    `SELECT * FROM execution_predictions
     WHERE tenant_id = ? AND entity_type = ? AND entity_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [tenantId, entityType, entityId, limit],
  ) as {
    id: string;
    tenant_id: string;
    entity_type: string;
    entity_id: string;
    prediction_type: string;
    predicted_value: number;
    actual_value: number | null;
    confidence: number;
    explanation_json: string;
    model_version: string;
    feature_version: string;
    algorithm_version: string;
    evidence_id: string | null;
    created_at: string;
    resolved_at: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    predictionType: r.prediction_type,
    predictedValue: r.predicted_value,
    actualValue: r.actual_value,
    confidence: r.confidence,
    explanation: JSON.parse(r.explanation_json) as PredictionExplanation[],
    modelVersion: r.model_version,
    featureVersion: r.feature_version,
    algorithmVersion: r.algorithm_version,
    evidenceId: r.evidence_id,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }));
}

export function beliefConfidenceFromVariance(mean: number, variance: number, nObs: number): number {
  return beliefConfidence(mean, variance, nObs);
}
