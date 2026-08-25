import { db } from "../database.js";
import { resolveTenantContext, tenantSqlScope } from "../security/tenant-context.js";
import { sqliteDatetimeToIso } from "../utils/sqlite-datetime.js";
import { formatOutcomes, formatStringList, outcomeHeadline } from "./ledger-text.js";
import { jiraCloudUrlForUser, resolveSignalOpenTargets, type SignalOpenTarget } from "./signal-open.js";
import { layoutRing, type BrainGraphEdge, type BrainGraphNode } from "./summary.js";

export type DecisionDetailView = {
  id: string;
  slug: string;
  title: string;
  type: string;
  subtitle: string;
  description: string;
  descriptionFull: string;
  narrative: {
    reasoning: string;
    outcomes: Array<{ metric: string; target: string }>;
    constraints: string[];
    reversal: string[];
  };
  graph: { nodes: BrainGraphNode[]; edges: BrainGraphEdge[] };
  owner: { name: string; initials: string };
  team: string;
  priority: string;
  status: string;
  health: number;
  lastUpdated: string;
  progress: number;
  progressLabel: string;
  targetDate: string;
  impact: string;
  impactLabel: string;
  impactConfidence: number;
  impactTone: string;
  daysToTarget: number;
  daysRisk: string;
  budgetUsed: number;
  budgetTotal: number;
  budgetPct: number;
  budgetStatus: string;
  healthTrend: string;
  tabs: Array<{ label: string; count?: number }>;
  phases: Array<{ name: string; start: number; end: number; progress: number }>;
  timelineMonths: string[];
  todayIndex: number;
  meetings: Array<{ title: string; when: string; avatars: string[] }>;
  activity: Array<{ text: string; who: string; when: string; tone?: string }>;
  radar: Array<{ label: string; value: number }>;
  risks: Array<{ title: string; meta: string; priority: string }>;
  stakeholders: Array<{ name: string; role: string; initials: string }>;
  executions: Array<{
    task_id: string;
    status: string;
    owner: string;
    type: string;
    weight: number;
    success_condition: string | null;
    blocked_reasons: string | null;
    last_update: string | null;
  }>;
  signals: Array<{
    id: string;
    source: string;
    content: string;
    state: string;
    detected_at: string | null;
    source_subtype: string | null;
    external_id: string | null;
    owner: string | null;
    openTargets: SignalOpenTarget[];
  }>;
};

type DecisionRow = {
  id: string;
  user_id: string;
  vow: string;
  status: string;
  confidence: number | null;
  expected_outcomes: string | null;
  decision_reasoning: string | null;
  constraints: string | null;
  reversal_conditions: string | null;
  created_at: string;
  last_update: string;
};

type ExecRow = {
  task_id: string;
  status: string;
  owner: string;
  type: string;
  weight: number | null;
  success_condition: string | null;
  blocked_reasons: string | null;
  last_update: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export function slugifyVow(vow: string): string {
  return String(vow || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function confPct(c: number | null | undefined): number {
  if (c == null || Number.isNaN(Number(c))) return 0;
  const n = Number(c);
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function parseWhen(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const raw = iso.includes("T") ? iso : iso.replace(" ", "T");
  const t = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

function rel(iso: string | null | undefined): string {
  const t = parseWhen(iso);
  if (!t) return iso || "—";
  const m = Math.round((Date.now() - t.getTime()) / 60000);
  if (Math.abs(m) < 1) return "just now";
  if (Math.abs(m) < 60) return `${Math.abs(m)}m ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return `${Math.abs(h)}h ago`;
  return `${Math.abs(Math.round(h / 24))}d ago`;
}

function ageDays(iso: string | null | undefined): number {
  const t = parseWhen(iso);
  if (!t) return 0;
  return Math.max(0, Math.round((Date.now() - t.getTime()) / 86400000));
}

export function healthFromExec(counts: { total: number; done: number; active: number; pending: number; blocked: number }, confidence: number): number {
  if (!counts.total) return Math.max(0, Math.min(100, confidence));
  const blockedPct = (counts.blocked / counts.total) * 100;
  const pendingPct = (counts.pending / counts.total) * 100;
  return Math.max(0, Math.min(100, Math.round(100 - blockedPct * 0.7 - pendingPct * 0.25)));
}

export function progressFromExec(counts: { total: number; done: number }): number {
  if (!counts.total) return 0;
  return Math.round((counts.done / counts.total) * 100);
}

function findDecision(userId: string, idOrSlug: string): DecisionRow | null {
  const key = String(idOrSlug || "").trim();
  if (!key) return null;
  const ctx = resolveTenantContext(userId);
  const scope = tenantSqlScope(ctx);

  const byId = db.rawGet(
    `SELECT id, user_id, vow, status, confidence, expected_outcomes, decision_reasoning,
            constraints, reversal_conditions, created_at, last_update
     FROM decision_ledger WHERE id = ?${scope.sql} LIMIT 1`,
    [key, ...scope.params],
  )[0] as DecisionRow | undefined;
  if (byId) return byId;

  const rows = db.rawGet(
    `SELECT id, user_id, vow, status, confidence, expected_outcomes, decision_reasoning,
            constraints, reversal_conditions, created_at, last_update
     FROM decision_ledger WHERE 1=1${scope.sql} ORDER BY created_at DESC LIMIT 200`,
    scope.params,
  ) as DecisionRow[];
  return rows.find((r) => slugifyVow(r.vow) === key.toLowerCase()) ?? null;
}

export function buildDecisionDetail(userId: string, idOrSlug: string): DecisionDetailView | null {
  const d = findDecision(userId, idOrSlug);
  if (!d) return null;

  const ownerName = db.getAccountDisplayName(d.user_id || userId);
  const ownerInitials = initials(ownerName);
  const confidence = confPct(d.confidence);
  const created = sqliteDatetimeToIso(d.created_at) || d.created_at;
  const updated = sqliteDatetimeToIso(d.last_update) || d.last_update || created;

  const executions = db.rawGet(
    `SELECT task_id, status, owner, type, weight, success_condition, blocked_reasons,
            last_update, started_at, completed_at
     FROM execution_ledger WHERE decision_id = ?
     ORDER BY last_update DESC`,
    [d.id],
  ) as ExecRow[];

  const counts = { total: executions.length, done: 0, active: 0, pending: 0, blocked: 0, killed: 0 };
  let weightAll = 0;
  let weightUsed = 0;
  for (const e of executions) {
    const w = Number(e.weight || 0);
    weightAll += w;
    const st = (e.status || "").toUpperCase();
    if (st === "DONE") {
      counts.done++;
      weightUsed += w;
    } else if (st === "ACTIVE") {
      counts.active++;
      weightUsed += w;
    } else if (st === "PENDING") counts.pending++;
    else if (st === "BLOCKED") counts.blocked++;
    else if (st === "KILLED") counts.killed++;
  }

  const taskIds = executions.map((e) => e.task_id);
  const signalParams: unknown[] = [d.id];
  let signalSql = `SELECT id, source, source_subtype, external_id, owner, content, state, detected_at, ingest_meta
     FROM external_signals
     WHERE related_decision_id = ?`;
  if (taskIds.length) {
    signalSql += ` OR linked_execution_id IN (${taskIds.map(() => "?").join(",")})`;
    signalParams.push(...taskIds);
  }
  signalSql += ` ORDER BY detected_at DESC LIMIT 40`;
  const signalRows = db.rawGet(signalSql, signalParams) as Array<{
    id: string;
    source: string;
    source_subtype: string | null;
    external_id: string | null;
    owner: string | null;
    content: string;
    state: string;
    detected_at: string | null;
    ingest_meta: string | null;
  }>;
  const jiraCloud = jiraCloudUrlForUser(d.user_id || userId);
  const signals = signalRows.map((s) => ({
    id: s.id,
    source: s.source,
    content: s.content,
    state: s.state,
    detected_at: sqliteDatetimeToIso(s.detected_at) || s.detected_at,
    source_subtype: s.source_subtype,
    external_id: s.external_id,
    owner: s.owner,
    openTargets: resolveSignalOpenTargets(s, { jiraCloudUrl: jiraCloud }),
  }));

  const health = healthFromExec(counts, confidence);
  const progress = progressFromExec(counts);
  const statusLabel = d.status.replace(/_/g, " ");
  const reasoning = (d.decision_reasoning || "").trim();
  const outcomeRows = formatOutcomes(d.expected_outcomes);
  const constraintRows = formatStringList(d.constraints);
  const reversalRows = formatStringList(d.reversal_conditions);
  const description =
    reasoning ||
    outcomeHeadline(outcomeRows, "") ||
    constraintRows[0] ||
    `Decision “${d.vow}” is ${statusLabel} on the ledger.`;
  const descriptionFull = [
    reasoning,
    ...outcomeRows.map((o) => (o.target ? `${o.metric} — ${o.target}` : o.metric)),
    ...constraintRows,
    ...reversalRows,
  ]
    .filter(Boolean)
    .join("\n");

  const ownerSet = new Map<string, string>();
  ownerSet.set(ownerName, "Owner");
  for (const e of executions) {
    const n = (e.owner || "").trim() || "system";
    if (!ownerSet.has(n)) ownerSet.set(n, e.type || "Contributor");
  }

  const risks: DecisionDetailView["risks"] = [];
  for (const e of executions.filter((x) => x.status === "BLOCKED")) {
    let note = e.success_condition || e.task_id;
    try {
      const parsed = e.blocked_reasons ? JSON.parse(e.blocked_reasons) : [];
      if (Array.isArray(parsed) && parsed.length) note = parsed.map(String).join(", ");
    } catch {
      /* keep */
    }
    risks.push({
      title: (e.success_condition || e.task_id).slice(0, 80),
      meta: String(note).slice(0, 120),
      priority: "High",
    });
  }
  for (const s of signals.filter((x) => x.state === "UNVERIFIED" || x.state === "GRACE").slice(0, 4)) {
    risks.push({
      title: (s.content || s.source).slice(0, 80),
      meta: `${s.source} · ${s.state}`,
      priority: "Medium",
    });
  }

  const activity: DecisionDetailView["activity"] = [
    {
      text: `Decision created — ${d.vow}`,
      who: ownerName,
      when: rel(created),
      tone: "decision",
    },
    ...executions.slice(0, 8).map((e) => ({
      text: `${e.status} · ${e.success_condition || e.type || e.task_id}`,
      who: e.owner || "system",
      when: rel(sqliteDatetimeToIso(e.last_update) || e.last_update),
      tone: e.status === "BLOCKED" ? "signal" : "task",
    })),
    ...signals.slice(0, 4).map((s) => ({
      text: `${s.source}: ${(s.content || "").slice(0, 80)}`,
      who: "Signal",
      when: rel(sqliteDatetimeToIso(s.detected_at) || s.detected_at),
      tone: "signal",
    })),
  ];

  const phases =
    executions.length > 0
      ? executions.slice(0, 8).map((e, i) => ({
          name: (e.success_condition || e.type || e.task_id).slice(0, 32),
          start: i,
          end: i + 1,
          progress: e.status === "DONE" ? 100 : e.status === "ACTIVE" ? 60 : e.status === "BLOCKED" ? 15 : 30,
        }))
      : [
          {
            name: statusLabel,
            start: 0,
            end: 1,
            progress: d.status === "COMPLETED" ? 100 : d.status === "ACTIVE" ? 60 : d.status === "UNDER_REVIEW" ? 40 : 20,
          },
        ];

  const timelineMonths =
    executions.length > 0 ? ["Start", ...executions.slice(0, 6).map((_, i) => `T${i + 1}`), "Now"] : ["Created", "Now"];
  const todayIndex = Math.max(0, timelineMonths.length - 1);

  const blockedPct = counts.total ? Math.round((counts.blocked / counts.total) * 100) : 0;
  const weightPct = weightAll > 0 ? Math.round((weightUsed / weightAll) * 100) : 0;

  const graphNodes: BrainGraphNode[] = [];
  const graphEdges: BrainGraphEdge[] = [];
  const centerId = `d:${d.id}`;
  graphNodes.push({
    id: centerId,
    kind: "decision",
    tone: d.status === "ACTIVE" ? "gold" : "purple",
    title: d.vow.slice(0, 48),
    subtitle: statusLabel,
    x: 50,
    y: 50,
    center: true,
    pill: { label: statusLabel, tone: d.status === "ACTIVE" ? "pending" : "info" },
    risky: d.status === "DRAFT" || d.status === "UNDER_REVIEW",
    why: reasoning || outcomeHeadline(outcomeRows, "On the decision ledger."),
    confidence: `${confidence}%`,
  });
  const sats: Array<{ kind: "execution" | "signal"; i: number }> = [
    ...executions.slice(0, 6).map((_, i) => ({ kind: "execution" as const, i })),
    ...signals.slice(0, 6).map((_, i) => ({ kind: "signal" as const, i })),
  ];
  const ring = layoutRing(sats.length, 50, 50, 34);
  sats.forEach((sat, idx) => {
    const pos = ring[idx] || { x: 50, y: 20 };
    if (sat.kind === "execution") {
      const e = executions[sat.i];
      const id = `e:${e.task_id}`;
      const blocked = e.status === "BLOCKED";
      graphNodes.push({
        id,
        kind: "execution",
        tone: blocked ? "red" : "blue",
        title: (e.success_condition || e.type || e.task_id).slice(0, 40),
        subtitle: `${e.status} · ${e.owner}`,
        x: pos.x,
        y: pos.y,
        risky: blocked,
        pill: { label: e.status, tone: blocked ? "critical" : "info" },
        why: `Execution ${e.status.toLowerCase()} on this decision`,
      });
      graphEdges.push({ from: id, to: centerId, kind: blocked ? "blocks" : "requires", label: blocked ? "blocks" : "requires" });
      return;
    }
    const s = signals[sat.i];
    const id = `s:${s.id}`;
    const open = s.openTargets[0];
    graphNodes.push({
      id,
      kind: "signal",
      tone: "green",
      title: (s.content || s.source).slice(0, 40),
      subtitle: s.source,
      x: pos.x,
      y: pos.y,
      risky: s.state === "UNVERIFIED" || s.state === "GRACE",
      pill: { label: s.state, tone: s.state === "UNVERIFIED" ? "medium" : "info" },
      why: s.content.slice(0, 180),
      href: open?.url,
      openLabel: open?.label,
    });
    graphEdges.push({ from: id, to: centerId, kind: "influences", label: "influences" });
  });

  return {
    id: d.id,
    slug: slugifyVow(d.vow) || d.id,
    title: d.vow,
    type: "Decision",
    subtitle: `${statusLabel} · created ${rel(created)}`,
    description,
    descriptionFull,
    narrative: {
      reasoning,
      outcomes: outcomeRows,
      constraints: constraintRows,
      reversal: reversalRows,
    },
    graph: { nodes: graphNodes, edges: graphEdges },
    owner: { name: ownerName, initials: ownerInitials },
    team: ownerName,
    priority: confidence >= 80 ? "High" : confidence >= 50 ? "Medium" : "Low",
    status: statusLabel,
    health,
    lastUpdated: rel(updated),
    progress,
    progressLabel: counts.blocked ? "Blocked work on ledger" : counts.total ? `${counts.done}/${counts.total} done` : "No executions yet",
    targetDate: rel(created),
    impact: outcomeHeadline(outcomeRows, `${confidence}%`),
    impactLabel: outcomeRows.length ? "Expected outcomes" : "Ledger confidence",
    impactConfidence: confidence,
    impactTone: counts.blocked ? "At risk" : d.status === "ACTIVE" ? "Active" : statusLabel,
    daysToTarget: ageDays(created),
    daysRisk: counts.blocked ? `${counts.blocked} blocked` : d.status === "DRAFT" ? "Awaiting commit" : "On ledger",
    budgetUsed: Math.round(weightUsed * 10) / 10,
    budgetTotal: Math.round(weightAll * 10) / 10,
    budgetPct: weightPct,
    budgetStatus: counts.blocked ? "Blocked" : weightAll ? "On ledger" : "No weight",
    healthTrend: counts.blocked ? `${blockedPct}% blocked` : `${confidence}% confidence`,
    tabs: [
      { label: "Overview" },
      { label: "Tasks", count: executions.length },
      { label: "Signals", count: signals.length },
      { label: "Activity", count: activity.length },
    ],
    phases,
    timelineMonths,
    todayIndex,
    meetings: [],
    activity,
    radar: [
      { label: "Confidence", value: confidence },
      { label: "Progress", value: progress },
      { label: "Execution", value: counts.total ? Math.round(((counts.done + counts.active) / counts.total) * 100) : 0 },
      { label: "Stability", value: Math.max(0, 100 - blockedPct) },
      { label: "Weight", value: weightPct },
    ],
    risks,
    stakeholders: [...ownerSet.entries()].slice(0, 8).map(([name, role]) => ({
      name,
      role,
      initials: initials(name),
    })),
    executions: executions.map((e) => ({
      task_id: e.task_id,
      status: e.status,
      owner: e.owner || "system",
      type: e.type,
      weight: Number(e.weight || 0),
      success_condition: e.success_condition,
      blocked_reasons: e.blocked_reasons,
      last_update: sqliteDatetimeToIso(e.last_update) || e.last_update,
    })),
    signals,
  };
}
