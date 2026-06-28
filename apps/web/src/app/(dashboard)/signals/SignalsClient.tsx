"use client";

import {
  Bell,
  Filter,
  Link2,
  Network,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  GraceCountdownRing,
  GraceCountdownText,
} from "@/components/ui/grace-countdown-ring";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  GitHubIcon,
  JiraIcon,
  ManualSignalIcon,
  SlackIcon,
} from "@/components/icons/brand-icons";
import { signalsUnverified } from "@/data/signals";
import { signalInspectorDetail } from "@/data/signals";
import type { Signal, SignalSource } from "@/data/types";
import { DashboardHero } from "@/components/shell/DashboardHero";
import { PageHeader } from "@/components/shell/PageHeader";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { cn } from "@/lib/cn";
import { apiGet, apiPost } from "@/lib/api";
import { fetchIntegrationsHealth, type IntegrationHealth } from "@/lib/integrations-health";
import { mapSignal, type ApiExecution, type ApiSignal } from "@/lib/mappers";

type TabId = "unverified" | "linked" | "killed";

function BrandSourceIcon({
  source,
  className,
}: {
  source: SignalSource;
  className?: string;
}) {
  switch (source) {
    case "slack":
      return <SlackIcon className={className} />;
    case "github":
      return <GitHubIcon className={className} />;
    case "jira":
      return <JiraIcon className={className} />;
    default:
      return <ManualSignalIcon className={className} />;
  }
}

function sourceLabel(source: SignalSource): string {
  if (source === "slack") return "Slack";
  if (source === "github") return "GitHub";
  if (source === "jira") return "Jira";
  return "Manual";
}

function tabDetailBadge(tab: TabId): string {
  if (tab === "unverified") return "UNVERIFIED";
  if (tab === "linked") return "LINKED";
  return "KILLED";
}

type CapRow = { id: string; name: string; status: string; description: string };

function healthToCapRows(providers: IntegrationHealth[]): CapRow[] {
  return providers.map((p) => ({
    id: p.provider,
    name: p.label,
    status: p.connected ? (p.needsReauth ? "NEEDS_REAUTH" : "CONNECTED") : "DISCONNECTED",
    description: p.connected
      ? `${p.signalCount24h} signals (24h)`
      : "Not connected — open Settings → Connections",
  }));
}

export function SignalsClient() {
  const { push } = useRouter();
  const [tab, setTab] = useState<TabId>("unverified");
  const [counts, setCounts] = useState({ unverified: 0, linked: 0, killed: 0 });
  const [rows, setRows] = useState<Signal[]>(signalsUnverified);
  const [selected, setSelected] = useState<Signal | null>(signalsUnverified[0] ?? null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [apiRows, setApiRows] = useState<ApiSignal[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<CapRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SignalSource | "all" | "other">(
    "all",
  );
  const [activityPreview, setActivityPreview] = useState<
    { action: string; reason: string; timestamp: string }[]
  >([]);
  const [liveSignals, setLiveSignals] = useState(false);
  const [linkModalSig, setLinkModalSig] = useState<Signal | null>(null);
  const [pickedTaskId, setPickedTaskId] = useState("");
  const [execRows, setExecRows] = useState<ApiExecution[]>([]);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [decisionVowDraft, setDecisionVowDraft] = useState("");

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const data = await apiGet<{
        signals: ApiSignal[];
        counts: { unverified: number; linked: number; killed: number };
      }>(`/api/execution/signals/by-state?tab=${tab}`);
      setCounts(data.counts);
      const signals = data.signals || [];
      setApiRows(signals);
      const mapped = signals.map(mapSignal);
      setRows(mapped);
      setLiveSignals(true);
      setSelected((prev) => {
        if (mapped.length) {
          const still = mapped.find((s) => s.id === prev?.id);
          return still ?? mapped[0]!;
        }
        return null;
      });
    } catch (e: unknown) {
      setLiveSignals(false);
      setLoadErr(e instanceof Error ? e.message : "Failed to load signals");
      setRows(signalsUnverified);
      setCounts({ unverified: 5, linked: 12, killed: 8 });
      setApiRows([]);
      setSelected(signalsUnverified[0] ?? null);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadCapabilities = useCallback(async () => {
    try {
      const data = await fetchIntegrationsHealth();
      setCapabilities(healthToCapRows(data.providers || []));
    } catch {
      setCapabilities([]);
    }
  }, []);

  const loadActivityPreview = useCallback(async () => {
    try {
      const data = await apiGet<{
        activity: { action: string; reason: string; timestamp: string }[];
      }>("/api/activity?limit=8");
      setActivityPreview(data.activity || []);
    } catch {
      setActivityPreview([]);
    }
  }, []);

  useEffect(() => {
    if (sourcesOpen) void loadCapabilities();
  }, [sourcesOpen, loadCapabilities]);

  useEffect(() => {
    if (notifOpen) void loadActivityPreview();
  }, [notifOpen, loadActivityPreview]);

  useEffect(() => {
    if (!linkModalSig) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{ executions: ApiExecution[] }>(
          "/api/execution/ledger?scope=all",
        );
        if (!cancelled) setExecRows(data.executions || []);
      } catch {
        if (!cancelled) setExecRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linkModalSig]);

  function isPersistedSignal(sig: Signal | null): boolean {
    if (!sig) return false;
    return apiRows.some((r) => r.id === sig.id);
  }

  function openLinkModal(sig: Signal) {
    setSelected(sig);
    if (!isPersistedSignal(sig)) {
      window.alert(
        "These rows are offline demos , your API returned no signals or failed to load. Link/Kill need real IDs from the ledger.",
      );
      return;
    }
    setPickedTaskId("");
    setExecRows([]);
    setLinkModalSig(sig);
  }

  async function confirmLinkSignal() {
    if (!linkModalSig || !pickedTaskId.trim()) return;
    const raw = apiRows.find((r) => r.id === linkModalSig.id);
    if (!raw) return;
    try {
      await apiPost("/api/execution/link", {
        signalId: raw.id,
        taskId: pickedTaskId.trim(),
      });
      setLinkModalSig(null);
      await load();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function killSignal(sig: Signal, label: string) {
    if (!isPersistedSignal(sig)) {
      window.alert(
        "Cannot kill a demo placeholder , load live signals from the API first.",
      );
      return;
    }
    const raw = apiRows.find((r) => r.id === sig.id)!;
    if (
      !window.confirm(`${label} , mark this signal as KILLED in the ledger?`)
    )
      return;
    try {
      await apiPost("/api/execution/signals/kill", { signalId: raw.id });
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  function openDecisionModal() {
    setDecisionVowDraft(selected?.title?.slice(0, 240) || "");
    setDecisionModalOpen(true);
  }

  async function submitDecisionFromSignal() {
    const vow = decisionVowDraft.trim();
    if (!vow) return;
    try {
      await apiPost("/api/decisions", { vow });
      setDecisionModalOpen(false);
      push("/mission-control#mission-decisions-panel");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const tabs = [
    { id: "unverified" as const, label: "UNVERIFIED", count: counts.unverified },
    { id: "linked" as const, label: "LINKED", count: counts.linked },
    { id: "killed" as const, label: "KILLED", count: counts.killed },
  ];

  const filteredRows = useMemo(() => {
    if (sourceFilter === "all") return rows;
    if (sourceFilter === "other") {
      return rows.filter(
        (r) => !["slack", "github", "jira"].includes(r.source),
      );
    }
    return rows.filter((r) => r.source === sourceFilter);
  }, [rows, sourceFilter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-hx-bg">
      <div className="flex min-w-0 flex-1 flex-col border-r border-hx-border bg-hx-bg">
        <DashboardHero>
          <PageHeader
            variant="dashboard"
            className="border-b-0 pb-0"
            title="SIGNALS"
            subtitle="Real-world activity. Awaiting validation."
            trailingActions={
              <div className="relative flex flex-shrink-0 flex-wrap items-center justify-end gap-2 lg:flex-nowrap lg:gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-2"
                    type="button"
                    onClick={() => setSourcesOpen((o) => !o)}
                  >
                    <Network className="size-4" />
                    Signal Sources
                  </Button>
                  {sourcesOpen && (
                    <div className="absolute right-0 top-full z-40 mt-2 w-[min(100vw-2rem,360px)] rounded-lg border border-hx-border bg-hx-surface p-4 shadow-xl">
                      <p className="text-xs font-bold uppercase tracking-wide text-hx-muted">
                        Ingestion capabilities
                      </p>
                      <ul className="scrollbar-hide mt-3 max-h-56 space-y-2 overflow-y-auto text-sm">
                        {capabilities.length === 0 ? (
                          <li className="text-hx-muted">No connection metadata.</li>
                        ) : (
                          capabilities.map((c) => (
                            <li key={c.id} className="rounded border border-hx-border px-3 py-2">
                              <span className="font-medium text-hx-text">{c.name}</span>
                              <span className="ml-2 text-xs text-hx-muted">{c.status}</span>
                              <p className="mt-1 text-xs text-hx-muted">{c.description}</p>
                            </li>
                          ))
                        )}
                      </ul>
                      <Button
                        variant="outlineGold"
                        size="sm"
                        className="mt-3 w-full"
                        type="button"
                        onClick={() => {
                          setSourcesOpen(false);
                          push("/settings?tab=connections");
                        }}
                      >
                        Manage connections
                      </Button>
                    </div>
                  )}
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-hx-border bg-transparent text-hx-muted transition hover:border-hx-accent/40 hover:bg-hx-accent/10 hover:text-hx-text"
                      aria-label="Notifications"
                      aria-expanded={notifOpen}
                      onClick={() => setNotifOpen((o) => !o)}
                    >
                      <Bell className="size-4" />
                      <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-hx-accent px-1 text-[10px] font-bold text-[#0a0a0a]">
                        {counts.unverified > 99 ? "99+" : counts.unverified || "0"}
                      </span>
                    </button>
                    {notifOpen && (
                      <div className="absolute right-0 top-full z-40 mt-2 w-[min(100vw-2rem,320px)] rounded-lg border border-hx-border bg-hx-surface p-3 shadow-xl">
                        <p className="text-xs font-semibold text-hx-muted">Recent ledger activity</p>
                        <ul className="scrollbar-hide mt-2 max-h-48 space-y-2 overflow-y-auto text-xs">
                          {activityPreview.length === 0 ? (
                            <li className="text-hx-muted">No rows.</li>
                          ) : (
                            activityPreview.map((a, i) => (
                              <li key={`${a.timestamp}-${i}`} className="border-b border-hx-border pb-2 last:border-0">
                                <span className="font-medium text-hx-text">{a.action}</span>
                                <p className="text-hx-muted">{a.reason?.slice(0, 100)}</p>
                                <p className="mt-0.5 text-[10px] text-hx-muted">{a.timestamp}</p>
                              </li>
                            ))
                          )}
                        </ul>
                        <Link
                          href="/profile"
                          className="mt-2 block text-center text-xs font-semibold text-hx-accent hover:underline"
                          onClick={() => setNotifOpen(false)}
                        >
                          Full activity →
                        </Link>
                      </div>
                    )}
                  </div>
                  <Button
                    variant={filterOpen ? "outlineGold" : "outline"}
                    size="sm"
                    className="shrink-0 gap-2"
                    type="button"
                    onClick={() => setFilterOpen((o) => !o)}
                  >
                    <Filter className="size-4" />
                    Filter
                  </Button>
                </div>
              }
            />
            {loadErr && (
              <p className="mt-3 text-sm text-hx-danger">
                API: {loadErr} , showing reference mocks.
              </p>
            )}
            {!liveSignals && (
              <p className="mt-3 rounded-lg border border-hx-warning/40 bg-hx-warning/10 px-3 py-2 text-xs text-hx-warning">
                Offline demo mode: Link / Kill / Ignore only work on{" "}
                <strong className="text-hx-text">live API rows</strong>. Fix auth or seed signals,
                then refresh.
              </p>
            )}
        </DashboardHero>

        <div className="scrollbar-hide min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-8 lg:px-10 lg:py-10">
          {filterOpen && (
            <div className="flex flex-wrap gap-2 rounded-lg border border-hx-border bg-hx-surface-elevated/40 p-3">
              <span className="mr-2 self-center text-xs font-semibold uppercase text-hx-muted">
                Source
              </span>
              {(["all", "slack", "github", "jira", "other"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    sourceFilter === s
                      ? "border-hx-accent bg-hx-accent/15 text-hx-accent"
                      : "border-hx-border text-hx-muted hover:border-hx-accent/40 hover:text-hx-text",
                  )}
                  onClick={() => setSourceFilter(s)}
                >
                  {s === "all" ? "All" : s === "other" ? "Other" : s}
                </button>
              ))}
            </div>
          )}
          <SegmentTabs
            data-tour="sig-tabs"
            value={tab}
            onChange={setTab}
            items={tabs.map((t) => ({
              value: t.id,
              label: `${t.label} (${t.count})`,
            }))}
          />

          <div className="flex flex-col gap-4">
            {liveSignals && filteredRows.length === 0 && (
              <p className="rounded-lg border border-hx-border bg-hx-surface-elevated/40 px-4 py-8 text-center text-sm text-hx-muted">
                No signals in this tab. Try another tab or ingest integrations.
              </p>
            )}
            {filteredRows.map((sig) => {
              const isSel = selected?.id === sig.id;
              const displayChannel =
                sig.source === "slack" && sig.channel
                  ? `${sourceLabel(sig.source)} ${sig.channel}`
                  : sig.source === "github" && sig.channel
                    ? `${sourceLabel(sig.source)} · ${sig.channel}`
                    : sig.source === "jira" && sig.channel
                      ? `${sourceLabel(sig.source)} ${sig.channel}`
                      : sourceLabel(sig.source);

              return (
                <article
                  key={sig.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(sig)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(sig);
                    }
                  }}
                  className={cn(
                    "cursor-pointer rounded-xl border bg-[#0d0d0d] p-4 transition",
                    isSel
                      ? "border-hx-accent shadow-[0_0_0_1px_rgba(212,175,55,0.35)]"
                      : "border-hx-border hover:border-hx-border-subtle",
                  )}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 flex-1 gap-4">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-hx-surface-elevated">
                        <BrandSourceIcon source={sig.source} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-hx-muted">
                          <span className="font-medium text-hx-text/90">
                            {displayChannel}
                          </span>
                          {sig.author && (
                            <>
                              <span className="mx-1.5 text-hx-border">·</span>
                              <span>{sig.author}</span>
                            </>
                          )}
                        </p>
                        <h2 className="mt-1 text-base font-semibold leading-snug text-hx-text">
                          {sig.title}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-hx-muted">
                          {sig.description}
                        </p>
                        {sig.categoryTag && (
                          <span className="mt-2 inline-flex rounded-md border border-hx-border bg-hx-surface px-2 py-0.5 text-[11px] font-medium text-hx-muted">
                            {sig.categoryTag}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-4 lg:gap-6">
                      <GraceCountdownRing
                        detectedAt={sig.detectedAt}
                        graceEndsAt={sig.graceEndsAt}
                        fallbackLabel={sig.expiresLabel}
                        urgent={sig.urgent}
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Button
                          variant="outlineGold"
                          size="sm"
                          className="gap-2 whitespace-nowrap"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(sig);
                            openLinkModal(sig);
                          }}
                        >
                          <Link2 className="size-3.5" />
                          Link to Decision
                        </Button>
                        <button
                          type="button"
                          className="text-sm font-medium text-hx-muted underline-offset-4 hover:text-hx-text hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            void killSignal(sig, "Ignore");
                          }}
                        >
                          Ignore
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="text-xs text-hx-muted">
            Showing {filteredRows.length} of {rows.length} signals
            {sourceFilter !== "all" ? ` (filter: ${sourceFilter})` : ""}
          </p>
        </div>
      </div>

      {selected && (
        <aside className="hidden w-full max-w-[420px] shrink-0 flex-col border-l border-hx-border bg-hx-surface lg:flex">
          <div className="flex items-center justify-between border-b border-hx-border px-4 py-2.5">
            <h2 className="text-xs font-bold tracking-[0.14em] text-hx-text">
              SIGNAL DETAILS
            </h2>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded p-1 text-hx-muted hover:bg-hx-surface-elevated hover:text-hx-text"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="scrollbar-hide flex-1 space-y-6 overflow-y-auto p-5 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <BrandSourceIcon source={selected.source} />
              <span className="font-semibold capitalize text-hx-text">
                {sourceLabel(selected.source)}
              </span>
              <StatusBadge variant="accent" className="text-[10px] font-bold tracking-wide">
                {tabDetailBadge(tab)}
              </StatusBadge>
            </div>

            <div>
              <h3 className="text-lg font-bold leading-snug text-hx-text">
                {selected.title}
              </h3>
              <p className="mt-2 leading-relaxed text-hx-muted">
                {selected.description}
              </p>
            </div>

            <dl className="space-y-3 border-t border-hx-border pt-4">
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Source</dt>
                <dd className="text-right font-medium text-hx-text">
                  {selected.author ?? selected.workspace ?? ","}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Received</dt>
                <dd className="text-right font-medium text-hx-text">
                  {selected.received}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-hx-muted">Grace Window</dt>
                <dd className="text-right">
                  <GraceCountdownText
                    detectedAt={selected.detectedAt}
                    graceEndsAt={selected.graceEndsAt}
                    fallbackLabel={selected.expiresLabel}
                    urgent={selected.urgent}
                  />
                </dd>
              </div>
            </dl>

            <div className="rounded-xl border border-hx-border bg-[#0d0d0d] p-4">
              <div className="flex gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hx-accent/15">
                  <Target className="size-5 text-hx-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-hx-muted">
                    Suggested link
                  </p>
                  <p className="mt-1 font-semibold text-hx-text">
                    {signalInspectorDetail.suggestedTitle}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-hx-muted">
                    {signalInspectorDetail.suggestedDescription}
                  </p>
                  <button
                    type="button"
                    className="mt-3 text-sm font-semibold text-hx-accent hover:underline"
                    onClick={() => {
                      push("/mission-control#mission-decisions-panel");
                    }}
                  >
                    View Decision →
                  </button>
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              size="lg"
              className="w-full gap-2 font-semibold"
              type="button"
              data-tour="sig-link"
              onClick={() => selected && openLinkModal(selected)}
            >
              <Link2 className="size-4" />
              Link to Decision
            </Button>

            <Button
              variant="outlineGold"
              size="md"
              className="w-full gap-2 border-hx-accent bg-transparent"
              type="button"
              onClick={() => openDecisionModal()}
            >
              <Plus className="size-4" />
              Create New Decision
            </Button>

            <Button
              variant="dangerOutline"
              size="md"
              className="w-full gap-2"
              type="button"
              data-tour="sig-kill"
              disabled={selected ? !isPersistedSignal(selected) : true}
              title={
                selected && !isPersistedSignal(selected)
                  ? "Select a live signal from the API"
                  : undefined
              }
              onClick={() => selected && void killSignal(selected, "Kill signal")}
            >
              <Trash2 className="size-4" />
              Kill Signal
            </Button>
          </div>
        </aside>
      )}

      {linkModalSig && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="presentation"
          onClick={() => setLinkModalSig(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-hx-border bg-hx-surface p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-signal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="link-signal-title" className="text-lg font-semibold text-hx-text">
              Link signal to execution
            </h2>
            <p className="mt-1 text-xs text-hx-muted">
              Pick a task from your ledger. IDs refresh when you open this dialog.
            </p>
            <label htmlFor="link-signal-task" className="mt-4 block text-xs font-medium text-hx-muted">
              Execution task
            </label>
            <select
              id="link-signal-task"
              className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text"
              value={pickedTaskId}
              onChange={(e) => setPickedTaskId(e.target.value)}
            >
              <option value="">Select task…</option>
              {execRows.map((e) => (
                <option key={e.task_id} value={e.task_id}>
                  {(e.decision_vow || "Task").slice(0, 48)} · {e.status} ·{" "}
                  {e.task_id.slice(0, 8)}…
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setLinkModalSig(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="button"
                disabled={!pickedTaskId}
                onClick={() => void confirmLinkSignal()}
              >
                Link
              </Button>
            </div>
          </div>
        </div>
      )}

      {decisionModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="presentation"
          onClick={() => setDecisionModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-hx-border bg-hx-surface p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sig-decision-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="sig-decision-title" className="text-lg font-semibold text-hx-text">
              Create decision from signal
            </h2>
            <textarea
              className="mt-4 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
              rows={4}
              value={decisionVowDraft}
              onChange={(e) => setDecisionVowDraft(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setDecisionModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="button" onClick={() => void submitDecisionFromSignal()}>
                Create DRAFT
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
