/**
 * Decision & execution console — ledger-native situation + proposed actions.
 * Does not create Jira/calendar. Approve runs existing mutations only.
 */
import { db } from "../database.js";
import { resolveTenantContext, tenantSqlScope } from "../security/tenant-context.js";
import { jiraCloudUrlForUser, resolveSignalOpenTargets } from "../brain/signal-open.js";
import { buildExecutionPlan, type ExecutionPlan } from "./execution-plan.js";
import { buildTeamEntries } from "../teams/teamsMembers.js";

export type ProposedActionType = "start_task" | "commit_decision" | "open_clarification";

export type ProposedAction = {
  id: string;
  type: ProposedActionType;
  label: string;
  owner: string;
  gate: "ready" | "waiting";
  detail: string;
  decisionId?: string;
  taskId?: string;
  href?: string;
};

export type ConsoleEvidence = {
  source: string;
  label: string;
  content: string;
  when: string | null;
  url: string | null;
};

export type ConsoleRisk = {
  taskId: string;
  label: string;
  owner: string;
  status: string;
  blockedReasons: string[];
  evidence: ConsoleEvidence[];
  blocking: string[];
};

export type ConsolePerson = {
  owner: string;
  name: string;
  team: string;
  role: string;
  loadPct: number;
  status: string;
  active: number;
  pending: number;
  blocked: number;
  waitingOn: string[];
  blocking: string[];
  focus: string[];
};

export type ConsoleEdge = { from: string; to: string };

export type ConsoleGraphNode = {
  id: string;
  label: string;
  owner: string;
  status: string;
};

export type OrgConsole = {
  focus: {
    decisionId: string;
    vow: string;
    status: string;
    confidence: number | null;
  } | null;
  plan: ExecutionPlan | null;
  risks: ConsoleRisk[];
  people: ConsolePerson[];
  teams: Array<{ name: string; healthPct: number; members: number; blocked: number }>;
  nodes: ConsoleGraphNode[];
  edges: ConsoleEdge[];
  proposed: ProposedAction[];
  counts: { people: number; teams: number; initiatives: number };
  policyNote: string;
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

export function proposeFromSituation(input: {
  drafts: Array<{ id: string; vow: string }>;
  plan: ExecutionPlan | null;
}): ProposedAction[] {
  const out: ProposedAction[] = [];
  for (const d of input.drafts) {
    out.push({
      id: `commit:${d.id}`,
      type: "commit_decision",
      label: `Commit “${d.vow.slice(0, 72)}”`,
      owner: "You",
      gate: "ready",
      detail: "Activates the vow. Does not start tasks.",
      decisionId: d.id,
    });
  }
  const plan = input.plan;
  if (!plan) return out;
  for (const a of plan.actions) {
    if (a.kind === "ready") {
      out.push({
        id: `start:${a.taskId}`,
        type: "start_task",
        label: a.label,
        owner: a.owner,
        gate: "ready",
        detail: "PENDING → ACTIVE (capacity + dependencies still gate).",
        taskId: a.taskId,
        decisionId: plan.decisionId,
      });
    } else if (a.kind === "blocked" || a.kind === "needs_clarification") {
      out.push({
        id: `clarify:${a.taskId}`,
        type: "open_clarification",
        label: a.label,
        owner: a.owner,
        gate: "waiting",
        detail: a.blockedReasons[0] || a.clarification?.trigger || "Needs an owner answer before work can move.",
        taskId: a.taskId,
        decisionId: plan.decisionId,
        href: `/execute?decision=${encodeURIComponent(plan.decisionId)}`,
      });
    }
  }
  return out;
}

export function buildOrgConsole(userId: string, decisionId?: string | null): OrgConsole {
  const ctx = resolveTenantContext(userId);
  const scope = tenantSqlScope(ctx);

  const decisions = db.rawGet(
    `SELECT id, vow, status, confidence FROM decision_ledger
     WHERE 1=1${scope.sql}
     ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END,
              last_update DESC
     LIMIT 40`,
    scope.params,
  ) as { id: string; vow: string; status: string; confidence: number | null }[];

  const wanted = String(decisionId || "").trim();
  const focusRow =
    (wanted && decisions.find((d) => d.id === wanted)) ||
    decisions.find((d) => d.status === "ACTIVE") ||
    decisions[0] ||
    null;

  const plan = focusRow ? buildExecutionPlan(userId, focusRow.id) : null;
  const drafts = decisions.filter((d) => d.status === "DRAFT").slice(0, 3).map((d) => ({ id: d.id, vow: d.vow }));
  const proposed = proposeFromSituation({ drafts, plan });

  const execRows = db.rawGet(
    `SELECT e.task_id, e.status, e.owner, e.success_condition, e.type, e.blocked_reasons, e.dependencies, e.decision_id, d.vow
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON e.decision_id = d.id
     WHERE 1=1${scope.sql}
     ORDER BY e.last_update DESC
     LIMIT 200`,
    scope.params,
  ) as Array<{
    task_id: string;
    status: string;
    owner: string;
    success_condition: string | null;
    type: string | null;
    blocked_reasons: string | null;
    dependencies: string | null;
    decision_id: string;
    vow: string;
  }>;

  const byId = new Map(execRows.map((r) => [r.task_id, r]));
  const labelOf = (id: string) => {
    const r = byId.get(id);
    return String(r?.success_condition || r?.type || id).slice(0, 80);
  };

  const edges: ConsoleEdge[] = [];
  for (const r of execRows) {
    for (const dep of parseJsonArray(r.dependencies)) {
      edges.push({ from: dep, to: r.task_id });
    }
  }

  const downstream = (taskId: string) =>
    edges.filter((e) => e.from === taskId).map((e) => labelOf(e.to));

  const blocked = execRows.filter((r) => String(r.status).toUpperCase() === "BLOCKED").slice(0, 8);
  const taskIds = blocked.map((r) => r.task_id);
  const signalParams: unknown[] = [...scope.params];
  let signalSql = `SELECT source, source_subtype, external_id, content, detected_at, ingest_meta, linked_execution_id
     FROM external_signals WHERE 1=1${scope.sql}`;
  if (taskIds.length) {
    signalSql += ` AND linked_execution_id IN (${taskIds.map(() => "?").join(",")})`;
    signalParams.push(...taskIds);
  } else {
    signalSql += ` AND 0`;
  }
  signalSql += ` ORDER BY detected_at DESC LIMIT 40`;
  const sigRows = db.rawGet(signalSql, signalParams) as Array<{
    source: string;
    source_subtype: string | null;
    external_id: string | null;
    content: string | null;
    detected_at: string | null;
    ingest_meta: string | null;
    linked_execution_id: string | null;
  }>;
  const jiraCloud = jiraCloudUrlForUser(userId);
  const evidenceByTask = new Map<string, ConsoleEvidence[]>();
  for (const s of sigRows) {
    const tid = s.linked_execution_id;
    if (!tid) continue;
    const targets = resolveSignalOpenTargets(s, { jiraCloudUrl: jiraCloud });
    const item: ConsoleEvidence = {
      source: s.source,
      label: String(s.external_id || s.source),
      content: String(s.content || "").slice(0, 160),
      when: s.detected_at,
      url: targets[0]?.url ?? null,
    };
    const list = evidenceByTask.get(tid) ?? [];
    list.push(item);
    evidenceByTask.set(tid, list);
  }

  const risks: ConsoleRisk[] = blocked.map((r) => ({
    taskId: r.task_id,
    label: labelOf(r.task_id),
    owner: r.owner || "system",
    status: r.status,
    blockedReasons: parseJsonArray(r.blocked_reasons),
    evidence: evidenceByTask.get(r.task_id) ?? [],
    blocking: downstream(r.task_id),
  }));

  const entries = buildTeamEntries(userId);
  const people: ConsolePerson[] = entries.map((e) => {
    const owner = e.id.startsWith("ledger:") ? e.id.slice(7) : e.name;
    const mine = execRows.filter((r) => r.owner === owner || r.owner === e.name);
    const waitingOn = mine
      .filter((r) => String(r.status).toUpperCase() === "BLOCKED")
      .flatMap((r) => parseJsonArray(r.blocked_reasons).slice(0, 1));
    const blocking = mine.flatMap((r) => downstream(r.task_id)).slice(0, 4);
    const focus = [...new Set(mine.map((r) => r.vow).filter(Boolean))].slice(0, 3);
    return {
      owner,
      name: e.name,
      team: e.team || "Unassigned",
      role: e.role || "Owner",
      loadPct: e.loadPct,
      status: e.status,
      active: mine.filter((r) => r.status === "ACTIVE").length,
      pending: mine.filter((r) => r.status === "PENDING").length,
      blocked: mine.filter((r) => r.status === "BLOCKED").length,
      waitingOn,
      blocking,
      focus,
    };
  });

  const teamMap = new Map<string, { health: number[]; blocked: number; members: number }>();
  for (const p of people) {
    const t = p.team || "Unassigned";
    const row = teamMap.get(t) ?? { health: [], blocked: 0, members: 0 };
    row.health.push(Math.max(0, 100 - p.loadPct * 0.4 - p.blocked * 18));
    row.blocked += p.blocked;
    row.members += 1;
    teamMap.set(t, row);
  }
  const teams = [...teamMap.entries()].map(([name, t]) => ({
    name,
    members: t.members,
    blocked: t.blocked,
    healthPct: t.health.length
      ? Math.round(t.health.reduce((a, b) => a + b, 0) / t.health.length)
      : 0,
  }));

  const initiatives = new Set(execRows.map((r) => r.decision_id).filter(Boolean));
  const focusId = focusRow?.id;
  const graphRows = focusId
    ? execRows.filter((r) => r.decision_id === focusId).slice(0, 24)
    : execRows.slice(0, 24);
  const graphIds = new Set(graphRows.map((r) => r.task_id));
  const nodes: ConsoleGraphNode[] = graphRows.map((r) => ({
    id: r.task_id,
    label: labelOf(r.task_id),
    owner: r.owner || "unassigned",
    status: r.status,
  }));

  return {
    focus: focusRow
      ? {
          decisionId: focusRow.id,
          vow: focusRow.vow,
          status: focusRow.status,
          confidence: focusRow.confidence,
        }
      : null,
    plan,
    risks,
    people,
    teams,
    nodes,
    edges: edges.filter((e) => graphIds.has(e.from) || graphIds.has(e.to)).slice(0, 40),
    proposed,
    counts: {
      people: people.length,
      teams: teams.length,
      initiatives: initiatives.size || decisions.filter((d) => d.status === "ACTIVE").length,
    },
    policyNote:
      "Jira tickets, calendar events, and owner assignment stay policy-gated. Approve starts ledger work only.",
  };
}
