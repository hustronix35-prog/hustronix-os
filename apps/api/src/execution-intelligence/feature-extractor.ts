import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { FEATURE_VERSION, loadBucketFor } from "./config.js";
import type { EvidenceRecord, FeatureVector } from "./types.js";

export interface ExtractedFeature {
  evidenceId: string;
  entityType: string;
  entityId: string;
  features: FeatureVector;
  featureVersion: string;
}

function tokenizeDomain(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 3)
    .slice(0, 8);
}

function ownerActiveLoad(owner: string): number {
  const row = db
    .rawGet(
      `SELECT COALESCE(SUM(weight), 0) AS w FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'`,
      [owner],
    )
    .at(0) as { w: number } | undefined;
  return Number(row?.w ?? 0);
}

export function extractFeaturesFromEvidence(evidence: EvidenceRecord): ExtractedFeature[] {
  const p = evidence.payload;
  const out: ExtractedFeature[] = [];
  const base = {
    evidenceId: evidence.id,
    entityType: evidence.subjectEntityType,
    entityId: evidence.subjectEntityId,
    featureVersion: FEATURE_VERSION,
    features: {} as FeatureVector,
  };

  switch (evidence.eventType) {
    case "task.completed": {
      const activeLoad = Number(p.active_load ?? ownerActiveLoad(evidence.subjectEntityId));
      const durationRatio = Number(p.duration_ratio ?? 1);
      const onTime = p.on_time !== false && durationRatio <= 1.05;
      const domainTokens = Array.isArray(p.domain_tokens)
        ? (p.domain_tokens as string[])
        : tokenizeDomain(String(p.success_condition ?? ""));
      const bucket = loadBucketFor(activeLoad);
      out.push({
        ...base,
        features: {
          active_load: activeLoad,
          duration_ratio: durationRatio,
          on_time: onTime,
          domain_tokens: domainTokens,
          load_bucket: bucket,
          success: true,
          planning_error_ratio: onTime ? 0 : Math.max(0, durationRatio - 1),
        },
      });
      break;
    }
    case "task.killed": {
      const attribution = String(p.attribution ?? "unknown");
      const activeLoad = Number(p.active_load ?? ownerActiveLoad(evidence.subjectEntityId));
      out.push({
        ...base,
        features: {
          attribution,
          active_load: activeLoad,
          load_bucket: loadBucketFor(activeLoad),
          success: false,
        },
      });
      break;
    }
    case "task.blocked":
      out.push({
        ...base,
        features: { active_load: Number(p.active_load ?? 0), success: false },
      });
      break;
    case "signal.shadow_killed":
      out.push({
        ...base,
        features: {
          source: String(p.source ?? ""),
          grace_exceeded: true,
          success: false,
        },
      });
      break;
    case "signal.linked":
      out.push({
        ...base,
        features: { success: true, collaboration_signal: true },
      });
      break;
    case "decision.outcome":
      out.push({
        ...base,
        features: {
          delta_score: Number(p.delta_score ?? 0),
          success: Number(p.delta_score ?? 0) >= 0.5,
        },
      });
      break;
    case "prediction.calibration_error":
      out.push({
        ...base,
        features: {
          error_magnitude: Number(p.error_magnitude ?? 0),
          prediction_type: String(p.prediction_type ?? ""),
          success: Number(p.error_magnitude ?? 1) < 0.15,
        },
      });
      break;
    case "task.spawned":
      out.push({
        ...base,
        features: { active_load: Number(p.active_load ?? 0) },
      });
      break;
    default:
      break;
  }

  for (const f of out) {
    const id = uuidv4();
    db.rawRun(
      `INSERT INTO execution_features (
        id, tenant_id, evidence_id, entity_type, entity_id, feature_version, features_json, extracted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        evidence.tenantId,
        f.evidenceId,
        f.entityType,
        f.entityId,
        f.featureVersion,
        JSON.stringify(f.features),
        evidence.observedAt,
      ],
    );
  }

  return out;
}

export function getFeaturesForEvidence(evidenceId: string): ExtractedFeature[] {
  const rows = db.rawGet(
    `SELECT entity_type, entity_id, feature_version, features_json, evidence_id
     FROM execution_features WHERE evidence_id = ?`,
    [evidenceId],
  ) as {
    entity_type: string;
    entity_id: string;
    feature_version: string;
    features_json: string;
    evidence_id: string;
  }[];

  return rows.map((r) => ({
    evidenceId: r.evidence_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    featureVersion: r.feature_version,
    features: JSON.parse(r.features_json) as FeatureVector,
  }));
}
