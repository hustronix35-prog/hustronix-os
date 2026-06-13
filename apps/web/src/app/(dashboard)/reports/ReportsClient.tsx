"use client";

import { Download, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClientCharts } from "@/components/charts/ClientCharts";
import { ReportLineChart } from "@/components/charts/ReportLineChart";
import { DashboardHero } from "@/components/shell/DashboardHero";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { apiGet } from "@/lib/api";

type ReportsPayload = {
  kpis: { label: string; value: string; sub: string; trend: string; trendUp: boolean }[];
  chart: { date: string; success: number; load: number }[];
  issues: {
    underperformingDecisions: { title: string; delta: string }[];
    bottlenecks: { title: string; detail: string }[];
    signalNoise: { unverified: number };
  };
  overloadDay: string | null;
};

export default function ReportsClient() {
  const { push } = useRouter();
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await apiGet<ReportsPayload>("/api/metrics/reports");
      setData(res);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load reports");
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function downloadJson() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hustronix-reports-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const chartRows = data?.chart ?? [];
  const hasReportChartData =
    chartRows.length > 0 &&
    chartRows.some((p) => (p.load ?? 0) !== 0 || (p.success ?? 0) !== 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-hx-bg">
      <DashboardHero>
        <PageHeader
          variant="dashboard"
          className="border-b-0 pb-0"
          title="REPORTS"
          subtitle="Execution outcomes, signal noise, and ledger-derived KPIs."
          trailingActions={
            <div data-tour="reports-export" className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                className="shrink-0 gap-2"
                onClick={() => void load()}
              >
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              <Button
                variant="outlineGold"
                size="sm"
                type="button"
                className="shrink-0 gap-2"
                disabled={!data}
                onClick={downloadJson}
              >
                <Download className="size-4" />
                Export JSON
              </Button>
            </div>
          }
        />
        {err && <p className="mt-3 text-sm text-hx-danger">API: {err}</p>}
      </DashboardHero>

      <div className="scrollbar-hide min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-8 lg:px-10 lg:py-10">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-tour="reports-kpis">
          {(data?.kpis || []).map((k) => (
            <Card key={k.label}>
              <p className="text-xs font-semibold uppercase tracking-wide text-hx-muted">
                {k.label}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-hx-text">{k.value}</p>
              <p className="mt-1 text-sm text-hx-muted">{k.sub}</p>
              <p
                className={
                  k.trendUp ? "mt-2 text-xs text-hx-success" : "mt-2 text-xs text-hx-muted"
                }
              >
                {k.trend}
              </p>
            </Card>
          ))}
        </div>

        <Card className="min-h-[320px]">
          <SectionTitle>Load vs success (14d audit rollup)</SectionTitle>
          {hasReportChartData && data?.overloadDay && (
            <p className="mt-1 text-xs text-hx-warning">
              Peak load window: {data.overloadDay}
            </p>
          )}
          {hasReportChartData ? (
            <ClientCharts>
              <div className="mt-4 min-w-0">
                <ReportLineChart data={chartRows} overloadDay={data?.overloadDay} />
              </div>
            </ClientCharts>
          ) : data !== null ? (
            <ul className="mt-3 space-y-2 text-sm">
              <li className="border-b border-hx-border py-2 last:border-0">
                <p className="font-medium text-hx-text">No reports yet</p>
                <p className="mt-1 text-xs text-hx-muted">
                  Activity will appear here once decisions and executions land in your ledger.
                </p>
              </li>
            </ul>
          ) : err ? (
            <p className="mt-3 text-sm text-hx-muted">Chart unavailable until reports load successfully.</p>
          ) : (
            <p className="mt-3 text-sm text-hx-muted">Loading…</p>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionTitle>Under review</SectionTitle>
            <ul className="mt-3 space-y-2 text-sm">
              {(data?.issues.underperformingDecisions?.length
                ? data.issues.underperformingDecisions
                : [{ title: "None", delta: "," }]
              ).map((u, i) => (
                <li key={`${u.title}-${i}`} className="flex justify-between gap-2 border-b border-hx-border py-2 last:border-0">
                  <span className="text-hx-text">{u.title}</span>
                  <span className="shrink-0 text-xs text-hx-muted">{u.delta}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <SectionTitle>Blocked executions</SectionTitle>
            <ul className="mt-3 space-y-2 text-sm">
              {(data?.issues.bottlenecks?.length
                ? data.issues.bottlenecks
                : [{ title: "None", detail: "No blocked tasks in ledger." }]
              ).map((b, i) => (
                <li key={`${b.title}-${i}`} className="border-b border-hx-border py-2 last:border-0">
                  <p className="font-medium text-hx-text">{b.title}</p>
                  <p className="mt-1 text-xs text-hx-muted">{b.detail}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card>
          <SectionTitle>Signal noise</SectionTitle>
          <p className="mt-2 text-sm text-hx-muted">
            Unverified / grace signals:{" "}
            <span className="font-semibold text-hx-accent">
              {data?.issues.signalNoise.unverified ?? ","}
            </span>
          </p>
          <Button
            variant="outlineGold"
            className="mt-4"
            size="sm"
            type="button"
            onClick={() => push("/signals")}
          >
            Open Signals →
          </Button>
        </Card>
      </div>
    </div>
  );
}
