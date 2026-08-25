/**
 * Infer dependencies from execution workflow state (blocked tasks, task deps),
 * not only from "waiting on" phrases in chat.
 */
import { db } from "../database.js";
import { persistInferredDependencies, type InferredDep } from "./dependency-infer.js";

function teamFromOwner(userId: string, owner: string): string {
  const roster = (
    db.rawGet(
      `SELECT team FROM team_roster WHERE user_id = ? AND (name = ? OR slack_id = ?) LIMIT 1`,
      [userId, owner, owner],
    ) as { team: string | null }[]
  )[0];
  const t = (roster?.team || "").toLowerCase();
  if (/eng|backend|sre|platform/.test(t)) return "engineering";
  if (/sec|grc|trust/.test(t)) return "security";
  if (/financ|fp&a/.test(t)) return "finance";
  if (/sales|revenue/.test(t)) return "sales";
  if (/success|cs|customer/.test(t)) return "customer success";
  if (/product/.test(t)) return "product";
  if (/qa|quality/.test(t)) return "qa support";
  if (/support/.test(t)) return "support";
  if (/hr|people/.test(t)) return "hr ops";
  if (/exec|leadership/.test(t)) return "executive";
  return t || "engineering";
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Walk execution_ledger: BLOCKED tasks + explicit task dependencies → org deps.
 */
export function inferDependenciesFromWorkflow(userId: string): number {
  const rows = db.rawGet(
    `SELECT e.task_id, e.status, e.owner, e.success_condition, e.blocked_reasons, e.dependencies, e.decision_id
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ?
     ORDER BY e.last_update DESC
     LIMIT 300`,
    [userId],
  ) as Array<{
    task_id: string;
    status: string;
    owner: string;
    success_condition: string | null;
    blocked_reasons: string | null;
    dependencies: string | null;
    decision_id: string;
  }>;

  const byId = new Map(rows.map((r) => [r.task_id, r]));
  const deps: InferredDep[] = [];

  for (const r of rows) {
    const status = String(r.status || "").toUpperCase();
    const fromTeam = teamFromOwner(userId, r.owner);

    // Explicit task → task dependencies
    for (const depId of parseJsonArray(r.dependencies)) {
      const upstream = byId.get(depId);
      if (!upstream) continue;
      const toTeam = teamFromOwner(userId, upstream.owner);
      if (fromTeam === toTeam) continue;
      deps.push({
        fromTeam,
        toTeam,
        fromWork: (r.success_condition || r.task_id).slice(0, 100),
        status: status === "BLOCKED" ? "DELAYED" : "AT_RISK",
        edgeType: "waits_on",
        confidence: 0.85,
        evidence: [r.task_id, depId],
      });
    }

    // BLOCKED with reasons → dependency on implied team
    if (status === "BLOCKED") {
      const reasons = parseJsonArray(r.blocked_reasons).join(" ") || r.success_condition || "";
      const lower = reasons.toLowerCase();
      let toTeam: string | null = null;
      if (/finance|budget|invoice|payment/.test(lower)) toTeam = "finance";
      else if (/security|access|audit|exception/.test(lower)) toTeam = "security";
      else if (/legal|counsel|gdpr|privacy/.test(lower)) toTeam = "legal";
      else if (/qa|test|regression/.test(lower)) toTeam = "qa support";
      else if (/sales|customer|renewal/.test(lower)) toTeam = "sales";
      else if (/product|prd|launch/.test(lower)) toTeam = "product";
      else if (/credential|api key|waiting/.test(lower)) toTeam = "security";
      if (toTeam && toTeam !== fromTeam) {
        deps.push({
          fromTeam,
          toTeam,
          fromWork: `Blocked: ${reasons.slice(0, 80) || r.task_id}`,
          status: "DELAYED",
          edgeType: "blocks",
          confidence: 0.7,
          evidence: [r.task_id],
        });
      }
    }
  }

  // Situation → team edges from open situations (affected teams)
  const sits = db.rawGet(
    `SELECT id, title, teams_json, trajectory, stage FROM situations
     WHERE user_id = ? AND stage IN ('ELEVATED','DECISION_READY','DECIDED','FORMING')`,
    [userId],
  ) as { id: string; title: string; teams_json: string | null; trajectory: string; stage: string }[];
  for (const s of sits) {
    let teams: string[] = [];
    try {
      teams = s.teams_json ? JSON.parse(s.teams_json) : [];
    } catch {
      teams = [];
    }
    // teams_json often "from→to" strings from patterns
    for (const edge of teams) {
      const m = String(edge).split("→");
      if (m.length === 2 && m[0].trim() && m[1].trim()) {
        deps.push({
          fromTeam: m[0].trim(),
          toTeam: m[1].trim(),
          fromWork: s.title.slice(0, 100),
          status: s.trajectory === "WORSENING" ? "AT_RISK" : "ON_TRACK",
          edgeType: "waits_on",
          confidence: 0.75,
          situationId: s.id,
          evidence: [s.id],
        });
      }
    }
  }

  return persistInferredDependencies(userId, deps);
}
