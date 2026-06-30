import { db } from "../database.js";
import { recordEvidence } from "./evidence-collector.js";

export function resolvePrediction(predictionId: string, actualValue: number): void {
  const row = db
    .rawGet(`SELECT * FROM execution_predictions WHERE id = ?`, [predictionId])
    .at(0) as
    | {
        id: string;
        tenant_id: string;
        entity_type: string;
        entity_id: string;
        prediction_type: string;
        predicted_value: number;
        actual_value: number | null;
        resolved_at: string | null;
      }
    | undefined;

  if (!row || row.resolved_at) return;

  const error = Math.abs(row.predicted_value - actualValue);
  const now = new Date().toISOString();

  db.rawRun(
    `UPDATE execution_predictions SET actual_value = ?, resolved_at = ? WHERE id = ?`,
    [actualValue, now, predictionId],
  );

  recordEvidence({
    tenantId: row.tenant_id,
    eventType: "prediction.calibration_error",
    subjectEntityType: "person",
    subjectEntityId: row.entity_id,
    sourceEntityType: "task",
    sourceEntityId: predictionId,
    payload: {
      prediction_id: predictionId,
      prediction_type: row.prediction_type,
      predicted_value: row.predicted_value,
      actual_value: actualValue,
      error_magnitude: error,
    },
    observedAt: now,
    idempotencyKey: `calibration:${predictionId}`,
  });
}
