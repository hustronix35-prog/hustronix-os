import { db } from "../database.js";
import { evidenceWeight } from "./decay.js";
import type { EntityBeliefRow } from "./types.js";
import { updateBeliefWithModel } from "./models/index.js";
import type { ExtractedFeature } from "./feature-extractor.js";

function getBelief(
  tenantId: string,
  entityType: string,
  entityId: string,
  beliefKey: string,
): EntityBeliefRow | null {
  const row = db
    .rawGet(
      `SELECT * FROM entity_beliefs
       WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? AND belief_key = ?`,
      [tenantId, entityType, entityId, beliefKey],
    )
    .at(0) as EntityBeliefRow | undefined;
  return row ?? null;
}

function upsertBelief(
  tenantId: string,
  entityType: string,
  entityId: string,
  beliefKey: string,
  updated: ReturnType<typeof updateBeliefWithModel>,
) {
  db.rawRun(
    `INSERT INTO entity_beliefs (
      tenant_id, entity_type, entity_id, belief_key, model_id, mean, variance, n_obs, params_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id, entity_type, entity_id, belief_key) DO UPDATE SET
      model_id = excluded.model_id,
      mean = excluded.mean,
      variance = excluded.variance,
      n_obs = excluded.n_obs,
      params_json = excluded.params_json,
      updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      entityType,
      entityId,
      beliefKey,
      updated.model_id,
      updated.mean,
      updated.variance,
      updated.n_obs,
      updated.params_json,
    ],
  );
}

function applyOne(
  tenantId: string,
  entityType: string,
  entityId: string,
  beliefKey: string,
  obs: { success?: boolean; value?: number },
  weight: number,
) {
  const existing = getBelief(tenantId, entityType, entityId, beliefKey);
  const updated = updateBeliefWithModel(beliefKey, existing, obs, weight);
  upsertBelief(tenantId, entityType, entityId, beliefKey, updated);
}

export function applyFeaturesToBeliefs(
  tenantId: string,
  features: ExtractedFeature[],
  observedAt: string,
) {
  const weight = evidenceWeight(observedAt);
  for (const f of features) {
    const { features: fv } = f;
    const entityType = f.entityType;
    const entityId = f.entityId;

    if (f.featureVersion !== "v1") continue;

    switch (true) {
      case fv.success === true && fv.on_time !== false: {
        applyOne(tenantId, entityType, entityId, "reliability", { success: true }, weight);
        applyOne(
          tenantId,
          entityType,
          entityId,
          "execution_speed",
          { value: Math.max(0, 1 - (fv.duration_ratio ?? 1) + 0.5) },
          weight,
        );
        if (fv.load_bucket) {
          applyOne(
            tenantId,
            entityType,
            entityId,
            `performance_at_load:${fv.load_bucket}`,
            { success: true },
            weight,
          );
        }
        for (const domain of fv.domain_tokens ?? []) {
          applyOne(tenantId, entityType, entityId, `expertise:${domain}`, { success: true }, weight * 0.5);
        }
        break;
      }
      case fv.success === true && fv.on_time === false: {
        applyOne(
          tenantId,
          entityType,
          entityId,
          "planning_accuracy",
          { value: Math.max(0, 1 - (fv.planning_error_ratio ?? 0.2)) },
          weight,
        );
        applyOne(
          tenantId,
          entityType,
          entityId,
          "execution_speed",
          { value: Math.max(0, 0.5 - (fv.planning_error_ratio ?? 0.2)) },
          weight,
        );
        break;
      }
      case fv.attribution === "external_blocker":
        break;
      case fv.success === false && fv.attribution != null: {
        if (fv.attribution !== "external_blocker") {
          applyOne(tenantId, entityType, entityId, "reliability", { success: false }, weight);
          applyOne(tenantId, entityType, entityId, "ownership", { success: false }, weight);
        }
        if (fv.load_bucket) {
          applyOne(
            tenantId,
            entityType,
            entityId,
            `performance_at_load:${fv.load_bucket}`,
            { success: false },
            weight,
          );
        }
        break;
      }
      case fv.grace_exceeded === true: {
        applyOne(tenantId, entityType, entityId, "reliability", { success: false }, weight);
        applyOne(tenantId, entityType, entityId, "ownership", { success: false }, weight);
        break;
      }
      case fv.delta_score != null: {
        applyOne(
          tenantId,
          entityType,
          entityId,
          "decision_quality",
          { value: fv.delta_score },
          weight,
        );
        applyOne(
          tenantId,
          entityType,
          entityId,
          "learning_rate",
          { value: fv.delta_score },
          weight * 0.5,
        );
        break;
      }
      case fv.error_magnitude != null: {
        applyOne(
          tenantId,
          entityType,
          entityId,
          "consistency",
          { value: Math.max(0, 1 - fv.error_magnitude) },
          weight * 0.5,
        );
        break;
      }
      case fv.collaboration_signal === true: {
        applyOne(tenantId, entityType, entityId, "collaboration", { success: true }, weight * 0.3);
        break;
      }
      case fv.recovery_path === true: {
        applyOne(tenantId, entityType, entityId, "recovery_ability", { success: true }, weight);
        break;
      }
      default:
        break;
    }
  }
}

export function clearBeliefsForTenant(tenantId: string) {
  db.rawRun(`DELETE FROM entity_beliefs WHERE tenant_id = ?`, [tenantId]);
}
