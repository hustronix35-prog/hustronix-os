/**
 * Teams intelligence — derived from situations, dependencies, and execution load.
 * Read-only. Inference runs on detect, not on GET.
 */
import { db } from "../database.js";
import { buildOrgIntelligence } from "../org/intelligence.js";

export type TeamBottleneck = {
  team: string;
  blocked_by: string[];
  blocking: string[];
  open_situations: string[];
  open_situation_ids: string[];
  at_risk_decisions: number;
  overload_people: string[];
  critical_path: boolean;
  evidence: string[];
};

export type TeamsIntelligence = {
  bottlenecks: TeamBottleneck[];
  cross_team_edges: Array<{
    from: string;
    to: string;
    work: string;
    status: string;
    source: string;
    confidence?: number | null;
    evidence?: string[];
    situation_id?: string | null;
    edge_type?: string | null;
  }>;
  situations_by_team: Record<string, string[]>;
  summary: string;
};

function normTeam(t: string): string {
  return String(t || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildTeamsIntelligence(userId: string): TeamsIntelligence {
  const org = buildOrgIntelligence(userId);
  const sits = db.rawGet(
    `SELECT id, title, stage, trajectory, teams_json, people_json, explanation
     FROM situations WHERE user_id = ? AND stage != 'RESOLVED'
     ORDER BY updated_at DESC LIMIT 40`,
    [userId],
  ) as Array<{
    id: string;
    title: string;
    stage: string;
    trajectory: string;
    teams_json: string | null;
    people_json: string | null;
    explanation: string | null;
  }>;

  const situations_by_team: Record<string, string[]> = {};
  const situation_ids_by_team: Record<string, string[]> = {};
  for (const s of sits) {
    let teams: string[] = [];
    try {
      const raw = s.teams_json ? JSON.parse(s.teams_json) : [];
      for (const edge of raw) {
        const parts = String(edge).split("→");
        for (const p of parts) {
          const t = normTeam(p);
          if (t) teams.push(t);
        }
      }
    } catch {
      /* ignore */
    }
    if (!teams.length && s.explanation) {
      for (const t of ["engineering", "security", "finance", "sales", "product", "support", "qa"]) {
        if (s.explanation.toLowerCase().includes(t)) teams.push(t);
      }
    }
    for (const t of [...new Set(teams)]) {
      if (!situations_by_team[t]) situations_by_team[t] = [];
      if (!situation_ids_by_team[t]) situation_ids_by_team[t] = [];
      situations_by_team[t].push(s.title);
      situation_ids_by_team[t].push(s.id);
    }
  }

  const cross_team_edges = (org.dependencies || []).map((d) => ({
    from: d.fromTeam,
    to: d.toTeam,
    work: d.fromWork || d.toWork || "",
    status: d.status,
    source: d.source,
    confidence: d.confidence ?? null,
    evidence: d.evidence || [],
    situation_id: d.situationId ?? null,
    edge_type: d.edgeType ?? null,
  }));

  const teamNames = new Set<string>();
  for (const t of org.teams || []) teamNames.add(normTeam(t.name));
  for (const e of cross_team_edges) {
    teamNames.add(normTeam(e.from));
    teamNames.add(normTeam(e.to));
  }
  for (const t of Object.keys(situations_by_team)) teamNames.add(t);

  const bottlenecks: TeamBottleneck[] = [];
  for (const team of teamNames) {
    if (!team) continue;
    const blocked_by = cross_team_edges
      .filter((e) => normTeam(e.from) === team && (e.status === "DELAYED" || e.status === "AT_RISK"))
      .map((e) => e.to);
    const blocking = cross_team_edges
      .filter((e) => normTeam(e.to) === team && (e.status === "DELAYED" || e.status === "AT_RISK"))
      .map((e) => e.from);
    const people = (org.people || []).filter((p) => normTeam(p.team) === team);
    const overload_people = people
      .filter((p) => p.workload === "High" || p.loadPct >= 85)
      .map((p) => p.name);
    const at_risk_decisions = people.reduce((n, p) => n + (p.blocked || 0), 0);
    const critical_path = people.some((p) => p.criticalPath) || blocked_by.length + blocking.length >= 2;
    const evidence = cross_team_edges
      .filter((e) => normTeam(e.from) === team || normTeam(e.to) === team)
      .flatMap((e) => e.evidence || [])
      .slice(0, 4);
    if (
      blocked_by.length ||
      blocking.length ||
      (situations_by_team[team] || []).length ||
      overload_people.length
    ) {
      bottlenecks.push({
        team,
        blocked_by: [...new Set(blocked_by)],
        blocking: [...new Set(blocking)],
        open_situations: situations_by_team[team] || [],
        open_situation_ids: situation_ids_by_team[team] || [],
        at_risk_decisions,
        overload_people,
        critical_path,
        evidence,
      });
    }
  }

  bottlenecks.sort(
    (a, b) =>
      Number(b.critical_path) - Number(a.critical_path) ||
      b.blocked_by.length + b.blocking.length - (a.blocked_by.length + a.blocking.length),
  );

  const top = bottlenecks[0];
  const summary = top
    ? `Hottest bottleneck: ${top.team}` +
      (top.blocked_by.length ? ` waiting on ${top.blocked_by.join(", ")}` : "") +
      (top.open_situations.length ? ` · situations: ${top.open_situations.slice(0, 2).join("; ")}` : "")
    : "No cross-team bottlenecks detected from current situations and workflow.";

  return { bottlenecks, cross_team_edges, situations_by_team, summary };
}
