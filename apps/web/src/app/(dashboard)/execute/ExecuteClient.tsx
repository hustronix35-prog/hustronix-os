"use client";

import { AlertTriangle, MoreVertical } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardHero } from "@/components/shell/DashboardHero";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InspectorPanel } from "@/components/ui/inspector-panel";
import { SectionTitle } from "@/components/ui/section-title";
import { StatusBadge } from "@/components/ui/status-badge";
import { executions as mockExecutions } from "@/data/executions";
import type { ExecutionRow } from "@/data/types";
import { HustrionixLogo } from "@/components/shell/HustrionixLogo";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { mapExecution, type ApiExecution } from "@/lib/mappers";
import { previewText } from "@/lib/preview-text";

const tabs = ["ACTIVE", "BLOCKED", "PENDING", "COMPLETED"] as const;

function dueClass(tone: ExecutionRow["dueTone"]) {
  if (tone === "overdue") return "text-hx-danger font-medium";
  if (tone === "soon") return "text-hx-success font-medium";
  return "text-hx-muted";
}

function statusVariant(s: ExecutionRow["status"]) {
  if (s === "ACTIVE") return "success" as const;
  if (s === "BLOCKED") return "danger" as const;
  if (s === "PENDING") return "warning" as const;
  return "neutral" as const;
}

function matchesTab(raw: ApiExecution, tab: (typeof tabs)[number]): boolean {
  if (tab === "COMPLETED") return raw.status === "DONE" || raw.status === "KILLED";
  return raw.status === tab;
}

type SearchParamGet = (name: string) => string | null;

function parseTabQuery(get: SearchParamGet): (typeof tabs)[number] | null {
  const raw = get("tab")?.trim().toUpperCase();
  if (!raw) return null;
  if (tabs.includes(raw as (typeof tabs)[number])) return raw as (typeof tabs)[number];
  return null;
}

function executionSearchUrl(
  pathname: string,
  tab: string,
  taskId?: string | null,
): string {
  const q = new URLSearchParams();
  q.set("tab", tab);
  const tid = taskId?.trim();
  if (tid) q.set("task", tid);
  return `${pathname}?${q.toString()}`;
}

/** True when `tab` / `task` already match the URL (ignores `from`, etc.). */
function executeRouteMatches(
  get: SearchParamGet,
  tab: string,
  taskId?: string | null,
): boolean {
  const wantTask = (taskId?.trim() ?? "") || "";
  const haveTask = (get("task")?.trim() ?? "") || "";
  return get("tab") === tab && haveTask === wantTask;
}

function replaceExecuteUrlIfNeeded(
  replace: ReturnType<typeof useRouter>["replace"],
  pathname: string,
  get: SearchParamGet,
  tab: string,
  taskId?: string | null,
) {
  if (executeRouteMatches(get, tab, taskId)) return;
  replace(executionSearchUrl(pathname, tab, taskId), { scroll: false });
}

export function ExecuteClient() {
  const { replace, push } = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const getSearchParam = searchParams.get.bind(searchParams);
  const [tab, setTab] = useState<(typeof tabs)[number]>("ACTIVE");
  const [rawRows, setRawRows] = useState<ApiExecution[]>([]);
  const [capacityPct, setCapacityPct] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ExecutionRow | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [dismissFromChatBanner, setDismissFromChatBanner] = useState(false);
  const [storageFromChat, setStorageFromChat] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const [ledger, cap] = await Promise.all([
        apiGet<{ executions: ApiExecution[] }>("/api/execution/ledger?scope=all"),
        apiGet<{ currentLoad: number; capacity: number }>(
          "/api/execution/capacity?owner=system",
        ),
      ]);
      setRawRows(ledger.executions || []);
      const pct =
        cap.capacity > 0 ? Math.round((cap.currentLoad / cap.capacity) * 100) : 0;
      setCapacityPct(pct);
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load executions");
      setRawRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDismissFromChatBanner(false);
    try {
      setStorageFromChat(sessionStorage.getItem("hx_execute_banner_from_chat") === "1");
    } catch {
      setStorageFromChat(false);
    }
  }, [searchParamsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const parsed = parseTabQuery(getSearchParam);
    if (parsed) setTab((prev) => (prev === parsed ? prev : parsed));
  }, [searchParams, searchParamsKey]);

  useEffect(() => {
    if (loading) return;
    if (getSearchParam("task")?.trim()) return;
    if (parseTabQuery(getSearchParam) !== null) return;
    if (rawRows.length === 0) return;
    const order: (typeof tabs)[number][] = [
      "ACTIVE",
      "PENDING",
      "BLOCKED",
      "COMPLETED",
    ];
    for (const t of order) {
      if (rawRows.some((r) => matchesTab(r, t))) {
        setTab(t);
        setSelected(null);
        replaceExecuteUrlIfNeeded(replace, pathname, getSearchParam, t);
        return;
      }
    }
  }, [loading, rawRows, searchParams, searchParamsKey, pathname, replace]);

  function selectTab(t: (typeof tabs)[number]) {
    setTab(t);
    setSelected(null);
    replaceExecuteUrlIfNeeded(replace, pathname, getSearchParam, t);
  }

  const mappedAll = useMemo(() => rawRows.map(mapExecution), [rawRows]);

  const filteredRaw = useMemo(
    () => rawRows.filter((r) => matchesTab(r, tab)),
    [rawRows, tab],
  );

  const display = useMemo(() => {
    const rows = filteredRaw.map(mapExecution);
    return rows.length ? rows : mappedAll.filter((e) => e.status === tab);
  }, [filteredRaw, mappedAll, tab]);

  useEffect(() => {
    if (!rowMenuId) return;
    function close() {
      setRowMenuId(null);
    }
    const t = window.setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", close);
    };
  }, [rowMenuId]);

  /** Never auto-open the inspector; only clear selection if the row disappeared (unless ?task= is set). */
  useEffect(() => {
    if (loading) return;
    if (getSearchParam("task")?.trim()) return;

    setSelected((prev) => {
      if (!prev) return null;
      if (!display.some((r) => r.id === prev.id)) return null;
      return prev;
    });
  }, [display, loading, searchParams, searchParamsKey]);

  /** Open inspector for `/execute?task=<task_id>` (e.g. deep link from Mission Control). */
  useEffect(() => {
    if (loading) return;
    const tid = getSearchParam("task")?.trim();
    if (!tid) return;

    const fromApi = rawRows.find((r) => r.task_id === tid);
    if (fromApi) {
      const mapped = mapExecution(fromApi);
      setTab((prev) => (prev === mapped.status ? prev : mapped.status));
      setSelected((prev) => (prev?.id === mapped.id ? prev : mapped));
      replaceExecuteUrlIfNeeded(replace, pathname, getSearchParam, mapped.status, tid);
      return;
    }

    if (loadErr) {
      const mockRow = mockExecutions.find((r) => r.id === tid);
      if (mockRow) {
        setTab((prev) => (prev === mockRow.status ? prev : mockRow.status));
        setSelected((prev) => (prev?.id === mockRow.id ? prev : mockRow));
        replaceExecuteUrlIfNeeded(replace, pathname, getSearchParam, mockRow.status, tid);
      } else {
        setSelected(null);
        const urlTab = parseTabQuery(getSearchParam) ?? tab;
        replaceExecuteUrlIfNeeded(replace, pathname, getSearchParam, urlTab);
      }
      return;
    }

    setSelected(null);
    const urlTab = parseTabQuery(getSearchParam) ?? tab;
    replaceExecuteUrlIfNeeded(replace, pathname, getSearchParam, urlTab);
  }, [loading, rawRows, loadErr, searchParams, searchParamsKey, pathname, replace, tab]);

  const overCapacity = capacityPct !== null && capacityPct > 100;

  const showFromChatBanner =
    !dismissFromChatBanner &&
    (getSearchParam("from") === "chat" || storageFromChat);

  async function transitionTask(newState: "ACTIVE" | "DONE" | "KILLED") {
    if (!selected) return;
    const raw = rawRows.find((r) => r.task_id === selected.id);
    if (!raw) return;
    try {
      await apiPost("/api/execution/transition", {
        taskId: raw.task_id,
        newState,
        reason: `UI ${newState}`,
      });
      await refresh();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-hx-border bg-hx-bg">
        <DashboardHero>
          <PageHeader
            variant="dashboard"
            className="border-b-0 pb-0"
            title="EXECUTION"
            subtitle="Control and monitor all executions linked to active decisions."
          />
          {loading && !loadErr && (
            <p className="mt-3 text-sm text-hx-muted">Loading executions…</p>
          )}
          {loadErr && (
            <p className="mt-3 text-sm text-hx-danger">
              API: {loadErr} , showing empty tab data.
            </p>
          )}
        </DashboardHero>

        <div className="scrollbar-hide min-h-0 flex-1 space-y-8 overflow-y-auto p-6 lg:p-10">
          {showFromChatBanner ? (
            <Card className="flex flex-wrap items-center gap-3 border-hx-accent/45 bg-hx-accent/10 px-4 py-3">
              <p className="min-w-0 flex-1 text-sm leading-snug text-hx-text">
                <span className="font-semibold text-hx-accent">From Chat</span> , Confirmation was
                sent. Transition tasks below or use the row menu.
              </p>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => {
                  setDismissFromChatBanner(true);
                  try {
                    sessionStorage.removeItem("hx_execute_banner_from_chat");
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Dismiss
              </Button>
            </Card>
          ) : null}
          {overCapacity && (
            <Card className="flex flex-wrap items-center gap-4 border-hx-danger/50 bg-hx-danger/10">
              <AlertTriangle className="size-8 text-hx-danger" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-hx-danger">
                  SYSTEM OVER CAPACITY , RESOLUTION REQUIRED
                </p>
                <p className="mt-1 text-sm text-hx-muted">
                  Load is {capacityPct}% of capacity for owner{" "}
                  <span className="font-mono">system</span>. Kill or adjust executions
                  to restore stability.
                </p>
              </div>
              <Link
                href="/mission-control"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-hx-danger px-4 py-2 text-sm font-medium text-hx-danger transition hover:bg-hx-danger/10"
              >
                Go to Mission Control →
              </Link>
            </Card>
          )}

          <SegmentTabs
            data-tour="exec-tabs"
            value={tab}
            onChange={selectTab}
            items={tabs.map((t) => ({ value: t, label: t }))}
          />

          <Card className="overflow-hidden p-0" data-tour="exec-task-list">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="border-b border-hx-border bg-hx-surface-elevated/50 text-xs uppercase tracking-wide text-hx-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Task</th>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Weight</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 font-medium">Decision</th>
                    <th className="px-4 py-3" aria-label="Row actions" />
                  </tr>
                </thead>
                <tbody>
                  {(loading ? mockExecutions.filter((e) => e.status === tab) : display).map(
                    (row) => {
                      const isSel = selected?.id === row.id;
                      return (
                        <tr
                          key={row.id}
                          onClick={() => {
                            setSelected((prev) =>
                              prev?.id === row.id ? prev : row,
                            );
                            replaceExecuteUrlIfNeeded(
                              replace,
                              pathname,
                              getSearchParam,
                              tab,
                              row.id,
                            );
                          }}
                          className={`cursor-pointer border-b border-hx-border transition hover:bg-hx-surface-elevated/40 ${
                            isSel
                              ? "bg-hx-accent/5 ring-1 ring-inset ring-hx-accent/40"
                              : ""
                          } ${row.status === "BLOCKED" ? "border-l-4 border-l-hx-danger" : ""}`}
                        >
                          <td className="max-w-[min(22rem,36vw)] px-4 py-3 align-top">
                            <div
                              className="line-clamp-2 font-semibold leading-snug text-hx-text"
                              title={row.task}
                            >
                              {previewText(row.task, 140)}
                            </div>
                            <div
                              className="mt-1 line-clamp-2 text-xs leading-snug text-hx-muted"
                              title={row.description}
                            >
                              {previewText(row.description, 110)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="flex size-8 items-center justify-center rounded-full bg-hx-accent/15 text-xs font-bold text-hx-accent">
                                {row.ownerInitials}
                              </span>
                              <span>{row.owner}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded border border-hx-border bg-hx-surface-elevated px-2 py-1 font-mono text-xs">
                              {row.weight}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge variant={statusVariant(row.status)} dot>
                              {row.status}
                            </StatusBadge>
                          </td>
                          <td className={`px-4 py-3 ${dueClass(row.dueTone)}`}>
                            {row.due}
                          </td>
                          <td className="max-w-[14rem] px-4 py-3 align-top">
                            <div className="flex items-start gap-2 text-hx-muted">
                              <HustrionixLogo className="mt-0.5 size-4 shrink-0 opacity-80" />
                              <span
                                className="line-clamp-2 text-sm leading-snug text-hx-text"
                                title={row.decision}
                              >
                                {previewText(row.decision, 96)}
                              </span>
                            </div>
                          </td>
                          <td className="relative px-4 py-3 text-right">
                            <button
                              type="button"
                              className="rounded p-1 text-hx-muted hover:bg-hx-surface-elevated"
                              aria-expanded={rowMenuId === row.id}
                              aria-haspopup="menu"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRowMenuId((id) => (id === row.id ? null : row.id));
                              }}
                            >
                              <MoreVertical className="size-4" />
                            </button>
                            {rowMenuId === row.id && (
                              <div
                                role="menu"
                                className="absolute right-2 top-full z-20 mt-1 w-52 rounded-lg border border-hx-border bg-hx-surface py-1 text-left text-sm shadow-xl"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-3 py-2 text-left hover:bg-hx-surface-elevated"
                                  onClick={() => {
                                    setSelected((prev) =>
                                      prev?.id === row.id ? prev : row,
                                    );
                                    setRowMenuId(null);
                                    replaceExecuteUrlIfNeeded(
                                      replace,
                                      pathname,
                                      getSearchParam,
                                      tab,
                                      row.id,
                                    );
                                  }}
                                >
                                  Open in inspector
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-3 py-2 text-left hover:bg-hx-surface-elevated"
                                  onClick={() => {
                                    setRowMenuId(null);
                                    void refresh();
                                  }}
                                >
                                  Refresh ledger
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-3 py-2 text-left hover:bg-hx-surface-elevated"
                                  onClick={() => {
                                    setRowMenuId(null);
                                    push("/mission-control#mission-decisions-panel");
                                  }}
                                >
                                  Mission Control
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hx-border px-4 py-3 text-xs text-hx-muted">
              <span>
                {loading
                  ? "Loading…"
                  : `Showing ${display.length} execution(s) (${tab})`}
              </span>
              <button
                type="button"
                className="font-medium text-hx-accent hover:underline"
                onClick={() => void refresh()}
              >
                Refresh
              </button>
            </div>
          </Card>
        </div>
      </div>

      {selected && (
        <InspectorPanel
          label="Task Inspector"
          onClose={() => {
            setSelected(null);
            replaceExecuteUrlIfNeeded(replace, pathname, getSearchParam, tab);
          }}
          className="hidden xl:flex"
        >
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold leading-snug text-hx-text break-words">
                {selected.task}
              </h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-hx-muted">
                {selected.description}
              </p>
              <div className="mt-3">
                <StatusBadge variant={statusVariant(selected.status)} dot>
                  {selected.status}
                </StatusBadge>
              </div>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Owner</dt>
                <dd className="font-medium">{selected.owner}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Weight</dt>
                <dd className="font-mono">{selected.weight}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Last updated</dt>
                <dd className={dueClass(selected.dueTone)}>{selected.due}</dd>
              </div>
            </dl>
            <div className="rounded-lg border border-hx-border bg-hx-surface-elevated/50 p-4">
              <SectionTitle>Linked Decision</SectionTitle>
              <div className="mt-3 flex gap-3">
                <HustrionixLogo className="mt-1 size-6 shrink-0" />
                <p className="min-w-0 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-hx-text">
                  {selected.decision}
                </p>
              </div>
            </div>
            <div data-tour="exec-transition" className="flex flex-col gap-3">
              <Button
                variant="outlineGold"
                className="w-full"
                type="button"
                onClick={() => void transitionTask("ACTIVE")}
              >
                Activate
              </Button>
              <Button
                variant="outlineGold"
                className="w-full"
                type="button"
                onClick={() => void transitionTask("DONE")}
              >
                Mark Done
              </Button>
              <Button
                variant="dangerOutline"
                className="w-full"
                type="button"
                onClick={() => void transitionTask("KILLED")}
              >
                Kill Execution
              </Button>
            </div>
          </div>
        </InspectorPanel>
      )}
    </div>
  );
}
