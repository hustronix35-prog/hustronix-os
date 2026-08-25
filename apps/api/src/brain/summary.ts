import { db } from "../database.js";
import { resolveTenantContext, tenantSqlScope } from "../security/tenant-context.js";
import { memoryTenantInClause, memoryTenantParams } from "../security/tenant-scope.js";
import { formatOutcomes, outcomeHeadline } from "./ledger-text.js";

export type BrainSource = { name: string; connected: boolean };

export type BrainGraphNode = {
  id: string;
  kind: "goal" | "initiative" | "decision" | "execution" | "signal" | "metric" | "customer";
  tone: "gold" | "red" | "orange" | "purple" | "blue" | "green";
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  pill?: { label: string; tone: string };
  risky?: boolean;
  center?: boolean;
  why?: string;
  confidence?: string;
  href?: string;
  openLabel?: string;
};

export type BrainGraphEdge = {
  from: string;
  to: string;
  kind: "requires" | "blocks" | "influences" | "related";
  label?: string;
};

export type BrainRecommendation = {
  id: string | null;
  title: string;
  explanation: string;
  status: string;
  confidence: number | null;
  impact: string;
};

export type BrainSummary = {
  counts: {
    people: number;
    projects: number;
    customers: number;
    decisions: number;
    meetings: number;
    documents: number;
    signals: number;
    integrations: number;
  };
  sources: BrainSource[];
  graph: { nodes: BrainGraphNode[]; edges: BrainGraphEdge[] };
  recommendations: BrainRecommendation[];
  meetings: Array<{ id: string; title: string; occurred_at: string | null; attendees: string }>;
};

type DecisionRow = {
  id: string;
  vow: string;
  status: string;
  confidence: number | null;
  expected_outcomes: string | null;
  decision_reasoning: string | null;
};

function countSql(sql: string, params: unknown[]): number {
  const row = db.rawGet(sql, params)[0] as { c?: number } | undefined;
  return Number(row?.c || 0);
}

function confPct(c: number | null | undefined): number | null {
  if (c == null || Number.isNaN(Number(c))) return null;
  const n = Number(c);
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

/** Place `count` points on a ring. Isolated so layout can be checked without SQLite. */
export function layoutRing(count: number, cx = 50, cy = 50, radius = 34): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  if (count === 1) return [{ x: cx, y: cy }];
  return Array.from({ length: count }, (_, i) => {
    const a = (Math.PI * 2 * i) / count - Math.PI / 2;
    return {
      x: Math.round((cx + radius * Math.cos(a)) * 10) / 10,
      y: Math.round((cy + radius * Math.sin(a)) * 10) / 10,
    };
  });
}

export function recsFromDecisions(rows: DecisionRow[]): BrainRecommendation[] {
  const open = rows.filter((d) => d.status === "DRAFT" || d.status === "UNDER_REVIEW");
  const pick = open.length ? open : rows.filter((d) => d.status === "ACTIVE");
  return pick.slice(0, 8).map((d) => ({
    id: d.id,
    title: d.vow,
    explanation: String(
      d.decision_reasoning ||
        d.expected_outcomes ||
        `Status ${d.status.replace(/_/g, " ")} on the decision ledger.`,
    ).slice(0, 240),
    status: d.status.replace(/_/g, " "),
    confidence: confPct(d.confidence),
    impact: d.status === "ACTIVE" ? "Active" : "Commit",
  }));
}

export function buildBrainSummary(userId: string, sources: BrainSource[]): BrainSummary {
  const ctx = resolveTenantContext(userId);
  const scope = tenantSqlScope(ctx);
  const ledgerSql = scope.sql.replace(/\borg_id\b/g, "d.org_id").replace(/\buser_id\b/g, "d.user_id");
  const [orgId, uid] = memoryTenantParams(ctx);

  const entityCounts = db.rawGet(
    `SELECT type, COUNT(*) AS c FROM entities WHERE ${memoryTenantInClause()} GROUP BY type`,
    [orgId, uid],
  ) as { type: string; c: number }[];
  const byType: Record<string, number> = {};
  for (const r of entityCounts) byType[r.type] = Number(r.c || 0);

  const rosterN = countSql(`SELECT COUNT(*) AS c FROM team_roster WHERE user_id = ?`, [userId]);
  const people = Math.max(byType.person || 0, rosterN);
  const decisionsN = countSql(`SELECT COUNT(*) AS c FROM decision_ledger WHERE 1=1${scope.sql}`, scope.params);
  const meetingsN = Math.max(
    byType.meeting || 0,
    countSql(`SELECT COUNT(*) AS c FROM meeting_ingestions WHERE user_id = ?`, [userId]),
  );
  const signalsN = countSql(`SELECT COUNT(*) AS c FROM external_signals WHERE 1=1${scope.sql}`, scope.params);

  const decisions = db.rawGet(
    `SELECT id, vow, status, confidence, expected_outcomes, decision_reasoning
     FROM decision_ledger WHERE 1=1${scope.sql}
     ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END,
              created_at DESC
     LIMIT 12`,
    scope.params,
  ) as DecisionRow[];

  const executions = db.rawGet(
    `SELECT e.task_id, e.status, e.owner, e.success_condition, e.decision_id, d.vow AS decision_vow
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON e.decision_id = d.id
     WHERE 1=1${ledgerSql} AND e.status IN ('ACTIVE','PENDING','BLOCKED')
     ORDER BY e.last_update DESC LIMIT 8`,
    scope.params,
  ) as Array<{
    task_id: string;
    status: string;
    owner: string;
    success_condition: string | null;
    decision_id: string;
    decision_vow: string;
  }>;

  const signals = db.rawGet(
    `SELECT id, source, content, state FROM external_signals
     WHERE state IN ('UNVERIFIED','GRACE')${scope.sql}
     ORDER BY detected_at DESC LIMIT 5`,
    scope.params,
  ) as Array<{ id: string; source: string; content: string; state: string }>;

  const meetings = db.rawGet(
    `SELECT id, title, occurred_at, attendees FROM meeting_ingestions
     WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 50`,
    [userId],
  ) as Array<{ id: string; title: string | null; occurred_at: string | null; attendees: string | null }>;

  const nodes: BrainGraphNode[] = [];
  const edges: BrainGraphEdge[] = [];
  const center = decisions.find((d) => d.status === "ACTIVE") || decisions[0];
  const satelliteDecisions = decisions.filter((d) => d.id !== center?.id).slice(0, 5);
  type Sat =
    | { kind: "decision"; d: DecisionRow }
    | { kind: "execution"; e: (typeof executions)[number] }
    | { kind: "signal"; s: (typeof signals)[number] };
  const satellites: Sat[] = [
    ...satelliteDecisions.map((d) => ({ kind: "decision" as const, d })),
    ...executions.slice(0, 4).map((e) => ({ kind: "execution" as const, e })),
    ...signals.slice(0, 4).map((s) => ({ kind: "signal" as const, s })),
  ];
  const ring = layoutRing(satellites.length, 50, 50, 34);

  if (center) {
    const conf = confPct(center.confidence);
    nodes.push({
      id: `d:${center.id}`,
      kind: "decision",
      tone: center.status === "ACTIVE" ? "gold" : "purple",
      title: center.vow.slice(0, 48),
      subtitle: center.status.replace(/_/g, " "),
      x: 50,
      y: 50,
      center: true,
      pill: { label: center.status.replace(/_/g, " "), tone: center.status === "ACTIVE" ? "pending" : "info" },
      risky: center.status === "DRAFT" || center.status === "UNDER_REVIEW",
      why: String(
        center.decision_reasoning ||
          outcomeHeadline(formatOutcomes(center.expected_outcomes), "On the decision ledger."),
      ).slice(0, 180),
      confidence: conf != null ? `${conf}%` : undefined,
    });
  }

  satellites.forEach((item, i) => {
    const pos = ring[i] || { x: 50, y: 20 };
    if (item.kind === "decision") {
      const d = item.d;
      const id = `d:${d.id}`;
      nodes.push({
        id,
        kind: "decision",
        tone: "purple",
        title: d.vow.slice(0, 40),
        subtitle: d.status.replace(/_/g, " "),
        x: pos.x,
        y: pos.y,
        pill: { label: d.status.replace(/_/g, " "), tone: "info" },
        why: String(d.decision_reasoning || "Decision on the ledger.").slice(0, 160),
      });
      if (center) edges.push({ from: id, to: `d:${center.id}`, kind: "related", label: "related" });
      return;
    }
    if (item.kind === "execution") {
      const e = item.e;
      const id = `e:${e.task_id}`;
      const blocked = e.status === "BLOCKED";
      const toId = `d:${e.decision_id}`;
      nodes.push({
        id,
        kind: "execution",
        tone: blocked ? "red" : "blue",
        title: (e.success_condition || e.decision_vow || e.task_id).slice(0, 40),
        subtitle: `${e.status} · ${e.owner}`,
        x: pos.x,
        y: pos.y,
        risky: blocked,
        pill: { label: e.status, tone: blocked ? "critical" : "info" },
        why: `Execution ${e.status.toLowerCase()} for ${e.decision_vow || e.decision_id}`,
      });
      const to = nodes.some((n) => n.id === toId) ? toId : center ? `d:${center.id}` : null;
      if (to) edges.push({ from: id, to, kind: blocked ? "blocks" : "requires", label: blocked ? "blocks" : "requires" });
      return;
    }
    const s = item.s;
    const id = `s:${s.id}`;
    nodes.push({
      id,
      kind: "signal",
      tone: "green",
      title: (s.content || s.source).slice(0, 40),
      subtitle: `${s.source} · ${s.state}`,
      x: pos.x,
      y: pos.y,
      risky: true,
      why: `Unverified ${s.source} signal`,
    });
    if (center) edges.push({ from: id, to: `d:${center.id}`, kind: "influences", label: "influences" });
  });

  return {
    counts: {
      people,
      projects: byType.project || decisionsN,
      customers: byType.customer || 0,
      decisions: decisionsN,
      meetings: meetingsN,
      documents: 0,
      signals: signalsN,
      integrations: sources.filter((s) => s.connected).length,
    },
    sources,
    graph: { nodes, edges },
    recommendations: recsFromDecisions(decisions),
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title || "Untitled meeting",
      occurred_at: m.occurred_at,
      attendees: m.attendees || "",
    })),
  };
}
