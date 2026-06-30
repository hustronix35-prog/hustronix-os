import { db } from "../database.js";
import { clearBeliefsForTenant, applyFeaturesToBeliefs } from "./belief-engine.js";
import { getFeaturesForEvidence } from "./feature-extractor.js";

/**
 * Rebuild entity_beliefs from execution_features (replay-safe for algorithm fixes).
 */
export function replayBeliefsForTenant(tenantId: string): { featuresReplayed: number } {
  clearBeliefsForTenant(tenantId);

  const evidenceRows = db.rawGet(
    `SELECT id, observed_at FROM execution_evidence WHERE tenant_id = ? ORDER BY observed_at ASC`,
    [tenantId],
  ) as { id: string; observed_at: string }[];

  let featuresReplayed = 0;
  for (const ev of evidenceRows) {
    const features = getFeaturesForEvidence(ev.id);
    if (features.length) {
      applyFeaturesToBeliefs(tenantId, features, ev.observed_at);
      featuresReplayed += features.length;
    }
  }

  return { featuresReplayed };
}
