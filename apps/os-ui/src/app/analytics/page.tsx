"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, TopBar } from "@/components/shell/AppShell";
import { Panel, PanelHeader, ProgressBar, StatusPill } from "@/components/ui/Primitives";
import { DonutChart, Gauge, LineChart, Sparkline } from "@/components/analytics/Charts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Download,
  Filter,
  Plus,
  Settings,
  Shield,
  SlidersHorizontal,
} from "@/components/icons";
import {
  fetchAnalyticsSummary,
  type AnalyticsRange,
  type AnalyticsSummary,
} from "@/lib/api";
import styles from "../pages.module.css";

type TabId =
  | "overview"
  | "execution"
  | "decisions"
  | "teams"
  | "initiatives"
  | "trends"
  | "reports";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "execution", label: "Execution" },
  { id: "decisions", label: "Decisions" },
  { id: "teams", label: "Teams" },
  { id: "initiatives", label: "Initiatives" },
  { id: "trends", label: "Trends" },
  { id: "reports", label: "Reports" },
];

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "14d", label: "14 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
];

function toneToSpark(tone: string) {
  if (tone === "good") return "green";
  if (tone === "bad") return "red";
  if (tone === "warn") return "orange";
  return "gold";
}

function Delta({ up, label }: { up: boolean; label: string }) {
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={styles.axDelta} data-up={up ? "true" : "false"}>
      <Icon size={12} />
      {label}
    </span>
  );
}

function exportCsv(data: AnalyticsSummary) {
  const rows = [
    ["section", "metric", "value"],
    ...data.overview.kpis.map((k) => ["overview", k.label, k.value]),
    ["execution", "total", String(data.execution.totals.total)],
    ["execution", "blocked", String(data.execution.totals.blocked)],
    ["decisions", "effectiveness", `${data.decisions.metrics.effectiveness}%`],
  ];
  const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hustronix-analytics-${data.range}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [live, setLive] = useState(false);
  const [partial, setPartial] = useState(false);
  const [trendMetric, setTrendMetric] = useState("health");
  const [reportFilter, setReportFilter] = useState<"all" | "my" | "scheduled">("all");

  useEffect(() => {
    let cancelled = false;
    fetchAnalyticsSummary(range).then((res) => {
      if (cancelled) return;
      setData(res.data);
      setLive(res.live);
      setPartial(res.partial);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const trend = useMemo(() => {
    const metrics = data?.trends.metrics ?? [];
    return metrics.find((m) => m.id === trendMetric) ?? metrics[0];
  }, [data, trendMetric]);

  const reports = useMemo(() => {
    const list = data?.reports ?? [];
    if (reportFilter === "all") return list;
    if (reportFilter === "my") return list.filter((r) => r.kind === "my");
    return list.filter((r) => r.kind === "scheduled");
  }, [data, reportFilter]);

  const d = data;

  return (
    <AppShell
      topBar={
        <TopBar
          title="Analytics"
          subtitle="Measure what matters. Improve what counts."
          trailing={
            <div className={styles.axToolbar}>
              <label className={styles.axRange}>
                <Calendar size={14} />
                <select
                  value={range}
                  onChange={(e) => setRange(e.target.value as AnalyticsRange)}
                  aria-label="Date range"
                >
                  {RANGES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <span>{d?.rangeLabel ?? "—"}</span>
              </label>
              <button type="button" className={styles.axGhostBtn} disabled title="Coming soon">
                <Filter size={14} />
                Filters
              </button>
              <button
                type="button"
                className={styles.axGhostBtn}
                onClick={() => d && exportCsv(d)}
                disabled={!d}
              >
                <Download size={14} />
                Export
              </button>
              {!live ? <span className={styles.axLiveBadge}>Sample</span> : null}
              {live && partial ? <span className={styles.axLiveBadge}>Partial</span> : null}
            </div>
          }
        />
      }
    >
      <nav className={styles.axTabs} aria-label="Analytics sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.axTab}
            data-on={tab === t.id ? "true" : "false"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {!d ? <p className={styles.emptyHint}>Loading analytics…</p> : null}

      {d && tab === "overview" ? (
        <div className={styles.axStack}>
          <div className={styles.axKpiGrid}>
            {d.overview.kpis.map((k) => (
              <article key={k.id} className={styles.axKpi} data-tone={k.tone}>
                <header>
                  <span>{k.label}</span>
                  <Sparkline values={k.spark} tone={toneToSpark(k.tone)} />
                </header>
                <strong>{k.value}</strong>
                <em>{k.sub}</em>
                <Delta up={k.up} label={k.deltaLabel} />
              </article>
            ))}
          </div>

          <div className={styles.axGrid3}>
            <Panel>
              <PanelHeader title="Execution Health Over Time" subtitle="6-week ledger trend" />
              <LineChart
                points={d.overview.healthSeries.map((p) => ({ label: p.label, value: p.value }))}
                color="green"
              />
            </Panel>

            <Panel>
              <PanelHeader title="Execution Distribution" />
              <div className={styles.axDonutRow}>
                <DonutChart
                  slices={d.overview.distribution.slices}
                  total={d.overview.distribution.total}
                  centerLabel="Total Tasks"
                />
                <ul className={styles.axLegend}>
                  {d.overview.distribution.slices.map((s) => (
                    <li key={s.key} data-color={s.color}>
                      <span />
                      <strong>{s.label}</strong>
                      <em>
                        {s.count} ({s.pct}%)
                      </em>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Top Risk Areas" />
              <ul className={styles.axRiskList}>
                {d.overview.topRisks.length ? (
                  d.overview.topRisks.map((r) => (
                    <li key={r.id}>
                      <span className={styles.axRiskIcon} data-level={r.level}>
                        <AlertTriangle size={14} />
                      </span>
                      <div>
                        <strong>{r.title}</strong>
                        <p>{r.detail}</p>
                      </div>
                      <StatusPill label={r.level} tone={r.level} />
                      <em>{r.score}</em>
                    </li>
                  ))
                ) : (
                  <li className={styles.emptyHint}>No blocked-task risks on the ledger.</li>
                )}
              </ul>
            </Panel>
          </div>
        </div>
      ) : null}

      {d && tab === "execution" ? (
        <div className={styles.axStack}>
          <div className={styles.axStatStrip}>
            {[
              ["Total", d.execution.totals.total],
              ["Completed", d.execution.totals.completed],
              ["In Progress", d.execution.totals.inProgress],
              ["Blocked", d.execution.totals.blocked],
              ["Overdue", d.execution.totals.overdue],
            ].map(([label, value]) => (
              <div key={String(label)} className={styles.axStat}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className={styles.grid2}>
            <Panel>
              <PanelHeader title="Tasks by Status" />
              <div className={styles.axDonutRow}>
                <DonutChart
                  slices={d.execution.distribution.slices}
                  total={d.execution.distribution.total}
                  centerLabel="Tasks"
                />
                <ul className={styles.axLegend}>
                  {d.execution.distribution.slices.map((s) => (
                    <li key={s.key} data-color={s.color}>
                      <span />
                      <strong>{s.label}</strong>
                      <em>
                        {s.count} ({s.pct}%)
                      </em>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Top Bottlenecks" />
              <div className={styles.axTableWrap}>
                <table className={styles.axTable}>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Owner</th>
                      <th>Impact</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.execution.bottlenecks.length ? (
                      d.execution.bottlenecks.map((b) => (
                        <tr key={b.id}>
                          <td>{b.task}</td>
                          <td>{b.owner}</td>
                          <td>
                            <StatusPill label={b.impact} tone={b.impact} />
                          </td>
                          <td>{b.reason}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className={styles.emptyHint}>
                          No blockers — execution is clear.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      {d && tab === "decisions" ? (
        <div className={styles.axStack}>
          <div className={styles.axStatStrip}>
            {[
              ["Decisions Made", d.decisions.metrics.made],
              ["Approved", d.decisions.metrics.approved],
              ["Pending", d.decisions.metrics.pending],
              ["Reversed", d.decisions.metrics.reversed],
              ["Effectiveness", `${d.decisions.metrics.effectiveness}%`],
            ].map(([label, value]) => (
              <div key={String(label)} className={styles.axStat}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className={styles.grid2}>
            <Panel>
              <PanelHeader title="Decision Effectiveness" />
              <div className={styles.axCenter}>
                <Gauge value={d.decisions.metrics.effectiveness} label="Ledger conversion" />
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Recent Decisions" />
              <div className={styles.axTableWrap}>
                <table className={styles.axTable}>
                  <thead>
                    <tr>
                      <th>Decision</th>
                      <th>Status</th>
                      <th>Confidence</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.decisions.recent.map((row) => (
                      <tr key={row.id}>
                        <td>{row.title}</td>
                        <td>
                          <StatusPill label={row.status} />
                        </td>
                        <td>{row.confidence != null ? `${row.confidence}%` : "—"}</td>
                        <td>{String(row.when).slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      {d && tab === "teams" ? (
        <div className={styles.axStack}>
          <div className={styles.axGrid3}>
            <Panel>
              <PanelHeader title="Team Health" subtitle={`${d.teams.people} people`} />
              <div className={styles.axTeamList}>
                {d.teams.health.length ? (
                  d.teams.health.map((t) => (
                    <div key={t.team} className={styles.axTeamRow}>
                      <div>
                        <strong>{t.team}</strong>
                        <em>
                          {t.members} · load {t.load}%
                        </em>
                      </div>
                      <ProgressBar
                        value={t.health}
                        tone={t.health >= 75 ? "green" : t.health >= 55 ? "orange" : "red"}
                      />
                      <Sparkline values={t.spark} tone={t.health >= 75 ? "green" : "orange"} />
                    </div>
                  ))
                ) : (
                  <p className={styles.emptyHint}>No roster / owners yet.</p>
                )}
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Workload Distribution" />
              <div className={styles.axDonutRow}>
                <DonutChart
                  slices={d.teams.workload}
                  total={d.teams.people}
                  centerLabel="People"
                />
                <ul className={styles.axLegend}>
                  {d.teams.workload.map((s) => (
                    <li key={s.key} data-color={s.color}>
                      <span />
                      <strong>{s.label}</strong>
                      <em>
                        {s.count} ({s.pct}%)
                      </em>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="People Overloaded" />
              <div className={styles.axTableWrap}>
                <table className={styles.axTable}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Team</th>
                      <th>Load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.teams.overloaded.length ? (
                      d.teams.overloaded.map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{p.team}</td>
                          <td>
                            <strong className={styles.axLoadHot}>{p.load}%</strong>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className={styles.emptyHint}>
                          No overloaded owners.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      {d && tab === "initiatives" ? (
        <Panel>
          <PanelHeader title="Initiatives" subtitle="Active decisions as strategic initiatives" />
          <div className={styles.axTableWrap}>
            <table className={styles.axTable}>
              <thead>
                <tr>
                  <th>Initiative</th>
                  <th>Health</th>
                  <th>Progress</th>
                  <th>Risks</th>
                  <th>Owner</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {d.initiatives.length ? (
                  d.initiatives.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.name}</strong>
                      </td>
                      <td>
                        <span className={styles.axHealthDot} data-tone={i.health >= 70 ? "good" : i.health >= 45 ? "warn" : "bad"} />
                        {i.health}%
                      </td>
                      <td>
                        <div className={styles.axMiniBar}>
                          <ProgressBar value={i.progress} tone="blue" />
                          <em>{i.progress}%</em>
                        </div>
                      </td>
                      <td>
                        <StatusPill label={String(i.risks)} tone={i.risks > 2 ? "high" : "low"} />
                      </td>
                      <td>{i.owner}</td>
                      <td>{i.target}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className={styles.emptyHint}>
                      No active initiatives on the ledger.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {d && tab === "trends" ? (
        <div className={styles.axTrends}>
          <aside className={styles.axTrendNav}>
            {d.trends.metrics.map((m) => (
              <button
                key={m.id}
                type="button"
                data-on={trend?.id === m.id ? "true" : "false"}
                onClick={() => setTrendMetric(m.id)}
              >
                {m.label}
              </button>
            ))}
          </aside>
          <Panel>
            <PanelHeader title={trend?.label || "Trend"} subtitle={d.rangeLabel} />
            {trend ? (
              <>
                <LineChart
                  points={trend.series.map((p) => ({ label: p.date, value: p.value }))}
                  color="gold"
                  height={240}
                />
                <div className={styles.axTrendStats}>
                  {(() => {
                    const vals = trend.series.map((p) => p.value);
                    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                    const best = vals.length ? Math.max(...vals) : 0;
                    const worst = vals.length ? Math.min(...vals) : 0;
                    const change = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0;
                    return (
                      <>
                        <div>
                          <span>Average</span>
                          <strong>{avg.toFixed(1)}</strong>
                        </div>
                        <div>
                          <span>Best</span>
                          <strong>{best.toFixed(1)}</strong>
                        </div>
                        <div>
                          <span>Worst</span>
                          <strong>{worst.toFixed(1)}</strong>
                        </div>
                        <div>
                          <span>Change</span>
                          <strong>
                            {change > 0 ? "+" : ""}
                            {change.toFixed(1)}
                          </strong>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {d && tab === "reports" ? (
        <Panel>
          <PanelHeader
            title="Reports"
            action={
              <div className={styles.axReportActions}>
                <div className={styles.axMiniTabs}>
                  {(
                    [
                      ["all", "All"],
                      ["my", "My"],
                      ["scheduled", "Scheduled"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      data-on={reportFilter === id ? "true" : "false"}
                      onClick={() => setReportFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button type="button" className={styles.axPrimaryBtn} disabled title="Coming soon">
                  <Plus size={14} />
                  New Report
                </button>
              </div>
            }
          />
          <div className={styles.axTableWrap}>
            <table className={styles.axTable}>
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Description</th>
                  <th>Last Run</th>
                  <th>Owner</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>{r.description}</td>
                    <td>{String(r.lastRun).slice(0, 10)}</td>
                    <td>{r.owner}</td>
                    <td className={styles.axRowActions}>
                      <button type="button" title="Run" onClick={() => exportCsv(d)}>
                        <SlidersHorizontal size={14} />
                      </button>
                      <button type="button" title="Settings" disabled>
                        <Settings size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.axReportHint}>
            <Shield size={13} /> Reports export live ledger KPIs. Scheduling UI ships later.
          </p>
        </Panel>
      ) : null}
    </AppShell>
  );
}
