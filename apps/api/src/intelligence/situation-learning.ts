/**
 * Outcome → learning loop: record whether situation predictions aged well.
 * Idempotent on (user_id, situation_decide:{situation_id}).
 */
import { db } from "../database.js";
import { upsertLearningLog } from "../evaluation/learning-log.js";

export type SituationLearning = {
  situation_id: string;
  pattern_id: string;
  predicted_ready_day: number | null;
  outcome: "resolved" | "worsened" | "stable" | "decided";
  was_useful: boolean;
  note: string;
};

export function recordSituationLearnings(userId: string): SituationLearning[] {
  const sits = db.rawGet(
    `SELECT id, pattern_id, title, stage, trajectory, decision_ready_day, decision_id, confidence
     FROM situations WHERE user_id = ? AND stage IN ('DECIDED','RESOLVED')`,
    [userId],
  ) as Array<{
    id: string;
    pattern_id: string;
    title: string;
    stage: string;
    trajectory: string;
    decision_ready_day: number | null;
    decision_id: string | null;
    confidence: number;
  }>;

  const out: SituationLearning[] = [];
  for (const s of sits) {
    let outcome: SituationLearning["outcome"] = "stable";
    if (s.stage === "RESOLVED" || s.trajectory === "IMPROVING") outcome = "resolved";
    else if (s.trajectory === "WORSENING") outcome = "worsened";
    else if (s.decision_id) outcome = "decided";

    const was_useful =
      outcome === "decided" ||
      outcome === "resolved" ||
      (s.decision_ready_day != null && s.confidence >= 0.55);

    const note =
      outcome === "resolved"
        ? `Situation ${s.title} de-escalated — early awareness was valuable.`
        : outcome === "decided"
          ? `Decision created from ${s.title} at readiness day ${s.decision_ready_day}.`
          : `Situation ${s.title} remained ${s.trajectory}.`;

    out.push({
      situation_id: s.id,
      pattern_id: s.pattern_id,
      predicted_ready_day: s.decision_ready_day,
      outcome,
      was_useful,
      note,
    });

    upsertLearningLog({
      userId,
      kind: "situation_decide",
      keyId: s.id,
      decisionId: s.decision_id,
      insight: note,
      analysis: { situation_id: s.id, outcome, was_useful },
      weights: { pattern_id: s.pattern_id, ready_day: s.decision_ready_day },
    });
  }
  return out;
}

export function situationCalibration(userId: string): {
  useful_rate: number;
  decided: number;
  resolved: number;
  total: number;
} {
  const rows = db.rawGet(`SELECT stage, trajectory FROM situations WHERE user_id = ?`, [
    userId,
  ]) as { stage: string; trajectory: string }[];
  const decided = rows.filter((r) => r.stage === "DECIDED").length;
  const resolved = rows.filter((r) => r.stage === "RESOLVED").length;
  const total = rows.length;
  return {
    useful_rate: total ? Math.round(((decided + resolved) / total) * 1000) / 1000 : 0,
    decided,
    resolved,
    total,
  };
}
