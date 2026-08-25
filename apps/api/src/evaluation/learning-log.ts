/**
 * Idempotent learning_log writes. Detect must not grow this table every cycle.
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";

export type LearningKind = "situation_decide" | "decision_outcome" | "readiness_learning";

export function learningIdempotencyKey(kind: LearningKind, id: string): string {
  return `${kind}:${id}`;
}

/** Returns true when a new row was inserted. */
export function upsertLearningLog(input: {
  userId: string;
  kind: LearningKind;
  keyId: string;
  decisionId?: string | null;
  insight: string;
  analysis?: unknown;
  weights?: unknown;
}): boolean {
  const key = learningIdempotencyKey(input.kind, input.keyId);
  try {
    db.rawRun(
      `INSERT INTO learning_log
        (id, user_id, decision_id, kind, idempotency_key, mistake_analysis, weight_shifts, surfaced_insight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        input.userId,
        input.decisionId || null,
        input.kind,
        key,
        JSON.stringify(input.analysis ?? {}),
        JSON.stringify(input.weights ?? {}),
        input.insight,
      ],
    );
    return true;
  } catch {
    return false;
  }
}
