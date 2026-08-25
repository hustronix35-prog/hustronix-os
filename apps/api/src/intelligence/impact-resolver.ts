import { db } from "../database.js";
import { buildOrgIntelligence, type OrgDependency, type OrgPerson } from "../org/intelligence.js";
import { formatEvidenceLine, loadEvidenceReferences } from "./evidence-reference.js";

export type SituationImpact = {
  entity: string | null;
  affected_people: Array<{ name: string; team: string; role: string; reason: string }>;
  affected_teams: string[];
  owner: { name: string; team: string } | null;
  waiting_on: Array<{ from_team: string; to_team: string; status: string; work: string; blocker_work: string }>;
  blocking_team: string | null;
  bottleneck: string | null;
  evidence: string[];
};

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function norm(s: string): string {
  return String(s || "").trim().toLowerCase();
}

function teamNamesFromSituation(rawTeams: string[]): string[] {
  const out = new Set<string>();
  for (const t of rawTeams) {
    for (const part of String(t).split("→")) {
      const name = part.trim();
      if (name) out.add(name);
    }
  }
  return [...out];
}

function pickOwner(ownership: Array<{ name: string; team: string; work: string }>, title: string) {
  const low = norm(title);
  return ownership.find((o) => norm(o.work).includes(low)) || ownership[0] || null;
}

function peopleForTeams(orgPeople: OrgPerson[], teams: string[], namedPeople: string[]): SituationImpact["affected_people"] {
  const wantedTeams = new Set(teams.map(norm));
  const wantedPeople = new Set(namedPeople.map(norm));
  const picked = orgPeople.filter((p) => wantedTeams.has(norm(p.team)) || wantedPeople.has(norm(p.name)) || wantedPeople.has(norm(p.owner)));
  return picked.slice(0, 8).map((p) => ({
    name: p.name,
    team: p.team,
    role: p.role,
    reason:
      p.blocked > 0
        ? `${p.blocked} blocked task(s)`
        : p.active > 0
          ? `${p.active} active task(s)`
          : p.workload === "High"
            ? "high load"
            : "named on affected team",
  }));
}

function depsForSituation(all: OrgDependency[], situationId: string, teams: string[]): OrgDependency[] {
  const teamSet = new Set(teams.map(norm));
  return all.filter(
    (d) =>
      d.situationId === situationId ||
      teamSet.has(norm(d.fromTeam)) ||
      teamSet.has(norm(d.toTeam)),
  );
}

export function resolveSituationImpact(userId: string, situationId: string): SituationImpact | null {
  const sit = (
    db.rawGet(
      `SELECT id, title, primary_entity_label, entities_json, people_json, teams_json, decision_id
       FROM situations WHERE user_id = ? AND id = ?`,
      [userId, situationId],
    ) as Array<{
      id: string;
      title: string;
      primary_entity_label: string | null;
      entities_json: string | null;
      people_json: string | null;
      teams_json: string | null;
      decision_id: string | null;
    }>
  )[0];
  if (!sit) return null;

  const entities = parseJsonArray(sit.entities_json);
  const namedPeople = parseJsonArray(sit.people_json);
  const teams = teamNamesFromSituation(parseJsonArray(sit.teams_json));
  const org = buildOrgIntelligence(userId);
  const deps = depsForSituation(org.dependencies || [], sit.id, teams).filter((d) => d.status !== "ON_TRACK");
  const owner = pickOwner(org.ownership || [], sit.title);
  const affectedPeople = peopleForTeams(org.people || [], teams, namedPeople);
  const evidence = loadEvidenceReferences(situationId, 6).map(formatEvidenceLine);
  const waiting_on = deps.slice(0, 6).map((d) => ({
    from_team: d.fromTeam,
    to_team: d.toTeam,
    status: d.status,
    work: d.fromWork,
    blocker_work: d.toWork,
  }));
  const blockingTeam = waiting_on[0]?.to_team || null;
  const bottleneck = waiting_on[0]
    ? `${waiting_on[0].from_team} is waiting on ${waiting_on[0].to_team}${
        waiting_on[0].blocker_work ? ` for ${waiting_on[0].blocker_work}` : ""
      }`
    : null;

  return {
    entity: sit.primary_entity_label || entities[0] || null,
    affected_people: affectedPeople,
    affected_teams: teams,
    owner: owner ? { name: owner.name, team: owner.team } : null,
    waiting_on,
    blocking_team: blockingTeam,
    bottleneck,
    evidence,
  };
}
