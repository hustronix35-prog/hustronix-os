import { db } from "../database.js";
import {
  BASE_CAPACITY_WEIGHT,
  DERIVED_CAPACITY_THRESHOLD,
  LOAD_BUCKETS,
  TRUST_WEIGHTS,
} from "./config.js";
import type { BeliefView } from "./types.js";

export function beliefConfidence(mean: number, variance: number, nObs: number): number {
  const fromVar = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) * 2));
  const fromN = Math.min(1, nObs / 10);
  return Math.max(0.05, Math.min(1, fromVar * 0.6 + fromN * 0.4)) * (0.5 + mean * 0.5);
}

export function listBeliefsForEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
): BeliefView[] {
  const rows = db.rawGet(
    `SELECT belief_key, mean, variance, n_obs, model_id FROM entity_beliefs
     WHERE tenant_id = ? AND entity_type = ? AND entity_id = ?`,
    [tenantId, entityType, entityId],
  ) as { belief_key: string; mean: number; variance: number; n_obs: number; model_id: string }[];

  return rows.map((r) => ({
    beliefKey: r.belief_key,
    mean: r.mean,
    variance: r.variance,
    nObs: r.n_obs,
    modelId: r.model_id,
    confidence: beliefConfidence(r.mean, r.variance, r.n_obs),
  }));
}

export function computeTrustScore(beliefs: BeliefView[]): { mean: number; confidence: number; nObs: number } {
  let weighted = 0;
  let weightSum = 0;
  let totalObs = 0;
  for (const [key, w] of Object.entries(TRUST_WEIGHTS)) {
    const b = beliefs.find((x) => x.beliefKey === key);
    if (!b) continue;
    weighted += b.mean * b.confidence * w;
    weightSum += w;
    totalObs += b.nObs;
  }
  const mean = weightSum > 0 ? weighted / weightSum : 0.5;
  const confidences = beliefs
    .filter((b) => TRUST_WEIGHTS[b.beliefKey])
    .map((b) => b.confidence);
  const confidence =
    confidences.length > 0 ? confidences.reduce((a, c) => a + c, 0) / confidences.length : 0.35;
  return { mean, confidence, nObs: totalObs };
}

export interface DerivedCapacityResult {
  derivedCapacity: number;
  confidence: number;
  uncertainty: number;
  loadCurve: { bucket: string; successRate: number; confidence: number; nObs: number }[];
}

/** Derive capacity from performance_at_load beliefs at read time. */
export function computeDerivedCapacity(beliefs: BeliefView[]): DerivedCapacityResult {
  const loadCurve = LOAD_BUCKETS.map((b) => {
    const belief = beliefs.find((x) => x.beliefKey === `performance_at_load:${b.key}`);
    return {
      bucket: b.key,
      successRate: belief?.mean ?? 0.5,
      confidence: belief?.confidence ?? 0.2,
      nObs: belief?.nObs ?? 0,
    };
  });

  let derivedCapacity = BASE_CAPACITY_WEIGHT * 0.5;
  for (const point of loadCurve) {
    const bucketMax = point.bucket === "3+" ? 4 : Number(point.bucket.split("-")[1] ?? 1);
    if (point.successRate >= DERIVED_CAPACITY_THRESHOLD && point.nObs > 0) {
      derivedCapacity = Math.max(derivedCapacity, bucketMax);
    }
  }

  const confidences = loadCurve.filter((p) => p.nObs > 0).map((p) => p.confidence);
  const confidence =
    confidences.length > 0 ? confidences.reduce((a, c) => a + c, 0) / confidences.length : 0.25;
  const variances = beliefs
    .filter((b) => b.beliefKey.startsWith("performance_at_load:"))
    .map((b) => b.variance);
  const uncertainty =
    variances.length > 0 ? variances.reduce((a, v) => a + v, 0) / variances.length : 0.25;

  return { derivedCapacity, confidence, uncertainty, loadCurve };
}

export interface OwnerProfileView {
  owner: string;
  beliefs: BeliefView[];
  trustScore: { mean: number; confidence: number; nObs: number };
  derivedCapacity: DerivedCapacityResult;
  legacyCapacity: number;
  topBeliefs: BeliefView[];
  expertise: BeliefView[];
}

export function buildOwnerProfile(
  tenantId: string,
  owner: string,
  legacyCapacity: number,
): OwnerProfileView {
  const beliefs = listBeliefsForEntity(tenantId, "person", owner);
  const trustScore = computeTrustScore(beliefs);
  const derivedCapacity = computeDerivedCapacity(beliefs);
  const core = beliefs.filter((b) => !b.beliefKey.includes(":"));
  const topBeliefs = core
    .sort((a, b) => b.mean * b.confidence - a.mean * a.confidence)
    .slice(0, 8);
  const expertise = beliefs
    .filter((b) => b.beliefKey.startsWith("expertise:"))
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 10);

  return {
    owner,
    beliefs,
    trustScore,
    derivedCapacity,
    legacyCapacity,
    topBeliefs,
    expertise,
  };
}

export interface CalibrationStats {
  algorithmVersion: string;
  count: number;
  meanError: number;
  resolved: number;
}

export function computeCalibration(
  tenantId: string,
  entityType: string,
  entityId: string,
): CalibrationStats[] {
  const rows = db.rawGet(
    `SELECT algorithm_version, predicted_value, actual_value, resolved_at
     FROM execution_predictions
     WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? AND resolved_at IS NOT NULL`,
    [tenantId, entityType, entityId],
  ) as {
    algorithm_version: string;
    predicted_value: number;
    actual_value: number;
    resolved_at: string;
  }[];

  const byAlgo = new Map<string, { errors: number[]; resolved: number }>();
  for (const r of rows) {
    const entry = byAlgo.get(r.algorithm_version) ?? { errors: [], resolved: 0 };
    entry.errors.push(Math.abs(r.predicted_value - r.actual_value));
    entry.resolved += 1;
    byAlgo.set(r.algorithm_version, entry);
  }

  return [...byAlgo.entries()].map(([algorithmVersion, data]) => ({
    algorithmVersion,
    count: data.errors.length,
    meanError: data.errors.length
      ? data.errors.reduce((a, e) => a + e, 0) / data.errors.length
      : 0,
    resolved: data.resolved,
  }));
}
