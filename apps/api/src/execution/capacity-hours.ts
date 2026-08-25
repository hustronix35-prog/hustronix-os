/**
 * Hours-based capacity. Weight stays a UI/EIE signal; activation uses hours.
 * Pure helpers — callers supply roster hours and task rows (avoids database.ts cycles).
 */
export type HoursTask = {
  estimated_duration_hours?: number | null;
  weight?: number | null;
  status?: string | null;
  due_at?: string | null;
  dependencies?: string | null;
  task_id?: string;
};

export function taskEffortHours(task: HoursTask): number {
  const h = Number(task.estimated_duration_hours);
  if (Number.isFinite(h) && h > 0) return h;
  const w = Number(task.weight);
  if (Number.isFinite(w) && w > 0) return w * 8;
  return 8;
}

export function availableHours(rosterHours: number | null | undefined, reputationModifier?: number): number {
  const base = rosterHours != null && rosterHours > 0 ? rosterHours : 24;
  const mod = Number(reputationModifier);
  if (Number.isFinite(mod) && mod > 0 && mod < 1) return Math.max(1, base * mod);
  return base;
}

export function hoursUntilDue(dueAt: string | null | undefined, now = Date.now()): number | null {
  if (!dueAt) return null;
  const t = Date.parse(dueAt);
  if (!Number.isFinite(t)) return null;
  return (t - now) / 3600000;
}

export function evaluateHoursActivation(input: {
  availableHours: number;
  remainingActiveHours: number;
  newTaskHours: number;
  incompleteDeps: number;
  pathHoursUntilDue?: number | null;
  hoursUntilDue?: number | null;
}): { ok: boolean; reasons: string[]; overloadHours: number; message: string | null } {
  const reasons: string[] = [];
  if (input.incompleteDeps > 0) {
    reasons.push("dependency_incomplete");
  }
  const projected = input.remainingActiveHours + input.newTaskHours;
  const overloadHours = Math.max(0, projected - input.availableHours);
  if (overloadHours > 0) {
    reasons.push("capacity_exceeded");
  }
  if (
    input.hoursUntilDue != null &&
    input.pathHoursUntilDue != null &&
    input.pathHoursUntilDue > input.hoursUntilDue
  ) {
    reasons.push("deadline_infeasible");
  }
  const message = overloadHours
    ? `Overloaded by ${Math.round(overloadHours * 10) / 10} hours (${Math.round(projected * 10) / 10}h needed vs ${Math.round(input.availableHours * 10) / 10}h available).`
    : null;
  return { ok: reasons.length === 0, reasons, overloadHours, message };
}
