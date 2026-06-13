"use client";

import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Link2,
  Plus,
  Shield,
  User,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DecisionHexTarget } from "@/components/mission/DecisionHexTarget";
import { DashboardHero } from "@/components/shell/DashboardHero";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarkdownText } from "@/components/ui/markdown-text";
import { SectionTitle } from "@/components/ui/section-title";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  capacityStatus as mockCapacity,
  currentDecision as mockDecision,
  executionsSummary as mockExecSummary,
  mcExecutionsTable as mockMcExec,
  mcSignalsPreview as mockMcSig,
} from "@/data/mission-control";
import { HustrionixLogo } from "@/components/shell/HustrionixLogo";
import { apiGet, apiPost } from "@/lib/api";
import { DecisionsPanel } from "@/components/mission/DecisionsPanel";
import type { ExecutionRow } from "@/data/types";
import {
  mapExecution,
  mapSignal,
  type ApiExecution,
  type ApiSignal,
} from "@/lib/mappers";
import { previewText } from "@/lib/preview-text";
import { InspectorPanel } from "@/components/ui/inspector-panel";

const CAPACITY_SCALE_MAX = 150;

type MissionSummary = {
  decision: Record<string, unknown> | null;
  decisionOwner?: { userId: string; displayName: string };
  executionSummary: {
    total: number;
    active: number;
    pending: number;
    blocked: number;
  };
  capacity: {
    capacity: number;
    currentLoad: number;
    loadPct: number;
    owner: string;
  };
  mcExecutions: ApiExecution[];
  signalsPreview: ApiSignal[];
  unverifiedSignalCount: number;
};

const EMPTY_EXEC_SUMMARY: MissionSummary["executionSummary"] = {
  total: 0,
  active: 0,
  pending: 0,
  blocked: 0,
};

const DEFAULT_CAPACITY_LIVE: MissionSummary["capacity"] = {
  capacity: 3,
  currentLoad: 0,
  loadPct: 0,
  owner: "system",
};

/** Deep-link Execute to the tab that matches Mission Control counts (pending work vs active). */
function executeBoardHref(
  execSum: MissionSummary["executionSummary"],
): string {
  if (execSum.active > 0) return "/execute?tab=ACTIVE";
  if (execSum.pending > 0) return "/execute?tab=PENDING";
  if (execSum.blocked > 0) return "/execute?tab=BLOCKED";
  return "/execute";
}

type McTableRow = {
  id: string;
  name: string;
  owner: string;
  initials: string;
  status: "ACTIVE" | "BLOCKED" | "PENDING";
  due: string;
  linked: string;
  detail: ExecutionRow;
};

function mockRowToDetail(row: (typeof mockMcExec)[number]): ExecutionRow {
  return {
    id: row.id,
    task: row.name,
    description: ",",
    owner: row.owner,
    ownerInitials: row.initials,
    weight: 1,
    status: row.status,
    due: row.due,
    dueTone: row.due === "Overdue" ? "overdue" : "ok",
    decision: row.linked,
  };
}

function mcStatusVariant(
  status: ExecutionRow["status"],
): "success" | "danger" | "warning" | "neutral" {
  if (status === "BLOCKED") return "danger";
  if (status === "PENDING") return "warning";
  if (status === "COMPLETED") return "neutral";
  return "success";
}

export default function MissionControlClient() {
  const { push } = useRouter();
  const [summary, setSummary] = useState<MissionSummary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [decPanelRev, setDecPanelRev] = useState(0);
  const [newDecisionOpen, setNewDecisionOpen] = useState(false);
  const [newDecisionVow, setNewDecisionVow] = useState("");
  const [selectedExec, setSelectedExec] = useState<ExecutionRow | null>(null);

  const reloadSummary = useCallback(async () => {
    try {
      const data = await apiGet<MissionSummary>("/api/mission-control/summary");
      setSummary(data);
      setLoadErr(null);
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load summary");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<MissionSummary>("/api/mission-control/summary");
        if (!cancelled) {
          setSummary(data);
          setLoadErr(null);
        }
      } catch (e: unknown) {
        if (!cancelled)
          setLoadErr(e instanceof Error ? e.message : "Failed to load summary");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitNewDecision() {
    const vow = newDecisionVow.trim();
    if (!vow) return;
    try {
      await apiPost("/api/decisions", { vow });
      setNewDecisionOpen(false);
      setNewDecisionVow("");
      setDecPanelRev((n) => n + 1);
      await reloadSummary();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Could not create decision");
    }
  }

  const mockFallback = Boolean(loadErr && !summary);
  const loading = summary === null && loadErr === null;

  const decision = summary?.decision;
  const mockExecWithPending = { ...mockExecSummary, pending: 0 };
  const execSum = mockFallback
    ? mockExecWithPending
    : (summary?.executionSummary ?? EMPTY_EXEC_SUMMARY);

  const capLive = mockFallback
    ? null
    : summary
      ? (summary.capacity ?? DEFAULT_CAPACITY_LIVE)
      : null;

  const decisionTitle = mockFallback
    ? mockDecision.title
    : (decision?.vow as string) || "No decision on record";

  const decisionDescription = (() => {
    if (mockFallback) return mockDecision.description;
    if (!decision) {
      return "Create a decision from Quick Actions or the table below. Executions and capacity are scoped to your account.";
    }
    if (!decision.expected_outcomes) return ",";
    try {
      const j = JSON.parse(String(decision.expected_outcomes));
      return typeof j === "string" ? j : JSON.stringify(j).slice(0, 280);
    } catch {
      return String(decision.expected_outcomes);
    }
  })();

  const rawConf = decision?.confidence != null ? Number(decision.confidence) : null;
  const decisionConfidencePct = mockFallback
    ? mockDecision.confidence
    : rawConf != null && !Number.isNaN(rawConf)
      ? rawConf <= 1
        ? Math.round(rawConf * 100)
        : Math.round(rawConf)
      : 0;

  const decisionStatus = mockFallback
    ? "DRAFT"
    : (decision?.status as string) || "NONE";

  const decisionBadgeVariant =
    decisionStatus === "ACTIVE"
      ? "success"
      : decisionStatus === "DRAFT" || decisionStatus === "UNDER_REVIEW"
        ? "warning"
        : decisionStatus === "NONE"
          ? "warning"
          : "danger";

  const capacityHeadline = mockFallback
    ? mockCapacity.headline
    : !capLive
      ? "…"
      : capLive.loadPct > 100
        ? "OVER CAPACITY"
        : "WITHIN CAPACITY";

  const capacitySub = mockFallback
    ? mockCapacity.sub
    : !capLive
      ? "…"
      : capLive.loadPct > 100
        ? "ACTION REQUIRED"
        : "NOMINAL";

  const capacityLoadPct = mockFallback
    ? mockCapacity.loadPct
    : capLive?.loadPct ?? 0;

  const capacityWarning = mockFallback
    ? mockCapacity.warning
    : !capLive
      ? "Fetching capacity from the server…"
      : `Owner ${capLive.owner}: load ${capLive.currentLoad.toFixed(1)} / capacity ${capLive.capacity.toFixed(1)} (${capacityLoadPct}%).`;

  const activeW =
    execSum.total > 0 ? (execSum.active / execSum.total) * 100 : 0;
  const blockedW =
    execSum.total > 0 ? (execSum.blocked / execSum.total) * 100 : 0;
  const loadBarPct = Math.min(
    (capacityLoadPct / CAPACITY_SCALE_MAX) * 100,
    100,
  );

  const mcTable: McTableRow[] = mockFallback
    ? mockMcExec.map((row) => ({
        id: row.id,
        name: row.name,
        owner: row.owner,
        initials: row.initials,
        status: row.status,
        due: row.due,
        linked: row.linked,
        detail: mockRowToDetail(row),
      }))
    : (summary?.mcExecutions?.length
        ? summary.mcExecutions.map((row) => {
            const m = mapExecution(row);
            const st =
              row.status === "BLOCKED"
                ? ("BLOCKED" as const)
                : row.status === "PENDING"
                  ? ("PENDING" as const)
                  : ("ACTIVE" as const);
            return {
              id: row.task_id,
              name: m.task,
              owner: m.owner,
              initials: m.ownerInitials,
              status: st,
              due: m.due,
              linked: m.decision,
              detail: m,
            };
          })
        : []);

  const sigPrev = mockFallback
    ? mockMcSig
    : (summary?.signalsPreview?.length
        ? summary.signalsPreview.map((s) => {
            const m = mapSignal(s);
            return {
              id: m.id,
              source:
                m.source === "slack"
                  ? ("Slack" as const)
                  : m.source === "github"
                    ? ("GitHub" as const)
                    : m.source === "jira"
                      ? ("Jira" as const)
                      : ("GitHub" as const),
              title: m.title,
              body: m.description,
              remaining: m.expiresLabel,
            };
          })
        : []);

  const unverifiedN = mockFallback ? 5 : (summary?.unverifiedSignalCount ?? 0);

  const metaRows = [
    {
      label: "Owner",
      value: mockFallback
        ? mockDecision.owner
        : loading
          ? "…"
          : summary?.decisionOwner?.displayName ||
            (decision?.user_id as string) ||
            ",",
      icon: User,
    },
    {
      label: "Created",
      value: mockFallback
        ? mockDecision.created
        : decision?.created_at
          ? String(decision.created_at).slice(0, 10)
          : ",",
      icon: Calendar,
    },
    {
      label: "Status",
      value: decisionStatus,
      icon: Shield,
      danger: decisionStatus === "UNDER_REVIEW",
    },
    {
      label: "Decision id",
      value: (decision?.id as string)?.slice(0, 8) || ",",
      icon: Clock,
    },
  ] as const;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-hx-border bg-hx-bg">
      <DashboardHero>
        <PageHeader
          variant="dashboard"
          title="MISSION CONTROL"
          subtitle="Command center for critical decisions and system performance."
        />
        {loading && (
          <p className="mt-3 text-sm text-hx-muted">Loading mission summary…</p>
        )}
        {loadErr && !summary && (
          <p className="mt-3 text-sm text-hx-danger">API: {loadErr} , showing mock data.</p>
        )}
        {loadErr && summary && (
          <p className="mt-3 text-sm text-hx-danger">
            Refresh failed: {loadErr}. Showing last loaded data.
          </p>
        )}
      </DashboardHero>

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto grid max-w-[1680px] gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:grid-rows-[auto_auto_auto_auto] lg:gap-8">
          {/* Current decision */}
          <Card className="flex flex-col p-0 lg:col-start-1 lg:row-start-1" data-tour="mc-summary">
            <div className="flex items-center justify-between gap-2 border-b border-hx-border px-4 py-2.5">
              <SectionTitle className="tracking-[0.2em]">
                Current Decision
              </SectionTitle>
              <Button
                variant="outlineGold"
                size="sm"
                className="shrink-0 gap-2"
                type="button"
                onClick={() => {
                  document
                    .getElementById("mission-decisions-panel")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <ExternalLink className="size-4" />
                View Decision
              </Button>
            </div>
            <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-start">
              <div className="flex shrink-0 justify-center sm:justify-start">
                <DecisionHexTarget className="size-28 sm:h-32 sm:w-32" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="text-xl font-bold leading-tight tracking-tight text-hx-text sm:text-2xl">
                  <MarkdownText variant="inline">{decisionTitle}</MarkdownText>
                </div>
                <MarkdownText muted className="mt-1 text-sm leading-relaxed">
                  {decisionDescription}
                </MarkdownText>
                <div className="flex flex-wrap gap-2 pt-1">
                  <StatusBadge variant={decisionBadgeVariant} dot>
                    {decisionStatus}
                  </StatusBadge>
                  <span className="inline-flex items-center rounded-full border border-hx-accent px-3 py-0.5 text-xs font-semibold text-hx-accent">
                    CONFIDENCE {decisionConfidencePct}%
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-hx-border bg-hx-border sm:grid-cols-4">
              {metaRows.map((row) => (
                <div
                  key={row.label}
                  className="flex flex-col gap-2 bg-hx-surface p-4 sm:flex-row sm:items-center sm:gap-3"
                >
                  <row.icon className="size-4 shrink-0 text-hx-muted" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-hx-muted">
                      {row.label}
                    </div>
                    <div
                      className={
                        "danger" in row && row.danger
                          ? "font-semibold text-hx-danger"
                          : "font-medium text-hx-text"
                      }
                    >
                      {row.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Capacity */}
          <Card className="flex flex-col lg:col-start-2 lg:row-start-1" data-tour="mc-capacity">
            <SectionTitle className="tracking-[0.2em]">
              Capacity Status
            </SectionTitle>
            <p className="mt-4 text-2xl font-bold tracking-tight text-hx-danger sm:text-3xl">
              {capacityHeadline}
            </p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-hx-muted">
              {capacitySub}
            </p>
            <p className="mt-6 text-xs font-medium text-hx-muted">
              Load vs Capacity
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-hx-danger">
              {capacityLoadPct}%
            </p>
            <div className="mt-4">
              <div className="mb-2 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-hx-muted">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
                <span>150%</span>
              </div>
              <div className="h-4 overflow-hidden rounded-full bg-hx-surface-elevated">
                <div
                  className="h-full rounded-full bg-hx-danger"
                  style={{ width: `${loadBarPct}%` }}
                />
              </div>
            </div>
            <div className="mt-5 flex gap-3 rounded-lg border border-hx-danger/35 bg-hx-danger/10 p-4 text-sm leading-snug text-hx-muted">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-hx-danger" />
              <p>{capacityWarning}</p>
            </div>
            <Button
              variant="primary"
              className="mt-6 w-full gap-2 py-3"
              type="button"
              onClick={() => push(executeBoardHref(execSum))}
            >
              <Zap className="size-4" />
              KILL OR ADJUST
            </Button>
          </Card>

          {/* Executions */}
          <Card className="flex flex-col p-0 lg:col-start-1 lg:row-start-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hx-border px-4 py-2.5">
              <div>
                <SectionTitle className="tracking-[0.2em]">
                  Executions Overview
                </SectionTitle>
                <p className="mt-1 text-sm text-hx-muted">
                  {execSum.total} Total Executions
                </p>
              </div>
              <Link
                href={executeBoardHref(execSum)}
                className="text-sm font-semibold text-hx-accent hover:underline"
              >
                View All Executions
              </Link>
            </div>
            <div className="px-5 py-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-hx-surface-elevated">
                <div
                  className="bg-hx-success transition-all"
                  style={{ width: `${activeW}%` }}
                />
                <div
                  className="bg-hx-danger transition-all"
                  style={{ width: `${blockedW}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs font-medium">
                <span className="text-hx-success">
                  {execSum.active} Active
                </span>
                <span className="text-hx-accent">
                  {execSum.pending} Pending
                </span>
                <span className="text-hx-danger">
                  {execSum.blocked} Blocked
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-t border-hx-border bg-hx-surface-elevated/40 text-[10px] font-semibold uppercase tracking-wider text-hx-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Execution</th>
                    <th className="px-5 py-3 font-medium">Owner</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Updated</th>
                    <th className="px-5 py-3 font-medium">Linked To</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hx-border">
                  {mcTable.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-5 py-8 text-center text-sm text-hx-muted"
                      >
                        No executions in ACTIVE, PENDING, or BLOCKED for your account.
                      </td>
                    </tr>
                  )}
                  {mcTable.map((row) => {
                    const rowId = row.id || `${row.name}-${row.owner}-${row.due}`;
                    const isSel = selectedExec?.id === row.id;
                    return (
                    <tr
                      key={rowId}
                      role="button"
                      tabIndex={0}
                      className={`cursor-pointer hover:bg-hx-surface-elevated/25 focus-visible:bg-hx-surface-elevated/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hx-accent/40 ${
                        isSel
                          ? "bg-hx-accent/5 ring-1 ring-inset ring-hx-accent/40"
                          : ""
                      }`}
                      onClick={() => {
                        setSelectedExec((prev) =>
                          prev?.id === row.id ? prev : row.detail,
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedExec((prev) =>
                            prev?.id === row.id ? prev : row.detail,
                          );
                        }
                      }}
                    >
                      <td className="max-w-[min(100vw-12rem,22rem)] px-5 py-2 align-top">
                        <span
                          className="line-clamp-1 font-semibold leading-snug text-hx-text"
                          title={row.name}
                        >
                          {previewText(row.name, 88)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex size-8 items-center justify-center rounded-full bg-hx-accent/15 text-xs font-bold text-hx-accent">
                            {row.initials}
                          </span>
                          <span className="text-hx-text">{row.owner}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge
                          variant={
                            row.status === "BLOCKED"
                              ? "danger"
                              : row.status === "PENDING"
                                ? "warning"
                                : "success"
                          }
                          dot
                        >
                          {row.status}
                        </StatusBadge>
                      </td>
                      <td className="px-5 py-3 text-hx-muted">{row.due}</td>
                      <td className="max-w-[14rem] px-5 py-3 align-top">
                        <div className="flex items-start gap-2">
                          <HustrionixLogo className="mt-0.5 size-5 shrink-0 opacity-90" />
                          <span
                            className="line-clamp-1 text-sm leading-snug text-hx-text"
                            title={row.linked}
                          >
                            {previewText(row.linked, 72)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-hx-border px-5 py-3">
              <Link
                href={executeBoardHref(execSum)}
                className="inline-flex items-center gap-1 text-sm font-semibold text-hx-accent hover:underline"
              >
                View All Executions
                <ChevronRight className="size-4" />
              </Link>
            </div>
          </Card>

          {/* Unverified signals */}
          <Card className="flex flex-col lg:col-start-2 lg:row-start-2" data-tour="mc-signals-preview">
            <div className="flex items-start justify-between gap-2">
              <SectionTitle className="tracking-[0.2em]">
                Unverified Signals
              </SectionTitle>
              <span className="text-xs font-bold text-hx-danger">
                {unverifiedN} Unverified
              </span>
            </div>
            <ul className="mt-5 flex flex-col gap-4">
              {sigPrev.length === 0 && (
                <li className="rounded-lg border border-hx-border border-dashed bg-hx-surface-elevated/20 p-4 text-sm text-hx-muted">
                  No unverified or grace-period signals.
                </li>
              )}
              {sigPrev.map((s) => (
                <li
                  key={"id" in s ? s.id : `${s.source}-${s.title}`}
                  className="rounded-lg border border-hx-border bg-hx-surface-elevated/40 p-4"
                >
                  <div className="text-xs font-bold uppercase tracking-wide text-hx-muted">
                    {s.source}
                  </div>
                  <div className="mt-1 font-semibold text-hx-text">{s.title}</div>
                  <p className="mt-1 text-sm leading-snug text-hx-muted">
                    {s.body}
                  </p>
                  <p className="mt-3 text-xs font-bold text-hx-danger">
                    {s.remaining}
                  </p>
                </li>
              ))}
            </ul>
            <Link
              href="/signals"
              className="mt-5 inline-flex text-sm font-semibold text-hx-accent hover:underline"
            >
              View All Signals
            </Link>
          </Card>

          {/* System alerts / status */}
          {mockFallback || (capLive && capLive.loadPct > 100) ? (
            <Card className="flex flex-wrap items-center gap-4 border-hx-danger/35 bg-hx-danger/[0.06] lg:col-start-1 lg:row-start-3">
              <AlertTriangle className="size-9 shrink-0 text-hx-danger" />
              <div className="min-w-0 flex-1">
                <SectionTitle className="text-hx-danger">System Alerts</SectionTitle>
                <p className="mt-2 text-sm leading-relaxed text-hx-muted">
                  {mockFallback
                    ? "High system load impacting performance. Resolve capacity issues to avoid execution failures."
                    : `Owner ${capLive!.owner} is over capacity (${capLive!.loadPct}% load). Resolve before new executions block.`}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-sm font-bold text-hx-danger hover:underline"
                onClick={() =>
                  push(mockFallback ? "/signals" : executeBoardHref(execSum))
                }
              >
                {mockFallback ? "View Alerts →" : "Open Execute →"}
              </button>
            </Card>
          ) : loading ? (
            <Card className="flex flex-wrap items-center gap-4 border-hx-border/80 bg-hx-surface-elevated/25 lg:col-start-1 lg:row-start-3">
              <Shield className="size-9 shrink-0 text-hx-muted" />
              <div className="min-w-0 flex-1">
                <SectionTitle>System status</SectionTitle>
                <p className="mt-2 text-sm leading-relaxed text-hx-muted">
                  Loading summary…
                </p>
              </div>
            </Card>
          ) : (
            <Card className="flex flex-wrap items-center gap-4 border-hx-border/80 bg-hx-surface-elevated/25 lg:col-start-1 lg:row-start-3">
              <CheckCircle2 className="size-9 shrink-0 text-hx-success" />
              <div className="min-w-0 flex-1">
                <SectionTitle>System status</SectionTitle>
                <p className="mt-2 text-sm leading-relaxed text-hx-muted">
                  Capacity is within limits for the scoped owner. No capacity-driven
                  alerts from the live summary.
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-sm font-semibold text-hx-accent hover:underline"
                onClick={() => push("/signals")}
              >
                View signals →
              </button>
            </Card>
          )}

          {/* Quick actions */}
          <Card className="lg:col-start-2 lg:row-start-3">
            <SectionTitle className="tracking-[0.2em]">Quick Actions</SectionTitle>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button
                variant="outlineGold"
                className="h-auto flex-col gap-2 py-5"
                type="button"
                data-tour="mc-new-decision"
                onClick={() => {
                  setNewDecisionVow("");
                  setNewDecisionOpen(true);
                }}
              >
                <Plus className="size-5" />
                New Decision
              </Button>
              <Button
                variant="outlineGold"
                className="h-auto flex-col gap-2 py-5"
                type="button"
                onClick={() => push("/teams")}
              >
                <Zap className="size-5" />
                Adjust Capacity
              </Button>
              <Button
                variant="outlineGold"
                className="h-auto flex-col gap-2 py-5"
                type="button"
                onClick={() => push(executeBoardHref(execSum))}
              >
                <X className="size-5" />
                Kill Execution
              </Button>
              <Button
                variant="outlineGold"
                className="h-auto flex-col gap-2 py-5"
                type="button"
                onClick={() => push("/signals")}
              >
                <Link2 className="size-5" />
                Link Signal
              </Button>
            </div>
          </Card>

          <div className="lg:col-span-2 lg:col-start-1 lg:row-start-4">
            <DecisionsPanel refreshTrigger={decPanelRev} />
          </div>
        </div>
      </div>
      </div>

      {selectedExec && (
        <InspectorPanel
          label="Task Inspector"
          onClose={() => setSelectedExec(null)}
          className="hidden xl:flex"
        >
          <div className="space-y-6">
            <div>
              <h3 className="break-words text-lg font-bold leading-snug text-hx-text">
                {selectedExec.task}
              </h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-hx-muted">
                {selectedExec.description}
              </p>
              <div className="mt-3">
                <StatusBadge variant={mcStatusVariant(selectedExec.status)} dot>
                  {selectedExec.status}
                </StatusBadge>
              </div>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Owner</dt>
                <dd className="font-medium">{selectedExec.owner}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Weight</dt>
                <dd className="font-mono">{selectedExec.weight}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Last updated</dt>
                <dd className="text-hx-muted">{selectedExec.due}</dd>
              </div>
            </dl>
            <div className="rounded-lg border border-hx-border bg-hx-surface-elevated/50 p-4">
              <SectionTitle>Linked Decision</SectionTitle>
              <div className="mt-3 flex gap-3">
                <HustrionixLogo className="mt-1 size-6 shrink-0" />
                <p className="min-w-0 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-hx-text">
                  {selectedExec.decision}
                </p>
              </div>
            </div>
            <Button
              variant="outlineGold"
              className="w-full gap-2"
              type="button"
              onClick={() => {
                const tab =
                  selectedExec.status === "COMPLETED"
                    ? "COMPLETED"
                    : selectedExec.status;
                push(
                  `/execute?tab=${tab}&task=${encodeURIComponent(selectedExec.id)}`,
                );
              }}
            >
              <ExternalLink className="size-4" />
              Open in Execute
            </Button>
          </div>
        </InspectorPanel>
      )}

      {newDecisionOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="presentation"
          onClick={() => setNewDecisionOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-hx-border bg-hx-surface p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-decision-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="new-decision-title" className="text-lg font-semibold text-hx-text">
              New decision (DRAFT)
            </h2>
            <p className="mt-1 text-sm text-hx-muted">
              One-line vow; you can commit it from the Decisions table below.
            </p>
            <textarea
              className="mt-4 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
              rows={4}
              value={newDecisionVow}
              onChange={(e) => setNewDecisionVow(e.target.value)}
              placeholder="e.g. Reduce churn in SMB segment by tightening onboarding checks"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setNewDecisionOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="button" onClick={() => void submitNewDecision()}>
                Create DRAFT
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
