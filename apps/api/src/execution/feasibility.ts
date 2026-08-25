/**
 * Hours × deps × deadline for a decision — Talk "can we execute this?"
 */
import { db } from "../database.js";
import {
  availableHours,
  evaluateHoursActivation,
  hoursUntilDue,
  taskEffortHours,
  type HoursTask,
} from "./capacity-hours.js";

export type FeasibilityReport = {
  owner: string;
  availableHours: number;
  remainingActiveHours: number;
  newTaskHours: number;
  overloadHours: number;
  ok: boolean;
  message: string | null;
  reasons: string[];
};

export function evaluateDecisionHoursFeasibility(userId: string, decisionId: string): {
  ok: boolean;
  reports: FeasibilityReport[];
  message: string;
} {
  const tasks = db.rawGet(
    `SELECT e.task_id, e.owner, e.status, e.weight, e.estimated_duration_hours, e.due_at, e.dependencies
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE e.decision_id = ? AND d.user_id = ?`,
    [decisionId, userId],
  ) as Array<HoursTask & { owner: string; status: string }>;

  const byOwner = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const owner = String(t.owner || "Unassigned");
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(t);
  }

  const reports: FeasibilityReport[] = [];
  for (const [owner, owned] of byOwner) {
    const cap = db.getOwnerCapacity(owner, userId);
    const avail = availableHours(cap.roster_hours, cap.reputation_modifier);
    const remaining = db.getOwnerActiveHours(owner, userId);
    const incoming = owned.filter((t) => {
      const st = String(t.status || "").toUpperCase();
      return st !== "DONE" && st !== "KILLED" && st !== "ACTIVE";
    });
    const sized =
      incoming.length > 0
        ? incoming
        : owned.filter((t) => {
            const st = String(t.status || "").toUpperCase();
            return st !== "DONE" && st !== "KILLED";
          });
    const newHours = sized.reduce((n, t) => n + taskEffortHours(t), 0);
    const incompleteDeps = incoming.reduce((n, t) => {
      let deps: string[] = [];
      try {
        const raw = t.dependencies ? JSON.parse(String(t.dependencies)) : [];
        deps = Array.isArray(raw) ? raw.map(String) : [];
      } catch {
        deps = [];
      }
      return n + deps.length;
    }, 0);
    const due = incoming.map((t) => hoursUntilDue(t.due_at)).find((h) => h != null) ?? null;
    const judged = evaluateHoursActivation({
      availableHours: avail,
      remainingActiveHours: remaining,
      newTaskHours: newHours || owned.filter((t) => String(t.status).toUpperCase() !== "DONE" && String(t.status).toUpperCase() !== "KILLED").reduce((n, t) => n + taskEffortHours(t), 0),
      incompleteDeps,
      hoursUntilDue: due,
      pathHoursUntilDue: newHours,
    });
    reports.push({
      owner,
      availableHours: avail,
      remainingActiveHours: remaining,
      newTaskHours: newHours,
      overloadHours: judged.overloadHours,
      ok: judged.ok,
      message: judged.message,
      reasons: judged.reasons,
    });
  }

  const blocked = reports.filter((r) => !r.ok);
  const ok = blocked.length === 0;
  const message = ok
    ? reports.length
      ? `Feasible. ${reports.map((r) => `${r.owner}: ${Math.round(r.remainingActiveHours + r.newTaskHours)}h of ${Math.round(r.availableHours)}h`).join("; ")}.`
      : "No governed tasks to size yet."
    : blocked.map((r) => r.message || `${r.owner} cannot take this work.`).join(" ");

  return { ok, reports, message };
}
