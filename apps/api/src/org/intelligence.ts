import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { buildTeamEntries } from "../teams/teamsMembers.js";

export type WorkloadBand = "High" | "Medium" | "Optimal" | "Low";
export type DepStatus = "ON_TRACK" | "AT_RISK" | "DELAYED";

export type OrgPerson = {
  owner: string;
  name: string;
  role: string;
  team: string;
  email: string;
  loadPct: number;
  status: string;
  workload: WorkloadBand;
  active: number;
  pending: number;
  blocked: number;
  waitingOn: string[];
  blocking: string[];
  focus: string[];
  reportsTo: string | null;
  initials: string;
  criticalPath: boolean;
};

export type OrgTeamRow = {
  id: string;
  name: string;
  parentId: string | null;
  healthPct: number;
  workload: WorkloadBand;
  atRisk: number;
  members: Array<{ name: string; initials: string; owner: string }>;
  peopleCount: number;
};

export type OrgTreeNode = {
  id: string;
  name: string;
  peopleCount: number;
  children: OrgTreeNode[];
};

export type OrgDependency = {
  id: string;
  fromTeam: string;
  fromWork: string;
  toTeam: string;
  toWork: string;
  status: DepStatus;
  source: "ledger" | "manual" | "inferred" | "pattern";
  executionId: string | null;
  edgeType?: string | null;
  confidence?: number | null;
  evidence?: string[];
  situationId?: string | null;
};

export type OrgEvent = {
  id: string;
  kind: string;
  actor: string | null;
  summary: string;
  createdAt: string;
};

export type OrgIntelligence = {
  snapshot: {
    people: number;
    teams: number;
    initiatives: number;
    healthPct: number;
    healthDelta: number;
    overloaded: number;
    depsAtRisk: number;
  };
  teams: OrgTeamRow[];
  tree: OrgTreeNode[];
  peopleAtRisk: OrgPerson[];
  people: OrgPerson[];
  dependencies: OrgDependency[];
  workload: { high: number; medium: number; optimal: number; low: number };
  recentChanges: OrgEvent[];
  ownership: Array<{
    owner: string;
    name: string;
    team: string;
    work: string;
    status: string;
    criticalPath: boolean;
  }>;
};

const DEFAULT_TEAMS: Array<{ name: string; parent: string | null; order: number }> = [
  { name: "Leadership", parent: null, order: 0 },
  { name: "Product", parent: "Leadership", order: 1 },
  { name: "Operations", parent: "Leadership", order: 2 },
  { name: "Engineering", parent: "Product", order: 3 },
  { name: "Marketing", parent: "Product", order: 4 },
  { name: "Design", parent: "Product", order: 5 },
  { name: "Sales", parent: "Product", order: 6 },
  { name: "Finance", parent: "Operations", order: 7 },
  { name: "People Ops", parent: "Operations", order: 8 },
];

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function initialsOf(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function inferTeamName(team: string, role: string, name: string): string {
  const given = String(team || "").trim();
  const skip = new Set(["execution", "general", "workspace", "unassigned", ""]);
  if (given && !skip.has(given.toLowerCase())) return given;
  const blob = `${role} ${name} ${given}`.toLowerCase();
  if (/\b(ceo|founder|chief|director|leadership|admin)\b/.test(blob)) return "Leadership";
  if (/\b(qa|quality|sdet)\b/.test(blob)) return "Engineering";
  if (/\b(engineer|engineering|backend|frontend|sre|devops|developer|software)\b/.test(blob)) return "Engineering";
  if (/\b(product|pm)\b/.test(blob)) return "Product";
  if (/\b(market|growth|content|brand)\b/.test(blob)) return "Marketing";
  if (/\b(design|ux|ui)\b/.test(blob)) return "Design";
  if (/\b(sales|account exec|ae)\b/.test(blob)) return "Sales";
  if (/\b(finance|controller|analyst|ap|ar)\b/.test(blob)) return "Finance";
  if (/\b(people|hr|ops|operations|recruit)\b/.test(blob)) return "People Ops";
  return given || "Operations";
}

export function workloadBand(loadPct: number, status: string): WorkloadBand {
  if (status === "Over Capacity" || loadPct >= 85) return "High";
  if (loadPct >= 60) return "Medium";
  if (loadPct >= 30) return "Optimal";
  return "Low";
}

function teamHealth(members: OrgPerson[]): number {
  if (!members.length) return 78;
  const avg =
    members.reduce((sum, p) => sum + Math.max(0, 100 - p.loadPct * 0.35 - p.blocked * 14), 0) /
    members.length;
  return Math.max(0, Math.min(100, Math.round(avg)));
}

function teamWorkload(members: OrgPerson[]): WorkloadBand {
  if (!members.length) return "Optimal";
  const high = members.filter((p) => p.workload === "High").length;
  const med = members.filter((p) => p.workload === "Medium").length;
  if (high / members.length >= 0.35) return "High";
  if (med / members.length >= 0.4 || high > 0) return "Medium";
  const low = members.filter((p) => p.workload === "Low").length;
  if (low / members.length >= 0.6) return "Low";
  return "Optimal";
}

export function seedDefaultTeams(userId: string): void {
  const existing = db.rawGet(`SELECT id, name FROM org_teams WHERE user_id = ?`, [userId]) as Array<{
    id: string;
    name: string;
  }>;
  const byName = new Map(existing.map((t) => [t.name, t.id]));
  for (const row of DEFAULT_TEAMS) {
    if (byName.has(row.name)) continue;
    const id = uuidv4();
    db.rawRun(
      `INSERT INTO org_teams (id, user_id, name, parent_id, sort_order) VALUES (?, ?, ?, NULL, ?)`,
      [id, userId, row.name, row.order],
    );
    byName.set(row.name, id);
  }
  for (const row of DEFAULT_TEAMS) {
    if (!row.parent) continue;
    const id = byName.get(row.name);
    const parentId = byName.get(row.parent);
    if (!id || !parentId) continue;
    db.rawRun(`UPDATE org_teams SET parent_id = ? WHERE id = ? AND user_id = ?`, [parentId, id, userId]);
  }
}

function syncLedgerDependencies(
  userId: string,
  execRows: Array<{
    task_id: string;
    status: string;
    owner: string;
    success_condition: string | null;
    type: string | null;
    dependencies: string | null;
  }>,
  ownerTeam: Map<string, string>,
): void {
  const byId = new Map(execRows.map((r) => [r.task_id, r]));
  const labelOf = (id: string) => {
    const r = byId.get(id);
    return String(r?.success_condition || r?.type || id).slice(0, 80);
  };
  const teamOf = (owner: string) => ownerTeam.get(owner) || inferTeamName("", "", owner);

  const existing = db.rawGet(
    `SELECT execution_id FROM org_dependencies WHERE user_id = ? AND source = 'ledger'`,
    [userId],
  ) as Array<{ execution_id: string | null }>;
  const have = new Set(existing.map((r) => r.execution_id).filter(Boolean));

  for (const row of execRows) {
    const deps = parseJsonArray(row.dependencies);
    if (!deps.length) continue;
    if (have.has(row.task_id)) continue;
    const upstream = byId.get(deps[0]!);
    const fromOwner = upstream?.owner || row.owner;
    const status: DepStatus =
      String(upstream?.status || row.status).toUpperCase() === "BLOCKED"
        ? "AT_RISK"
        : String(row.status).toUpperCase() === "BLOCKED"
          ? "DELAYED"
          : "ON_TRACK";
    try {
      db.rawRun(
        `INSERT INTO org_dependencies
          (id, user_id, from_team, from_work, to_team, to_work, status, source, execution_id, edge_type, evidence_json, confidence_0_1)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ledger', ?, 'waits_on', ?, 1)`,
        [
          uuidv4(),
          userId,
          teamOf(row.owner),
          labelOf(row.task_id),
          teamOf(fromOwner),
          labelOf(deps[0]!),
          status,
          row.task_id,
          JSON.stringify([row.task_id, deps[0]]),
        ],
      );
    } catch {
      db.rawRun(
        `INSERT INTO org_dependencies
          (id, user_id, from_team, from_work, to_team, to_work, status, source, execution_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ledger', ?)`,
        [
          uuidv4(),
          userId,
          teamOf(row.owner),
          labelOf(row.task_id),
          teamOf(fromOwner),
          labelOf(deps[0]!),
          status,
          row.task_id,
        ],
      );
    }
    have.add(row.task_id);
  }
}

function captureHealth(userId: string, healthPct: number): number {
  db.rawRun(
    `INSERT OR IGNORE INTO org_health_snapshots (user_id, captured_on, health_pct) VALUES (?, date('now'), ?)`,
    [userId, healthPct],
  );
  const weekAgo = db.rawGet(
    `SELECT health_pct FROM org_health_snapshots
     WHERE user_id = ? AND captured_on <= date('now', '-7 day')
     ORDER BY captured_on DESC LIMIT 1`,
    [userId],
  ) as Array<{ health_pct: number }>;
  const prev = weekAgo[0]?.health_pct;
  if (prev == null) {
    const yesterday = db.rawGet(
      `SELECT health_pct FROM org_health_snapshots
       WHERE user_id = ? AND captured_on < date('now')
       ORDER BY captured_on DESC LIMIT 1`,
      [userId],
    ) as Array<{ health_pct: number }>;
    if (yesterday[0] == null) return 0;
    return healthPct - yesterday[0].health_pct;
  }
  return healthPct - prev;
}

function buildTree(teams: OrgTeamRow[]): OrgTreeNode[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const children = new Map<string | null, OrgTeamRow[]>();
  for (const t of teams) {
    const key = t.parentId && byId.has(t.parentId) ? t.parentId : null;
    const list = children.get(key) ?? [];
    list.push(t);
    children.set(key, list);
  }
  const walk = (parentId: string | null): OrgTreeNode[] =>
    (children.get(parentId) ?? []).map((t) => {
      const kids = walk(t.id);
      const peopleCount = t.peopleCount + kids.reduce((s, k) => s + k.peopleCount, 0);
      return { id: t.id, name: t.name, peopleCount, children: kids };
    });
  return walk(null);
}

function ledgerEvents(userId: string): OrgEvent[] {
  const rows = db.rawGet(
    `SELECT e.task_id, e.status, e.owner, e.success_condition, e.last_update, e.completed_at
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ?
     ORDER BY COALESCE(e.completed_at, e.last_update) DESC
     LIMIT 16`,
    [userId],
  ) as Array<{
    task_id: string;
    status: string;
    owner: string;
    success_condition: string | null;
    last_update: string;
    completed_at: string | null;
  }>;
  return rows.map((r) => {
    const work = String(r.success_condition || r.task_id).slice(0, 72);
    const done = String(r.status).toUpperCase() === "DONE";
    return {
      id: `exec:${r.task_id}`,
      kind: done ? "completion" : "assignment",
      actor: r.owner,
      summary: done ? `${r.owner} completed ${work}` : `${r.owner} assigned to ${work}`,
      createdAt: r.completed_at || r.last_update,
    };
  });
}

export function createOrgTeam(
  userId: string,
  input: { name: string; parentId?: string | null },
): { id: string; name: string } {
  seedDefaultTeams(userId);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Team name required");
  const id = uuidv4();
  db.rawRun(
    `INSERT INTO org_teams (id, user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?, 99)`,
    [id, userId, name, input.parentId || null],
  );
  return { id, name };
}

export function createOrgDependency(
  userId: string,
  input: {
    fromTeam: string;
    fromWork?: string;
    toTeam: string;
    toWork?: string;
    status?: DepStatus;
    source?: "ledger" | "manual" | "inferred" | "pattern";
  },
): OrgDependency {
  const status: DepStatus =
    input.status === "AT_RISK" || input.status === "DELAYED" || input.status === "ON_TRACK"
      ? input.status
      : "ON_TRACK";
  const id = uuidv4();
  const source = input.source || "manual";
  try {
    db.rawRun(
      `INSERT INTO org_dependencies
        (id, user_id, from_team, from_work, to_team, to_work, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, input.fromTeam.trim(), input.fromWork || null, input.toTeam.trim(), input.toWork || null, status, source],
    );
  } catch {
    // Older DBs may only allow ledger|manual
    db.rawRun(
      `INSERT INTO org_dependencies
        (id, user_id, from_team, from_work, to_team, to_work, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`,
      [
        id,
        userId,
        input.fromTeam.trim(),
        source === "inferred" || source === "pattern"
          ? `[${source}] ${input.fromWork || ""}`.trim()
          : input.fromWork || null,
        input.toTeam.trim(),
        input.toWork || null,
        status,
      ],
    );
  }
  return {
    id,
    fromTeam: input.fromTeam.trim(),
    fromWork: input.fromWork || "",
    toTeam: input.toTeam.trim(),
    toWork: input.toWork || "",
    status,
    source: source === "inferred" || source === "pattern" ? source : source,
    executionId: null,
  };
}

export function deleteOrgDependency(userId: string, id: string): boolean {
  const r = db.rawRun(`DELETE FROM org_dependencies WHERE id = ? AND user_id = ?`, [id, userId]);
  return Boolean((r as { changes?: number })?.changes);
}

export function recordOrgEvent(
  userId: string,
  input: { kind: OrgEvent["kind"]; actor?: string; summary: string },
): void {
  db.rawRun(`INSERT INTO org_events (id, user_id, kind, actor, summary) VALUES (?, ?, ?, ?, ?)`, [
    uuidv4(),
    userId,
    input.kind,
    input.actor || null,
    input.summary,
  ]);
}

export function buildOrgIntelligence(userId: string): OrgIntelligence {
  seedDefaultTeams(userId);

  const execRows = db.rawGet(
    `SELECT e.task_id, e.status, e.owner, e.success_condition, e.type, e.blocked_reasons, e.dependencies, e.decision_id
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ?
     ORDER BY e.last_update DESC
     LIMIT 400`,
    [userId],
  ) as Array<{
    task_id: string;
    status: string;
    owner: string;
    success_condition: string | null;
    type: string | null;
    blocked_reasons: string | null;
    dependencies: string | null;
    decision_id: string;
  }>;

  const byId = new Map(execRows.map((r) => [r.task_id, r]));
  const downstream = (taskId: string) =>
    execRows.filter((r) => parseJsonArray(r.dependencies).includes(taskId)).map((r) => r.task_id);
  const criticalIds = new Set(
    execRows
      .filter((r) => String(r.status).toUpperCase() === "BLOCKED" && downstream(r.task_id).length > 0)
      .map((r) => r.owner),
  );

  const entries = buildTeamEntries(userId);
  const roster = db.listTeamRoster(userId);
  const rosterByName = new Map(roster.map((r) => [r.name.toLowerCase(), r]));

  const people: OrgPerson[] = [];
  const seenPeople = new Set<string>();
  for (const e of entries) {
    if (e.source === "workspace" && entries.length > 1) continue;
    const owner = e.id.startsWith("ledger:") ? e.id.slice(7) : e.name;
    const key = e.name.trim().toLowerCase();
    if (seenPeople.has(key)) continue;
    seenPeople.add(key);
    const mine = execRows.filter((r) => r.owner === owner || r.owner === e.name);
    const rosterHit = rosterByName.get(e.name.toLowerCase()) || rosterByName.get(owner.toLowerCase());
    const team = inferTeamName(rosterHit?.team || e.team, e.role, e.name);
    const waitingOn = mine
      .filter((r) => String(r.status).toUpperCase() === "BLOCKED")
      .flatMap((r) => parseJsonArray(r.blocked_reasons).slice(0, 1));
    const blocking = mine
      .flatMap((r) => downstream(r.task_id).map((id) => String(byId.get(id)?.success_condition || id)))
      .slice(0, 4);
    people.push({
      owner,
      name: e.name,
      role: rosterHit?.role || e.role || "Owner",
      team,
      email: e.email,
      loadPct: e.loadPct,
      status: e.status,
      workload: workloadBand(e.loadPct, e.status),
      active: mine.filter((r) => r.status === "ACTIVE").length,
      pending: mine.filter((r) => r.status === "PENDING").length,
      blocked: mine.filter((r) => r.status === "BLOCKED").length,
      waitingOn,
      blocking,
      focus: [...new Set(mine.map((r) => String(r.success_condition || r.type || "")).filter(Boolean))].slice(0, 3),
      reportsTo: rosterHit?.reports_to ?? null,
      initials: initialsOf(e.name),
      criticalPath: criticalIds.has(owner) || criticalIds.has(e.name),
    });
  }

  const ownerTeam = new Map(people.map((p) => [p.owner, p.team]));
  for (const p of people) ownerTeam.set(p.name, p.team);
  syncLedgerDependencies(userId, execRows, ownerTeam);

  const teamRows = db.rawGet(
    `SELECT id, name, parent_id, sort_order FROM org_teams WHERE user_id = ? ORDER BY sort_order, name`,
    [userId],
  ) as Array<{ id: string; name: string; parent_id: string | null; sort_order: number }>;

  const teams: OrgTeamRow[] = teamRows.map((t) => {
    const members = people.filter((p) => p.team === t.name);
    return {
      id: t.id,
      name: t.name,
      parentId: t.parent_id,
      healthPct: teamHealth(members),
      workload: teamWorkload(members),
      atRisk: members.filter((p) => p.status !== "Healthy" || p.blocked > 0).length,
      members: members.slice(0, 6).map((p) => ({ name: p.name, initials: p.initials, owner: p.owner })),
      peopleCount: members.length,
    };
  });

  const depRows = db.rawGet(
    `SELECT id, from_team, from_work, to_team, to_work, status, source, execution_id,
            edge_type, evidence_json, confidence_0_1, situation_id
     FROM org_dependencies WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 80`,
    [userId],
  ) as Array<{
    id: string;
    from_team: string;
    from_work: string | null;
    to_team: string;
    to_work: string | null;
    status: DepStatus;
    source: "ledger" | "manual" | "inferred" | "pattern";
    execution_id: string | null;
    edge_type?: string | null;
    evidence_json?: string | null;
    confidence_0_1?: number | null;
    situation_id?: string | null;
  }>;
  const dependencies: OrgDependency[] = depRows.map((d) => {
    let evidence: string[] = [];
    try {
      const raw = d.evidence_json ? JSON.parse(d.evidence_json) : [];
      evidence = Array.isArray(raw) ? raw.map(String) : [];
    } catch {
      evidence = [];
    }
    return {
      id: d.id,
      fromTeam: d.from_team,
      fromWork: d.from_work || "",
      toTeam: d.to_team,
      toWork: d.to_work || "",
      status: d.status,
      source: (d.source as OrgDependency["source"]) || "manual",
      executionId: d.execution_id,
      edgeType: d.edge_type || null,
      confidence: d.confidence_0_1 ?? null,
      evidence,
      situationId: d.situation_id || null,
    };
  });

  const peopleAtRisk = [...people]
    .filter((p) => p.status !== "Healthy" || p.blocked > 0 || p.workload === "High" || p.criticalPath)
    .sort((a, b) => b.blocked - a.blocked || b.loadPct - a.loadPct)
    .slice(0, 8);

  const workload = {
    high: people.filter((p) => p.workload === "High").length,
    medium: people.filter((p) => p.workload === "Medium").length,
    optimal: people.filter((p) => p.workload === "Optimal").length,
    low: people.filter((p) => p.workload === "Low").length,
  };

  const storedEvents = db.rawGet(
    `SELECT id, kind, actor, summary, created_at FROM org_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 12`,
    [userId],
  ) as Array<{ id: string; kind: string; actor: string | null; summary: string; created_at: string }>;
  const recentChanges: OrgEvent[] = (
    storedEvents.length
      ? storedEvents.map((e) => ({
          id: e.id,
          kind: e.kind,
          actor: e.actor,
          summary: e.summary,
          createdAt: e.created_at,
        }))
      : ledgerEvents(userId)
  ).slice(0, 8);

  const initiatives = new Set(execRows.map((r) => r.decision_id).filter(Boolean)).size;
  const healthMembers = people.length ? people : [];
  const healthPct = teamHealth(healthMembers);
  const healthDelta = captureHealth(userId, healthPct);

  const ownership = execRows
    .filter((r) => String(r.status).toUpperCase() !== "DONE" && String(r.status).toUpperCase() !== "KILLED")
    .slice(0, 40)
    .map((r) => {
      const person = people.find((p) => p.owner === r.owner || p.name === r.owner);
      return {
        owner: r.owner,
        name: person?.name || r.owner,
        team: person?.team || inferTeamName("", "", r.owner),
        work: String(r.success_condition || r.type || r.task_id),
        status: r.status,
        criticalPath: criticalIds.has(r.owner),
      };
    });

  return {
    snapshot: {
      people: people.length,
      teams: teams.filter((t) => t.peopleCount > 0).length || teams.length,
      initiatives,
      healthPct,
      healthDelta,
      overloaded: workload.high,
      depsAtRisk: dependencies.filter((d) => d.status !== "ON_TRACK").length,
    },
    teams,
    tree: buildTree(teams),
    peopleAtRisk,
    people,
    dependencies,
    workload,
    recentChanges,
    ownership,
  };
}
