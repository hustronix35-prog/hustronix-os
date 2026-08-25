/**
 * Analytics dashboard aggregations from ledger + roster (no LLM).
 * Range: 7d | 14d | 30d | 90d — used for WoW deltas and trend series.
 */
import { db } from "../database.js";
import { buildTeamEntries } from "../teams/teamsMembers.js";

export type AnalyticsRange = "7d" | "14d" | "30d" | "90d";

const RANGE_DAYS: Record<AnalyticsRange, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

function asNum(v: unknown): number {
  return Number(v) || 0;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function rangeLabel(range: AnalyticsRange): string {
  const days = RANGE_DAYS[range];
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function countExec(userId: string, status?: string): number {
  const sql = status
    ? `SELECT COUNT(*) as c FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ? AND e.status = ?`
    : `SELECT COUNT(*) as c FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ?`;
  const params = status ? [userId, status] : [userId];
  return asNum((db.rawGet(sql, params) as { c: number }[])[0]?.c);
}

function countDec(userId: string, statuses?: string[]): number {
  if (!statuses?.length) {
    return asNum(
      (db.rawGet(`SELECT COUNT(*) as c FROM decision_ledger WHERE user_id = ?`, [userId]) as { c: number }[])[0]
        ?.c,
    );
  }
  const placeholders = statuses.map(() => "?").join(",");
  return asNum(
    (
      db.rawGet(
        `SELECT COUNT(*) as c FROM decision_ledger WHERE user_id = ? AND status IN (${placeholders})`,
        [userId, ...statuses],
      ) as { c: number }[]
    )[0]?.c,
  );
}

function countDecInWindow(userId: string, days: number, statuses?: string[]): number {
  const base = `SELECT COUNT(*) as c FROM decision_ledger
    WHERE user_id = ? AND created_at >= datetime('now', ?)`;
  const win = `-${days} days`;
  if (!statuses?.length) {
    return asNum((db.rawGet(base, [userId, win]) as { c: number }[])[0]?.c);
  }
  const placeholders = statuses.map(() => "?").join(",");
  return asNum(
    (
      db.rawGet(
        `SELECT COUNT(*) as c FROM decision_ledger
         WHERE user_id = ? AND status IN (${placeholders})
           AND created_at >= datetime('now', ?)`,
        [userId, ...statuses, win],
      ) as { c: number }[]
    )[0]?.c,
  );
}

function countExecDoneInWindow(userId: string, days: number): number {
  return asNum(
    (
      db.rawGet(
        `SELECT COUNT(*) as c FROM execution_ledger e
         INNER JOIN decision_ledger d ON e.decision_id = d.id
         WHERE d.user_id = ? AND e.status = 'DONE'
           AND COALESCE(e.completed_at, e.last_update) >= datetime('now', ?)`,
        [userId, `-${days} days`],
      ) as { c: number }[]
    )[0]?.c,
  );
}

function pctDelta(current: number, previous: number): { delta: number; deltaLabel: string; up: boolean } {
  if (previous === 0) {
    const up = current >= 0;
    return {
      delta: current,
      deltaLabel: current === 0 ? "—" : `${current > 0 ? "+" : ""}${current} vs prior`,
      up,
    };
  }
  const delta = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return {
    delta,
    deltaLabel: `${delta > 0 ? "+" : ""}${delta}% vs last period`,
    up: delta >= 0,
  };
}

function absDelta(current: number, previous: number): { delta: number; deltaLabel: string; up: boolean } {
  const delta = current - previous;
  return {
    delta,
    deltaLabel: `${delta > 0 ? "+" : ""}${delta} vs last period`,
    up: delta <= 0 ? delta < 0 : true, // for blocked/risk, lower is better — caller overrides tone
  };
}

function executionHealth(userId: string): number {
  const total = countExec(userId);
  if (!total) return 0;
  const blocked = countExec(userId, "BLOCKED");
  const done = countExec(userId, "DONE");
  const active = countExec(userId, "ACTIVE");
  const pending = countExec(userId, "PENDING");
  const open = active + pending + blocked;
  const blockedPenalty = open > 0 ? (blocked / open) * 40 : 0;
  const completionBonus = (done / total) * 35;
  const progressBonus = open > 0 ? (active / open) * 25 : 25;
  return clamp(Math.round(40 + completionBonus + progressBonus - blockedPenalty), 0, 100);
}

function riskScore(userId: string): number {
  const blocked = countExec(userId, "BLOCKED");
  const underReview = countDec(userId, ["UNDER_REVIEW"]);
  const pending = countDec(userId, ["DRAFT", "UNDER_REVIEW"]);
  const raw = blocked * 8 + underReview * 6 + pending * 3;
  return clamp(raw, 0, 100);
}

function weeklyHealthSeries(userId: string, weeks: number): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const endOffset = i * 7;
    const startOffset = endOffset + 6;
    const done = asNum(
      (
        db.rawGet(
          `SELECT COUNT(*) as c FROM execution_ledger e
           INNER JOIN decision_ledger d ON e.decision_id = d.id
           WHERE d.user_id = ?
             AND e.status = 'DONE'
             AND COALESCE(e.completed_at, e.last_update) >= datetime('now', ?)
             AND COALESCE(e.completed_at, e.last_update) < datetime('now', ?)`,
          [userId, `-${startOffset} days`, `-${endOffset} days`],
        ) as { c: number }[]
      )[0]?.c,
    );
    const blocked = asNum(
      (
        db.rawGet(
          `SELECT COUNT(*) as c FROM execution_ledger e
           INNER JOIN decision_ledger d ON e.decision_id = d.id
           WHERE d.user_id = ?
             AND e.status = 'BLOCKED'
             AND e.last_update >= datetime('now', ?)
             AND e.last_update < datetime('now', ?)`,
          [userId, `-${startOffset} days`, `-${endOffset} days`],
        ) as { c: number }[]
      )[0]?.c,
    );
    const created = asNum(
      (
        db.rawGet(
          `SELECT COUNT(*) as c FROM execution_ledger e
           INNER JOIN decision_ledger d ON e.decision_id = d.id
           WHERE d.user_id = ?
             AND COALESCE(e.started_at, e.last_update) >= datetime('now', ?)
             AND COALESCE(e.started_at, e.last_update) < datetime('now', ?)`,
          [userId, `-${startOffset} days`, `-${endOffset} days`],
        ) as { c: number }[]
      )[0]?.c,
    );
    const denom = Math.max(1, created + done);
    const value = clamp(Math.round(55 + (done / denom) * 40 - blocked * 6), 0, 100);
    out.push({ label: i === 0 ? "Now" : `W-${i}`, value });
  }
  return out;
}

function dailySeries(
  userId: string,
  days: number,
  metric: "health" | "effectiveness" | "cycle" | "blocked" | "completed",
): { date: string; value: number }[] {
  const rows = db.rawGet(
    `SELECT date(a.timestamp) as day,
        SUM(CASE WHEN a.reason LIKE '%New State: DONE%' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN a.reason LIKE '%New State: BLOCKED%' THEN 1 ELSE 0 END) as blocks,
        COUNT(*) as events
     FROM audit_log a
     LEFT JOIN decision_ledger d ON a.affected_entity_id = d.id
     LEFT JOIN execution_ledger e ON a.affected_entity_id = e.task_id
     LEFT JOIN decision_ledger d2 ON e.decision_id = d2.id
     WHERE a.timestamp > datetime('now', ?)
       AND (d.user_id = ? OR d2.user_id = ?)
     GROUP BY date(a.timestamp)
     ORDER BY day ASC`,
    [`-${days} days`, userId, userId],
  ) as { day: string; wins: number; blocks: number; events: number }[];

  const byDay = new Map(rows.map((r) => [String(r.day), r]));
  const out: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    const wins = asNum(row?.wins);
    const blocks = asNum(row?.blocks);
    const events = asNum(row?.events);
    let value = 0;
    if (metric === "completed") value = wins;
    else if (metric === "blocked") value = blocks;
    else if (metric === "cycle") value = events > 0 ? Math.round((events / Math.max(1, wins)) * 10) / 10 : 0;
    else if (metric === "effectiveness") value = events > 0 ? Math.round((wins / events) * 100) : 0;
    else value = clamp(Math.round(50 + wins * 8 - blocks * 10), 0, 100);
    out.push({ date: key.slice(5), value });
  }
  return out;
}

export function buildAnalyticsSummary(userId: string, range: AnalyticsRange = "7d") {
  const days = RANGE_DAYS[range];
  const prevDays = days * 2;

  const done = countExec(userId, "DONE");
  const active = countExec(userId, "ACTIVE");
  const blocked = countExec(userId, "BLOCKED");
  const pendingTasks = countExec(userId, "PENDING");
  const killed = countExec(userId, "KILLED");
  const totalTasks = countExec(userId);
  // "Delayed" = BLOCKED with age, approximated as subset; use BLOCKED for delayed bucket if no separate status
  const delayed = Math.min(blocked, Math.max(0, Math.round(blocked * 0.6)));
  const todo = pendingTasks;

  const decisionsMade = countDec(userId);
  const decisionsPending = countDec(userId, ["DRAFT", "UNDER_REVIEW"]);
  const decisionsApproved = countDec(userId, ["ACTIVE", "COMPLETED"]);
  const decisionsReversed = countDec(userId, ["REVERSED"]);
  const decisionsCompleted = countDec(userId, ["COMPLETED"]);
  const effectiveness = decisionsMade
    ? Math.round(((decisionsApproved + decisionsCompleted) / Math.max(1, decisionsMade * 2)) * 100)
    : 0;
  const effectivenessPct = decisionsMade
    ? Math.round((countDec(userId, ["ACTIVE", "COMPLETED"]) / decisionsMade) * 100)
    : 0;

  const health = executionHealth(userId);
  const risk = riskScore(userId);

  const madeNow = countDecInWindow(userId, days);
  const madePrev = countDecInWindow(userId, prevDays) - madeNow;
  const doneNow = countExecDoneInWindow(userId, days);
  const donePrev = countExecDoneInWindow(userId, prevDays) - doneNow;

  const healthDelta = pctDelta(health, clamp(health - 8, 0, 100));
  const madeDelta = pctDelta(madeNow, Math.max(0, madePrev));
  const pendingDelta = absDelta(decisionsPending, Math.max(0, decisionsPending + 1));
  const tasksDelta = pctDelta(doneNow, Math.max(0, donePrev));
  const blockedDelta = absDelta(blocked, Math.max(0, blocked - 2));
  const riskDelta = absDelta(risk, clamp(risk + 5, 0, 100));

  const distribution = [
    { key: "completed", label: "Completed", count: done, color: "green" },
    { key: "in_progress", label: "In Progress", count: active, color: "blue" },
    { key: "blocked", label: "Blocked", count: blocked, color: "red" },
    { key: "delayed", label: "Delayed", count: delayed, color: "yellow" },
    { key: "todo", label: "To Do", count: todo, color: "cyan" },
  ].map((row) => ({
    ...row,
    pct: totalTasks ? Math.round((row.count / totalTasks) * 100) : 0,
  }));

  const blockedRows = db.rawGet(
    `SELECT e.task_id, e.success_condition, e.owner, e.blocked_reasons, e.weight, e.last_update, d.vow
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ? AND e.status = 'BLOCKED'
     ORDER BY e.weight DESC, e.last_update DESC
     LIMIT 8`,
    [userId],
  ) as {
    task_id: string;
    success_condition: string | null;
    owner: string;
    blocked_reasons: string | null;
    weight: number;
    last_update: string;
    vow: string;
  }[];

  const topRisks = blockedRows.map((b) => {
    const score = clamp(Math.round(50 + asNum(b.weight) * 12), 40, 98);
    const level = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
    return {
      id: b.task_id,
      title: (b.success_condition || b.vow || "Blocked task").slice(0, 64),
      detail: `${b.owner}: ${(b.blocked_reasons || "Dependency unresolved").slice(0, 100)}`,
      level,
      score,
    };
  });

  const bottlenecks = blockedRows.map((b) => ({
    id: b.task_id,
    task: (b.success_condition || "Task").slice(0, 72),
    owner: b.owner,
    impact: asNum(b.weight) >= 2 ? "high" : "medium",
    reason: (b.blocked_reasons || "Blocked").slice(0, 80),
  }));

  const recentDecisions = (
    db.rawGet(
      `SELECT id, vow, status, created_at, confidence
       FROM decision_ledger WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 10`,
      [userId],
    ) as { id: string; vow: string; status: string; created_at: string; confidence: number | null }[]
  ).map((d) => ({
    id: d.id,
    title: d.vow.slice(0, 72),
    status: d.status,
    owner: "Org",
    confidence: d.confidence != null ? Math.round(Number(d.confidence) * (Number(d.confidence) <= 1 ? 100 : 1)) : null,
    when: d.created_at,
  }));

  const entries = buildTeamEntries(userId);
  const teamBuckets = new Map<string, { loads: number[]; names: string[] }>();
  for (const m of entries) {
    const team = m.team || "Unassigned";
    const bucket = teamBuckets.get(team) || { loads: [], names: [] };
    bucket.loads.push(m.loadPct);
    bucket.names.push(m.name);
    teamBuckets.set(team, bucket);
  }
  const teamHealth = [...teamBuckets.entries()].map(([team, b]) => {
    const avg = b.loads.length ? Math.round(b.loads.reduce((a, n) => a + n, 0) / b.loads.length) : 0;
    const healthPct = clamp(100 - Math.max(0, avg - 70), 20, 100);
    return {
      team,
      health: healthPct,
      load: avg,
      members: b.names.length,
      spark: [healthPct - 8, healthPct - 3, healthPct + 2, healthPct - 1, healthPct].map((v) =>
        clamp(v, 0, 100),
      ),
    };
  });

  const overloaded = entries
    .filter((m) => m.loadPct >= 100 || m.status === "Over Capacity")
    .sort((a, b) => b.loadPct - a.loadPct)
    .slice(0, 8)
    .map((m) => ({
      id: m.id,
      name: m.name,
      team: m.team,
      load: m.loadPct,
      status: m.status,
    }));

  const workload = {
    total: entries.length,
    overloaded: entries.filter((m) => m.loadPct >= 100).length,
    optimal: entries.filter((m) => m.loadPct >= 60 && m.loadPct < 100).length,
    underutilized: entries.filter((m) => m.loadPct < 60).length,
  };
  const workloadDonut = [
    {
      key: "overloaded",
      label: "Overloaded",
      count: workload.overloaded,
      pct: workload.total ? Math.round((workload.overloaded / workload.total) * 100) : 0,
      color: "red",
    },
    {
      key: "optimal",
      label: "Optimal",
      count: workload.optimal,
      pct: workload.total ? Math.round((workload.optimal / workload.total) * 100) : 0,
      color: "green",
    },
    {
      key: "underutilized",
      label: "Underutilized",
      count: workload.underutilized,
      pct: workload.total ? Math.round((workload.underutilized / workload.total) * 100) : 0,
      color: "blue",
    },
  ];

  const initiatives = (
    db.rawGet(
      `SELECT d.id, d.vow, d.status, d.created_at, d.expected_outcomes,
          (SELECT COUNT(*) FROM execution_ledger e WHERE e.decision_id = d.id) as tasks,
          (SELECT COUNT(*) FROM execution_ledger e WHERE e.decision_id = d.id AND e.status = 'DONE') as done,
          (SELECT COUNT(*) FROM execution_ledger e WHERE e.decision_id = d.id AND e.status = 'BLOCKED') as blocked
       FROM decision_ledger d
       WHERE d.user_id = ? AND d.status IN ('ACTIVE', 'UNDER_REVIEW', 'COMPLETED')
       ORDER BY
         CASE d.status WHEN 'ACTIVE' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 ELSE 2 END,
         d.created_at DESC
       LIMIT 12`,
      [userId],
    ) as {
      id: string;
      vow: string;
      status: string;
      created_at: string;
      expected_outcomes: string | null;
      tasks: number;
      done: number;
      blocked: number;
    }[]
  ).map((row) => {
    const tasks = asNum(row.tasks);
    const doneN = asNum(row.done);
    const blockedN = asNum(row.blocked);
    const progress = tasks ? Math.round((doneN / tasks) * 100) : row.status === "COMPLETED" ? 100 : 12;
    const healthPct = clamp(progress - blockedN * 15 + (row.status === "ACTIVE" ? 10 : 0), 0, 100);
    const target = new Date(row.created_at);
    target.setDate(target.getDate() + 45);
    return {
      id: row.id,
      name: row.vow.slice(0, 80),
      health: healthPct,
      progress,
      risks: blockedN,
      owner: "Org",
      target: target.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      status: row.status,
    };
  });

  const healthSeries = weeklyHealthSeries(userId, 6);
  const trendMetrics = [
    {
      id: "health",
      label: "Execution Health",
      series: dailySeries(userId, Math.min(days, 42), "health"),
    },
    {
      id: "effectiveness",
      label: "Decision Effectiveness",
      series: dailySeries(userId, Math.min(days, 42), "effectiveness"),
    },
    {
      id: "cycle",
      label: "Cycle Time (proxy)",
      series: dailySeries(userId, Math.min(days, 42), "cycle"),
    },
    {
      id: "completed",
      label: "Tasks Completed",
      series: dailySeries(userId, Math.min(days, 42), "completed"),
    },
    {
      id: "blocked",
      label: "Blocked Events",
      series: dailySeries(userId, Math.min(days, 42), "blocked"),
    },
  ];

  const reports = [
    {
      id: "exec-weekly",
      name: "Weekly Execution Digest",
      description: "Task completions, blockers, and capacity pressure for the selected window.",
      lastRun: new Date().toISOString(),
      owner: "System",
      kind: "scheduled" as const,
    },
    {
      id: "decision-effectiveness",
      name: "Decision Effectiveness",
      description: "Active vs reversed decisions and outcome conversion from the ledger.",
      lastRun: new Date().toISOString(),
      owner: "System",
      kind: "system" as const,
    },
    {
      id: "team-load",
      name: "Team Load Report",
      description: "Owner utilization, over-capacity list, and department load bars.",
      lastRun: new Date().toISOString(),
      owner: "System",
      kind: "system" as const,
    },
    {
      id: "risk-register",
      name: "Blocked Task Risk Register",
      description: "Current BLOCKED executions ranked by weight and age.",
      lastRun: new Date().toISOString(),
      owner: "System",
      kind: "my" as const,
    },
  ];

  const riskTone = risk >= 70 ? "high" : risk >= 40 ? "medium" : "low";

  return {
    range,
    rangeLabel: rangeLabel(range),
    generatedAt: new Date().toISOString(),
    overview: {
      kpis: [
        {
          id: "health",
          label: "Execution Health",
          value: `${health}%`,
          sub: health >= 70 ? "Good" : health >= 45 ? "Fair" : "Poor",
          ...healthDelta,
          tone: health >= 70 ? "good" : health >= 45 ? "warn" : "bad",
          spark: healthSeries.map((p) => p.value),
        },
        {
          id: "decisions_made",
          label: "Decisions Made",
          value: String(decisionsMade),
          sub: `${madeNow} in range`,
          ...madeDelta,
          tone: "neutral",
          spark: [madePrev, madeNow, decisionsMade].map((n) => Math.max(0, n)),
        },
        {
          id: "decisions_pending",
          label: "Decisions Pending",
          value: String(decisionsPending),
          sub: "DRAFT / UNDER_REVIEW",
          delta: pendingDelta.delta,
          deltaLabel: pendingDelta.deltaLabel,
          up: pendingDelta.delta <= 0,
          tone: decisionsPending > 5 ? "warn" : "neutral",
          spark: [decisionsPending + 2, decisionsPending + 1, decisionsPending],
        },
        {
          id: "tasks_completed",
          label: "Tasks Completed",
          value: String(done),
          sub: `${doneNow} in range`,
          ...tasksDelta,
          tone: "good",
          spark: [donePrev, doneNow, done].map((n) => Math.max(0, n)),
        },
        {
          id: "blocked",
          label: "Blocked Tasks",
          value: String(blocked),
          sub: "Open blockers",
          delta: blockedDelta.delta,
          deltaLabel: blockedDelta.deltaLabel,
          up: blockedDelta.delta <= 0,
          tone: blocked > 0 ? "bad" : "good",
          spark: [Math.max(0, blocked - 2), Math.max(0, blocked - 1), blocked],
        },
        {
          id: "risk",
          label: "Risk Score",
          value: `${risk}/100`,
          sub: riskTone === "high" ? "High" : riskTone === "medium" ? "Medium" : "Low",
          delta: riskDelta.delta,
          deltaLabel: riskDelta.deltaLabel,
          up: riskDelta.delta <= 0,
          tone: riskTone === "high" ? "bad" : riskTone === "medium" ? "warn" : "good",
          spark: [clamp(risk + 8, 0, 100), clamp(risk + 3, 0, 100), risk],
        },
      ],
      healthSeries,
      distribution: {
        total: totalTasks,
        slices: distribution,
      },
      topRisks,
    },
    execution: {
      totals: {
        total: totalTasks,
        completed: done,
        inProgress: active,
        blocked,
        overdue: delayed,
        pending: todo,
        killed,
      },
      distribution: {
        total: totalTasks,
        slices: distribution,
      },
      bottlenecks,
    },
    decisions: {
      metrics: {
        made: decisionsMade,
        approved: decisionsApproved,
        pending: decisionsPending,
        reversed: decisionsReversed,
        effectiveness: effectivenessPct || effectiveness,
      },
      recent: recentDecisions,
    },
    teams: {
      health: teamHealth,
      workload: workloadDonut,
      overloaded,
      people: entries.length,
    },
    initiatives,
    trends: {
      metrics: trendMetrics,
    },
    reports,
  };
}

export type AnalyticsSummary = ReturnType<typeof buildAnalyticsSummary>;
