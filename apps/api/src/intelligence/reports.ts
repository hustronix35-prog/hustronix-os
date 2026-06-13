import { db } from "../database.js";
import { findDriftSignals, findOverloadedOwners, findConflictingExecutions } from "./operationalQuery.js";

/**
 * Operational reports — execution drift summary + system health.
 *
 * IMPORTANT: per the user's spec, reports are API-triggered, NOT cron. We
 * intentionally do NOT schedule any of these. Operators or upstream callers
 * (digest emailer, weekly review UI, Slack /report command, etc.) decide when
 * to compute. Computation cost is small enough to run on demand.
 *
 * Two scopes:
 *   - weeklyDriftReport   : "what almost slipped this week"
 *   - operationalHealth   : "where is the system right now"
 *
 * Both produce a stable JSON shape and have a `formatReportMarkdown` helper
 * for digest/email use.
 */

// =====================================================================
// Weekly drift report
// =====================================================================

export interface WeeklyDriftReport {
  generatedAt: string;
  userId: string;
  windowDays: number;
  totals: {
    signals: number;
    high_risk: number;
    linked: number;
    killed: number;
    drifted: number;
    incidents: number;
    commitments: number;
  };
  topDrifted: ReturnType<typeof findDriftSignals>;
  conflicts: ReturnType<typeof findConflictingExecutions>;
  overloaded: ReturnType<typeof findOverloadedOwners>;
  noActiveDecision: boolean;
}

export function weeklyDriftReport(userId: string, windowDays = 7): WeeklyDriftReport {
  const tenantSql = userId === "system" ? "" : "AND user_id = ?";
  const tenantParams: unknown[] = userId === "system" ? [] : [userId];

  const totalsRow = db.rawGet(
    `SELECT
       COUNT(*) AS signals,
       SUM(CASE WHEN risk='high'                                   THEN 1 ELSE 0 END) AS high_risk,
       SUM(CASE WHEN state='LINKED'                                THEN 1 ELSE 0 END) AS linked,
       SUM(CASE WHEN state='KILLED'                                THEN 1 ELSE 0 END) AS killed,
       SUM(CASE WHEN state IN ('UNVERIFIED','GRACE') AND risk='high' THEN 1 ELSE 0 END) AS drifted,
       SUM(CASE WHEN op_classification='incident'                  THEN 1 ELSE 0 END) AS incidents,
       SUM(CASE WHEN op_classification='commitment'                THEN 1 ELSE 0 END) AS commitments
     FROM external_signals
     WHERE detected_at >= datetime('now', '-' || ? || ' days')
       ${tenantSql}`,
    [windowDays, ...tenantParams],
  ) as Record<string, number>[];

  const t = totalsRow[0] ?? {};

  return {
    generatedAt: new Date().toISOString(),
    userId,
    windowDays,
    totals: {
      signals: Number(t.signals) || 0,
      high_risk: Number(t.high_risk) || 0,
      linked: Number(t.linked) || 0,
      killed: Number(t.killed) || 0,
      drifted: Number(t.drifted) || 0,
      incidents: Number(t.incidents) || 0,
      commitments: Number(t.commitments) || 0,
    },
    topDrifted: findDriftSignals(userId, { riskAtLeast: "high", limit: 10 }),
    conflicts: findConflictingExecutions(userId, 20),
    overloaded: findOverloadedOwners(userId, { limit: 10 }),
    noActiveDecision: !db.getActiveDecision(userId),
  };
}

// =====================================================================
// Operational health snapshot
// =====================================================================

export interface OperationalHealth {
  generatedAt: string;
  userId: string;
  activeDecision: { id: string; vow: string; created_at: string } | null;
  executions: { active: number; pending: number; blocked: number; done_7d: number; killed_7d: number };
  signalAge: { under_1h: number; one_to_24h: number; one_to_7d: number; over_7d: number };
  bySource: Record<string, number>;
  byUrgency: Record<string, number>;
  byClassification: Record<string, number>;
}

export function operationalHealth(userId: string): OperationalHealth {
  const tenantSqlSig = userId === "system" ? "" : "AND user_id = ?";
  const tenantParamsSig: unknown[] = userId === "system" ? [] : [userId];
  const tenantSqlExec = userId === "system" ? "" : "AND d.user_id = ?";
  const tenantParamsExec: unknown[] = userId === "system" ? [] : [userId];

  const ad = db.getActiveDecision(userId);

  const execRow = (db.rawGet(
    `SELECT
       SUM(CASE WHEN e.status='ACTIVE'                                                     THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN e.status='PENDING'                                                    THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN e.status='BLOCKED'                                                    THEN 1 ELSE 0 END) AS blocked,
       SUM(CASE WHEN e.status='DONE'   AND e.last_update >= datetime('now','-7 days')       THEN 1 ELSE 0 END) AS done_7d,
       SUM(CASE WHEN e.status='KILLED' AND e.last_update >= datetime('now','-7 days')       THEN 1 ELSE 0 END) AS killed_7d
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON e.decision_id = d.id
     WHERE 1=1 ${tenantSqlExec}`,
    tenantParamsExec,
  ) as Record<string, number>[])[0] ?? {};

  const ageRow = (db.rawGet(
    `SELECT
       SUM(CASE WHEN (julianday('now') - julianday(detected_at)) * 24 < 1              THEN 1 ELSE 0 END) AS under_1h,
       SUM(CASE WHEN (julianday('now') - julianday(detected_at)) * 24 BETWEEN 1 AND 24 THEN 1 ELSE 0 END) AS one_to_24h,
       SUM(CASE WHEN (julianday('now') - julianday(detected_at)) BETWEEN 1 AND 7       THEN 1 ELSE 0 END) AS one_to_7d,
       SUM(CASE WHEN (julianday('now') - julianday(detected_at)) > 7                   THEN 1 ELSE 0 END) AS over_7d
     FROM external_signals
     WHERE state IN ('UNVERIFIED','GRACE') ${tenantSqlSig}`,
    tenantParamsSig,
  ) as Record<string, number>[])[0] ?? {};

  const sourceRows = db.rawGet(
    `SELECT source, COUNT(*) AS n
       FROM external_signals
      WHERE detected_at >= datetime('now','-30 days') ${tenantSqlSig}
      GROUP BY source`,
    tenantParamsSig,
  ) as { source: string; n: number }[];

  const urgencyRows = db.rawGet(
    `SELECT COALESCE(urgency,'(unknown)') AS urgency, COUNT(*) AS n
       FROM external_signals
      WHERE detected_at >= datetime('now','-30 days') ${tenantSqlSig}
      GROUP BY urgency`,
    tenantParamsSig,
  ) as { urgency: string; n: number }[];

  const classRows = db.rawGet(
    `SELECT COALESCE(op_classification,'(unknown)') AS op_classification, COUNT(*) AS n
       FROM external_signals
      WHERE detected_at >= datetime('now','-30 days') ${tenantSqlSig}
      GROUP BY op_classification`,
    tenantParamsSig,
  ) as { op_classification: string; n: number }[];

  return {
    generatedAt: new Date().toISOString(),
    userId,
    activeDecision: ad ? { id: ad.id, vow: ad.vow, created_at: ad.created_at } : null,
    executions: {
      active: Number(execRow.active) || 0,
      pending: Number(execRow.pending) || 0,
      blocked: Number(execRow.blocked) || 0,
      done_7d: Number(execRow.done_7d) || 0,
      killed_7d: Number(execRow.killed_7d) || 0,
    },
    signalAge: {
      under_1h: Number(ageRow.under_1h) || 0,
      one_to_24h: Number(ageRow.one_to_24h) || 0,
      one_to_7d: Number(ageRow.one_to_7d) || 0,
      over_7d: Number(ageRow.over_7d) || 0,
    },
    bySource: Object.fromEntries(sourceRows.map((r) => [r.source, Number(r.n) || 0])),
    byUrgency: Object.fromEntries(urgencyRows.map((r) => [r.urgency, Number(r.n) || 0])),
    byClassification: Object.fromEntries(classRows.map((r) => [r.op_classification, Number(r.n) || 0])),
  };
}

// =====================================================================
// Markdown formatter (for digest / email / Slack /report)
// =====================================================================

export function formatWeeklyDriftMarkdown(r: WeeklyDriftReport): string {
  const lines: string[] = [];
  lines.push(`# Hustronix Weekly Drift — last ${r.windowDays}d`);
  lines.push(`_generated ${r.generatedAt} (tenant=${r.userId})_`);
  lines.push("");

  if (r.noActiveDecision) {
    lines.push(`> ⚠ No ACTIVE decision in the ledger. Risk classification will be heuristic-only.`);
    lines.push("");
  }

  const t = r.totals;
  lines.push(`## Totals`);
  lines.push(`- signals: **${t.signals}**`);
  lines.push(`- high-risk: **${t.high_risk}**  |  linked: **${t.linked}**  |  killed: **${t.killed}**`);
  lines.push(`- drifted (high-risk + still floating): **${t.drifted}**`);
  lines.push(`- incidents: **${t.incidents}**  |  commitments: **${t.commitments}**`);
  lines.push("");

  if (r.topDrifted.length > 0) {
    lines.push(`## Top drifted signals`);
    for (const s of r.topDrifted) {
      lines.push(
        `- [${s.id.slice(0, 8)}] (${s.source}/${s.source_subtype ?? "-"}) age=${s.age_minutes}m risk=${s.risk} owner=${s.owner}\n  > ${s.intent ?? "(no intent)"} — ${s.content.slice(0, 160)}`,
      );
    }
    lines.push("");
  }

  if (r.conflicts.length > 0) {
    lines.push(`## Executions conflicting with active decision`);
    for (const c of r.conflicts) {
      lines.push(`- task ${c.taskId.slice(0, 8)} owner=${c.owner} status=${c.status} :: matched constraint "${c.matchedConstraint}"`);
    }
    lines.push("");
  }

  if (r.overloaded.length > 0) {
    lines.push(`## Overloaded owners`);
    for (const o of r.overloaded) {
      lines.push(
        `- ${o.owner} :: in-flight=${o.total} (active=${o.active}, pending=${o.pending}, blocked=${o.blocked}), high-risk signals=${o.high_risk_signals}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatHealthMarkdown(h: OperationalHealth): string {
  const lines: string[] = [];
  lines.push(`# Hustronix Operational Health`);
  lines.push(`_generated ${h.generatedAt} (tenant=${h.userId})_`);
  lines.push("");
  lines.push(`## Active decision`);
  lines.push(h.activeDecision ? `- ${h.activeDecision.id.slice(0, 8)} :: ${h.activeDecision.vow}` : `- (none)`);
  lines.push("");
  lines.push(`## Executions`);
  lines.push(`- active=${h.executions.active}  pending=${h.executions.pending}  blocked=${h.executions.blocked}`);
  lines.push(`- last 7d done=${h.executions.done_7d}  killed=${h.executions.killed_7d}`);
  lines.push("");
  lines.push(`## Floating signal ages`);
  lines.push(`- <1h: ${h.signalAge.under_1h}  |  1-24h: ${h.signalAge.one_to_24h}  |  1-7d: ${h.signalAge.one_to_7d}  |  >7d: ${h.signalAge.over_7d}`);
  lines.push("");
  lines.push(`## Mix (last 30d)`);
  lines.push(`- by source: ${Object.entries(h.bySource).map(([k, v]) => `${k}=${v}`).join(", ") || "(empty)"}`);
  lines.push(`- by urgency: ${Object.entries(h.byUrgency).map(([k, v]) => `${k}=${v}`).join(", ") || "(empty)"}`);
  lines.push(`- by classification: ${Object.entries(h.byClassification).map(([k, v]) => `${k}=${v}`).join(", ") || "(empty)"}`);
  return lines.join("\n");
}
