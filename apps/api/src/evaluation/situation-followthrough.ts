/**
 * Situation follows the decision outcome. Ledger stays source of truth.
 * COMPLETED does not mean the business problem is gone.
 */
import { db } from "../database.js";

export type SituationFollowthrough = {
  situationId: string | null;
  previousStage: string | null;
  nextStage: string | null;
  note: string;
};

export function applySituationFollowthrough(
  decisionId: string,
  decisionStatus: "COMPLETED" | "REVERSED",
): SituationFollowthrough {
  const sit = (
    db.rawGet(
      `SELECT id, stage, trajectory FROM situations WHERE decision_id = ? LIMIT 1`,
      [decisionId],
    ) as { id: string; stage: string; trajectory: string }[]
  )[0];
  if (!sit) {
    return {
      situationId: null,
      previousStage: null,
      nextStage: null,
      note: "No linked situation.",
    };
  }

  if (decisionStatus === "REVERSED") {
    const next = sit.stage === "DECIDED" || sit.stage === "DECISION_READY" ? "DECISION_READY" : "ELEVATED";
    db.rawRun(`UPDATE situations SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      next,
      sit.id,
    ]);
    return {
      situationId: sit.id,
      previousStage: sit.stage,
      nextStage: next,
      note: "Decision reversed. Situation stays on the evidence trail for another governed decision.",
    };
  }

  const stillWorsening = String(sit.trajectory || "").toUpperCase() === "WORSENING";
  if (stillWorsening) {
    db.rawRun(
      `UPDATE situations SET stage = 'DECIDED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stage != 'RESOLVED'`,
      [sit.id],
    );
    return {
      situationId: sit.id,
      previousStage: sit.stage,
      nextStage: "DECIDED",
      note: "Executed, but evidence is still worsening. Task completion is not business success.",
    };
  }

  db.rawRun(`UPDATE situations SET stage = 'RESOLVED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [sit.id]);
  return {
    situationId: sit.id,
    previousStage: sit.stage,
    nextStage: "RESOLVED",
    note: "Situation resolved — trajectory is no longer worsening.",
  };
}
