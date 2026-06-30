"use client";

import {
  Download,
  FileUp,
  Filter,
  Info,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientCharts } from "@/components/charts/ClientCharts";
import { TeamsBarChart } from "@/components/charts/TeamsBarChart";
import { TeamsDonut } from "@/components/charts/TeamsDonut";
import { DashboardHero } from "@/components/shell/DashboardHero";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import type { TeamMember } from "@/data/types";
import type { PredictionExplanation } from "@hustronix/shared";
import { TeamsEditMemberModal, TeamsImportModal } from "@/components/teams/TeamsRosterModals";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { ROLE_OPTIONS, TALENT_TIER_OPTIONS } from "@/lib/team-roster";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

/** Legacy local-only roster; migrated once to `POST /api/metrics/teams/roster`. */
const LEGACY_STORAGE_KEY = "hustronix_teams_extra_members";

const EMPTY_METRICS = {
  members: 0,
  membersNote: "Loading…",
  utilization: 0,
  utilTrend: ",",
  atRisk: 0,
  overCapacity: 0,
} as const;

const EMPTY_DONUT = {
  total: 0,
  used: 0,
  usedPct: 0,
  available: 0,
  availablePct: 0,
  over: 0,
  overPct: 0,
} as const;

const tabs = ["Overview", "Capacity", "Workload", "Performance"] as const;
type TeamsTab = (typeof tabs)[number];

function memberStatusVariant(s: TeamMember["status"]) {
  if (s === "Healthy") return "success" as const;
  if (s === "At Risk") return "warning" as const;
  return "danger" as const;
}

type TeamsPayload = {
  metrics: typeof EMPTY_METRICS & {
    budgetSource?: "settings_total" | "owner_reputation_sum";
    aggregateBudget?: number;
  };
  members: TeamMember[];
  donut: typeof EMPTY_DONUT;
  deptBars: { dept: string; pct: number }[];
  insights: string[];
};

function loadStoredExtras(): TeamMember[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TeamMember[]) : [];
  } catch {
    return [];
  }
}

function downloadMembersCsv(rows: TeamMember[]) {
  const headers = [
    "Owner",
    "Email",
    "Slack",
    "Role",
    "Level",
    "Scope",
    "Capacity",
    "LoadPct",
    "Utilization",
    "Status",
  ];
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((m) =>
      [
        m.name,
        m.email,
        m.slackId ?? "",
        m.role,
        m.talentTier ?? "",
        m.team,
        m.capacity,
        String(m.loadPct),
        String(m.utilization),
        m.status,
      ]
        .map(esc)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `teams-owners-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function isRosterRemovable(m: TeamMember) {
  return m.canRemove === true;
}

function isLedgerOwner(m: TeamMember) {
  return m.id.startsWith("ledger:") || m.intelligenceAdvisory === true;
}

function BeliefBar({ mean, confidence }: { mean: number; confidence: number }) {
  const pct = Math.round(mean * 100);
  const band = Math.round((1 - confidence) * 50);
  return (
    <div className="min-w-[100px]" title={`μ=${mean.toFixed(2)} ±${(1 - confidence).toFixed(2)}`}>
      <div className="relative h-2 overflow-hidden rounded-full bg-hx-surface-elevated">
        <div
          className="absolute inset-y-0 rounded-full bg-hx-accent/30"
          style={{ left: `${Math.max(0, pct - band)}%`, width: `${Math.min(100, band * 2)}%` }}
        />
        <div className="h-full rounded-full bg-hx-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-[10px] text-hx-muted">{pct}%</p>
    </div>
  );
}

function OwnerIntelligenceDrawer({
  member,
  onClose,
}: {
  member: TeamMember;
  onClose: () => void;
}) {
  const ownerSlug = member.id.replace(/^ledger:/, "");
  const [predictions, setPredictions] = useState<
    { explanation: PredictionExplanation[]; predictionType: string; predictedValue: number; confidence: number }[]
  >([]);
  const [profile, setProfile] = useState<{
    beliefs?: TeamMember["beliefs"];
    derivedCapacity?: TeamMember["derivedCapacity"];
    loadCurve?: { bucket: string; successRate: number }[];
    recentEvidence?: { eventType: string; observedAt: string }[];
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [predRes, profRes] = await Promise.all([
          apiGet<{ predictions: { explanation: PredictionExplanation[]; predictionType: string; predictedValue: number; confidence: number }[] }>(
            `/api/intelligence/entities/person/${encodeURIComponent(ownerSlug)}/predictions?limit=5`,
          ),
          apiGet<{
            beliefs: TeamMember["beliefs"];
            derivedCapacity: TeamMember["derivedCapacity"] & { loadCurve?: { bucket: string; successRate: number }[] };
            recentEvidence: { eventType: string; observedAt: string }[];
          }>(`/api/owners/${encodeURIComponent(ownerSlug)}/profile`),
        ]);
        setPredictions(predRes.predictions ?? []);
        setProfile({
          beliefs: profRes.beliefs,
          derivedCapacity: profRes.derivedCapacity,
          loadCurve: profRes.derivedCapacity?.loadCurve,
          recentEvidence: profRes.recentEvidence,
        });
      } catch {
        setProfile(null);
      }
    })();
  }, [ownerSlug]);

  const beliefs = profile?.beliefs ?? member.beliefs ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="scrollbar-hx h-full w-full max-w-md overflow-y-auto border-l border-hx-border bg-hx-surface p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{member.name}</h2>
            <p className="text-xs text-hx-muted">Execution intelligence (advisory)</p>
          </div>
          <button type="button" className="text-hx-muted hover:text-hx-text" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <p className="mt-3 rounded-md border border-hx-border bg-hx-surface-elevated/50 p-2 text-xs text-hx-muted">
          Advisory intelligence — enforcement still uses legacy owner reputation capacity.
        </p>
        {member.derivedCapacity && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase text-hx-muted">Derived capacity</p>
            <p className="mt-1 text-2xl font-bold text-hx-accent">
              {member.derivedCapacity.value.toFixed(1)} wt
            </p>
            <p className="text-xs text-hx-muted">
              Legacy: {member.legacyCapacity?.toFixed(1) ?? "—"} wt · confidence{" "}
              {Math.round(member.derivedCapacity.confidence * 100)}%
            </p>
          </div>
        )}
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase text-hx-muted">Beliefs</p>
          <ul className="mt-2 space-y-2">
            {beliefs.map((b) => (
              <li key={b.beliefKey} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-hx-muted">{b.beliefKey}</span>
                <BeliefBar mean={b.mean} confidence={b.confidence} />
              </li>
            ))}
            {beliefs.length === 0 && (
              <li className="text-xs text-hx-muted">No beliefs yet — complete tasks to learn.</li>
            )}
          </ul>
        </div>
        {predictions.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase text-hx-muted">Prediction explanations</p>
            {predictions.slice(0, 2).map((p) => (
              <div key={p.predictionType} className="mt-2 rounded border border-hx-border p-2 text-xs">
                <p className="font-medium">
                  {p.predictionType}: {(p.predictedValue * 100).toFixed(0)}% (conf{" "}
                  {(p.confidence * 100).toFixed(0)}%)
                </p>
                <ul className="mt-1 space-y-1 text-hx-muted">
                  {p.explanation.map((ex) => (
                    <li key={`${ex.factor}-${ex.contribution}`}>
                      {ex.factor}: +{ex.contribution}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {profile?.recentEvidence && profile.recentEvidence.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase text-hx-muted">Recent evidence</p>
            <ul className="mt-2 space-y-1 text-xs text-hx-muted">
              {profile.recentEvidence.slice(0, 6).map((ev, i) => (
                <li key={`${ev.eventType}-${i}`}>
                  {ev.eventType} · {new Date(ev.observedAt).toLocaleDateString()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function TeamsClient() {
  const { push } = useRouter();
  const legacyMigrated = useRef(false);
  const [data, setData] = useState<TeamsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TeamsTab>("Overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | TeamMember["status"]
  >("all");
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [intelMember, setIntelMember] = useState<TeamMember | null>(null);
  const [addForm, setAddForm] = useState({
    name: "",
    email: "",
    role: "Member" as (typeof ROLE_OPTIONS)[number],
    team: "General",
    capacity: "40h / week",
    slackId: "",
    talentTier: "Mid-level" as (typeof TALENT_TIER_OPTIONS)[number],
  });

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await apiGet<TeamsPayload>("/api/metrics/teams");
      setData(res);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load teams");
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined" || legacyMigrated.current) return;
    legacyMigrated.current = true;
    const extras = loadStoredExtras();
    if (extras.length === 0) return;
    void (async () => {
      for (const x of extras) {
        try {
          await apiPost<{ ok: boolean }>("/api/metrics/teams/roster", {
            name: x.name,
            email: x.email,
            role: x.role,
            team: x.team,
            capacity: x.capacity,
            slackId: x.slackId,
            talentTier: x.talentTier,
          });
        } catch {
          /* duplicate / offline , skip */
        }
      }
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      void load();
    })();
  }, [load]);

  const baseMembers = data?.members ?? [];

  const teamMembers = useMemo(() => baseMembers, [baseMembers]);

  const summaryMetrics = useMemo(() => {
    const n = teamMembers.length;
    const atRisk = teamMembers.filter((x) => x.status === "At Risk").length;
    const overCapacity = teamMembers.filter(
      (x) => x.status === "Over Capacity",
    ).length;
    /** Prefer API aggregate (same DB as execution ledger + settings budget); avoid averaging capped row %s. */
    const utilizationFromApi = data?.metrics?.utilization;
    const utilization =
      typeof utilizationFromApi === "number" && !Number.isNaN(utilizationFromApi)
        ? utilizationFromApi
        : n > 0
          ? Math.round(
              teamMembers.reduce((s, m) => s + m.utilization, 0) / n,
            )
          : 0;
    return {
      members: n,
      membersNote:
        data?.metrics?.membersNote ?? `${n} execution owner(s)`,
      utilization,
      utilTrend: data?.metrics?.utilTrend ?? ",",
      atRisk,
      overCapacity,
    };
  }, [teamMembers, data]);

  const teamDonut = data?.donut ?? EMPTY_DONUT;
  const teamDeptBars = data?.deptBars?.length ? data.deptBars : [];
  const insights =
    data?.insights?.length ? data.insights : ["Connect ledger data , no insights yet."];

  const donutData = [
    { name: "Used", value: teamDonut.used },
    { name: "Available", value: teamDonut.available },
    { name: "Over", value: teamDonut.over },
  ];

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teamMembers.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q) ||
        m.team.toLowerCase().includes(q) ||
        (m.slackId?.toLowerCase().includes(q) ?? false) ||
        (m.talentTier?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [teamMembers, search, statusFilter]);

  const sortedMembers = useMemo(() => {
    const list = filteredMembers.slice();
    if (activeTab === "Workload") {
      list.sort((a, b) => b.loadPct - a.loadPct || a.name.localeCompare(b.name));
    } else if (activeTab === "Performance") {
      list.sort(
        (a, b) =>
          b.utilization - a.utilization || a.name.localeCompare(b.name),
      );
    } else if (activeTab === "Capacity") {
      list.sort(
        (a, b) =>
          a.utilization - b.utilization || a.name.localeCompare(b.name),
      );
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [filteredMembers, activeTab]);

  const tabHint = useMemo(() => {
    switch (activeTab) {
      case "Overview":
        return "Roster and owner health across the ledger.";
      case "Capacity":
        return "Headroom-focused sort (lowest utilization first). Charts reflect aggregate ledger load.";
      case "Workload":
        return "Sorted by load index , tackle hotspots first.";
      case "Performance":
        return "Sorted by utilization , highest pressure owners first.";
      default:
        return "";
    }
  }, [activeTab]);

  async function submitAddMember(e: React.FormEvent) {
    e.preventDefault();
    const name = addForm.name.trim();
    const email = addForm.email.trim().toLowerCase();
    if (!name || !email) return;
    if (teamMembers.some((m) => m.email.toLowerCase() === email)) {
      setAddOpen(false);
      return;
    }
    const slack = addForm.slackId.trim();
    try {
      await apiPost("/api/metrics/teams/roster", {
        name,
        email,
        role: addForm.role.trim() || "Member",
        team: addForm.team.trim() || "General",
        capacity: addForm.capacity.trim() || "40h / week",
        slackId: slack || undefined,
        talentTier: addForm.talentTier,
      });
      setAddForm({
        name: "",
        email: "",
        role: "Member",
        team: "General",
        capacity: "40h / week",
        slackId: "",
        talentTier: "Mid-level",
      });
      setAddOpen(false);
      await load();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Failed to add member");
    }
  }

  async function removeRosterMember(m: TeamMember) {
    if (!isRosterRemovable(m)) return;
    try {
      await apiDelete(`/api/metrics/teams/roster/${encodeURIComponent(m.id)}`);
      await load();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Failed to remove member");
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <DashboardHero>
        <PageHeader
          variant="dashboard"
          className="border-b-0 pb-0"
          title="TEAMS"
          subtitle="Execution owners derived from your decision ledger (live)."
          trailingActions={
            <>
              <Button
                variant="outline"
                size="sm"
                type="button"
                className="shrink-0 gap-2"
                onClick={() => setImportOpen(true)}
              >
                <FileUp className="size-4" />
                Import
              </Button>
              <Button
                variant="outlineGold"
                size="sm"
                type="button"
                className="shrink-0 gap-2"
                data-tour="teams-add-member"
                onClick={() => setAddOpen(true)}
              >
                <UserPlus className="size-4" />
                Add member
              </Button>
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
                variant="outline"
                size="sm"
                type="button"
                className="shrink-0 px-3"
                title="Workspace settings"
                onClick={() => push("/settings")}
              >
                <Settings className="size-4" />
              </Button>
            </>
          }
        />
        {err && <p className="mt-2 text-sm text-hx-danger">API: {err}</p>}
      </DashboardHero>

      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] xl:min-h-[calc(100svh-13.5rem)] xl:grid-cols-[minmax(0,1fr)_300px] xl:items-stretch">
        <div className="flex min-h-0 min-w-0 flex-col border-r border-hx-border bg-hx-bg">
          <div className="space-y-6 px-5 py-8 lg:px-10 lg:py-10">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <p className="text-xs font-semibold uppercase text-hx-muted">
                Execution Owners
              </p>
              <p className="mt-2 text-3xl font-bold">{summaryMetrics.members}</p>
              <p className="mt-1 text-xs text-hx-success">
                {summaryMetrics.membersNote}
              </p>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase text-hx-muted">
                Avg utilization (load/cap)
              </p>
              <div className="mt-2 flex items-center gap-4">
                <div className="relative flex size-16 items-center justify-center rounded-full border-4 border-hx-accent">
                  <span className="text-lg font-bold text-hx-accent">
                    {summaryMetrics.utilization}%
                  </span>
                </div>
                <p className="text-xs text-hx-muted">{summaryMetrics.utilTrend}</p>
              </div>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase text-hx-muted">
                At Risk Owners
              </p>
              <p className="mt-2 text-3xl font-bold">{summaryMetrics.atRisk}</p>
              <p className="mt-1 text-xs text-hx-warning">Blocked or high load</p>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase text-hx-muted">
                Over Capacity
              </p>
              <p className="mt-2 text-3xl font-bold text-hx-danger">
                {summaryMetrics.overCapacity}
              </p>
              <p className="mt-1 text-xs text-hx-muted">Owners</p>
            </Card>
          </div>

          <div className="flex flex-col gap-2">
            <SegmentTabs
              layout="wide"
              ariaLabel="Teams views"
              value={activeTab}
              onChange={setActiveTab}
              items={tabs.map((t) => ({
                value: t,
                label: t.toUpperCase(),
              }))}
            />
            <p className="text-xs text-hx-muted">{tabHint}</p>
          </div>

          {activeTab === "Capacity" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="min-h-[280px]">
                <SectionTitle>Capacity mix</SectionTitle>
                <p className="mt-1 text-xs text-hx-muted">
                  Ledger-weight totals (same as sidebar overview).
                </p>
                <ClientCharts>
                  <TeamsDonut data={donutData} />
                </ClientCharts>
              </Card>
              <Card className="min-h-[280px]">
                <SectionTitle>Load by owner</SectionTitle>
                <ClientCharts>
                  <TeamsBarChart data={teamDeptBars} />
                </ClientCharts>
              </Card>
            </div>
          )}

          {activeTab === "Performance" && (
            <Card>
              <SectionTitle>Insights</SectionTitle>
              <ul className="mt-3 space-y-3 text-sm">
                {insights.map((line) => (
                  <li key={line} className="flex gap-2 text-hx-muted">
                    <span className="shrink-0 text-hx-accent">●</span>
                    {line}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-hx-muted" />
              <input
                type="search"
                placeholder="Search owners..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-hx-border bg-hx-surface-elevated py-2 pl-10 pr-3 text-sm text-hx-text placeholder:text-hx-muted focus:border-hx-accent focus:outline-none"
                aria-label="Search owners"
              />
            </div>
            <Button
              variant={filterPanelOpen ? "outlineGold" : "outline"}
              size="md"
              className="px-3"
              type="button"
              aria-expanded={filterPanelOpen}
              onClick={() => setFilterPanelOpen((o) => !o)}
            >
              <Filter className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="md"
              className="px-3"
              type="button"
              onClick={() => downloadMembersCsv(sortedMembers)}
              title="Download visible rows as CSV"
            >
              <Download className="size-4" />
            </Button>
          </div>

          {filterPanelOpen && (
            <div className="flex flex-wrap gap-2 rounded-lg border border-hx-border bg-hx-surface-elevated/50 p-3">
              <span className="mr-2 self-center text-xs font-medium uppercase text-hx-muted">
                Status
              </span>
              {(
                ["all", "Healthy", "At Risk", "Over Capacity"] as const
              ).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    statusFilter === s
                      ? "border-hx-accent bg-hx-accent/15 text-hx-accent"
                      : "border-hx-border text-hx-muted hover:border-hx-accent/40 hover:text-hx-text",
                  )}
                  onClick={() =>
                    setStatusFilter(s === "all" ? "all" : s)
                  }
                >
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>
          )}

          <Card className="flex min-h-0 flex-col overflow-hidden p-0" data-tour="teams-roster">
            <div
              className="scrollbar-hx max-h-[min(58vh,560px)] min-h-[200px] overflow-auto overscroll-contain"
              role="region"
              aria-label="Team roster table"
            >
              <table className="w-full min-w-[1020px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-[1] border-b border-hx-border bg-hx-surface-elevated/95 text-xs uppercase tracking-wide text-hx-muted backdrop-blur-sm">
                  <tr>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Slack</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Level</th>
                    <th className="px-4 py-3 font-medium">Scope</th>
                    <th className="px-4 py-3 font-medium">Capacity</th>
                    <th
                      className="px-4 py-3 font-medium"
                      title="Advisory intelligence — enforcement uses legacy capacity"
                    >
                      Beliefs
                    </th>
                    <th className="px-4 py-3 font-medium">Load index</th>
                    <th className="px-4 py-3 font-medium">Utilization</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium w-24"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hx-border">
                  {sortedMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-hx-surface-elevated/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex size-8 items-center justify-center rounded-full bg-hx-accent/15 text-xs font-bold text-hx-accent">
                            {m.name
                              .split(" ")
                              .filter(Boolean)
                              .map((p) => p[0])
                              .join("")}
                          </span>
                          <div>
                            <div className="font-medium">{m.name}</div>
                            <div className="text-xs text-hx-muted">{m.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[140px] px-4 py-3 font-mono text-xs text-hx-muted">
                        {m.slackId ? (
                          <span className="truncate" title={m.slackId}>
                            {m.slackId}
                          </span>
                        ) : (
                          ","
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full border border-hx-border px-2 py-0.5 text-xs">
                            {m.role}
                          </span>
                          {m.isOrgOwner ? (
                            <StatusBadge variant="success" className="text-[10px]">
                              Owner
                            </StatusBadge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-hx-muted">
                        {m.talentTier ?? ","}
                      </td>
                      <td className="px-4 py-3 text-hx-muted">{m.team}</td>
                      <td className="px-4 py-3 text-hx-muted">{m.capacity}</td>
                      <td className="px-4 py-3">
                        {m.intelligenceAdvisory && m.beliefs?.length ? (
                          <button
                            type="button"
                            className="w-full max-w-[160px] text-left"
                            title="Advisory intelligence — enforcement uses legacy capacity"
                            onClick={() => setIntelMember(m)}
                          >
                            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-hx-muted">
                              Advisory
                              <Info className="size-3" />
                            </div>
                            <div className="mt-1 space-y-1">
                              {m.beliefs.slice(0, 3).map((b) => (
                                <div key={b.beliefKey} className="text-xs">
                                  <div className="flex justify-between gap-2">
                                    <span className="truncate text-hx-muted">{b.beliefKey}</span>
                                    <span className="font-medium">{(b.mean * 100).toFixed(0)}%</span>
                                  </div>
                                  <div className="relative mt-0.5 h-1.5 overflow-hidden rounded-full bg-hx-surface-elevated">
                                    <div
                                      className="absolute inset-y-0 left-0 rounded-full bg-hx-accent/70"
                                      style={{ width: `${Math.round(b.mean * 100)}%` }}
                                    />
                                    <div
                                      className="absolute inset-y-0 rounded-full border border-hx-accent/40 bg-hx-accent/10"
                                      style={{
                                        left: `${Math.max(0, Math.round((b.mean - (1 - b.confidence) * 0.15) * 100))}%`,
                                        width: `${Math.min(100, Math.round((1 - b.confidence) * 30 + 8))}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {m.derivedCapacity ? (
                              <p className="mt-1 text-[10px] text-hx-muted">
                                Shadow cap {m.derivedCapacity.value.toFixed(1)} vs legacy{" "}
                                {m.legacyCapacity?.toFixed(1) ?? "—"}
                              </p>
                            ) : null}
                          </button>
                        ) : (
                          <span className="text-xs text-hx-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isLedgerOwner(m) && m.beliefs && m.beliefs.length > 0 ? (
                          <button
                            type="button"
                            className="space-y-1 text-left"
                            title="Advisory intelligence — enforcement uses legacy capacity"
                            onClick={() => setIntelMember(m)}
                          >
                            {m.beliefs.slice(0, 3).map((b) => (
                              <div key={b.beliefKey} className="flex items-center gap-2">
                                <span className="w-20 truncate text-[10px] text-hx-muted">
                                  {b.beliefKey}
                                </span>
                                <BeliefBar mean={b.mean} confidence={b.confidence} />
                              </div>
                            ))}
                          </button>
                        ) : (
                          <span className="text-xs text-hx-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-2 max-w-[120px] overflow-hidden rounded-full bg-hx-surface-elevated">
                          <div
                            className="h-full rounded-full bg-hx-accent"
                            style={{ width: `${m.loadPct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium">{m.utilization}%</td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={memberStatusVariant(m.status)}>
                          {m.status}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          {m.canRemove ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-hx-muted"
                              type="button"
                              title="Edit roster details"
                              onClick={() => setEditMember(m)}
                            >
                              <Pencil className="size-3.5" />
                              Edit
                            </Button>
                          ) : null}
                          {isRosterRemovable(m) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-hx-danger hover:text-hx-danger"
                              type="button"
                              onClick={() => void removeRosterMember(m)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-hx-border px-4 py-3 text-xs text-hx-muted">
              Showing {sortedMembers.length} of {teamMembers.length} owner(s)
              {search.trim() || statusFilter !== "all"
                ? " (filtered)"
                : ""}
            </div>
          </Card>
          </div>
        </div>

        <div className="hidden min-h-0 size-full xl:flex xl:h-full xl:w-[300px] xl:shrink-0 xl:flex-col xl:self-stretch xl:border-l xl:border-hx-border xl:bg-hx-surface">
          <aside
            className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6"
            aria-label="Capacity and insights"
          >
        <Card>
          <SectionTitle>Capacity Overview</SectionTitle>
          <p className="mt-2 text-center text-2xl font-bold text-hx-text">
            {teamDonut.total} pts
          </p>
          <p className="text-center text-xs text-hx-muted">Scaled weight units</p>
          <ClientCharts>
            <TeamsDonut data={donutData} />
          </ClientCharts>
          <ul className="mt-2 space-y-2 text-xs">
            <li className="flex justify-between">
              <span className="text-hx-muted">Used</span>
              <span>
                {teamDonut.used} ({teamDonut.usedPct}%)
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-hx-muted">Available</span>
              <span>
                {teamDonut.available} ({teamDonut.availablePct}%)
              </span>
            </li>
            <li className="flex justify-between text-hx-danger">
              <span>Over</span>
              <span>
                {teamDonut.over} ({teamDonut.overPct}%)
              </span>
            </li>
          </ul>
        </Card>
        <Card>
          <SectionTitle>Load by owner</SectionTitle>
          <ClientCharts>
            <TeamsBarChart data={teamDeptBars} />
          </ClientCharts>
        </Card>
        <Card>
          <SectionTitle>Insights</SectionTitle>
          <ul className="mt-3 space-y-3 text-sm">
            {insights.map((line) => (
              <li key={line} className="flex gap-2 text-hx-muted">
                <span className="shrink-0 text-hx-accent">●</span>
                {line}
              </li>
            ))}
          </ul>
        </Card>
          </aside>
        </div>
      </div>

      <TeamsImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={load}
        onError={(msg) => setErr(msg)}
        onEditMember={(m) => {
          setImportOpen(false);
          setEditMember(m);
        }}
      />
      <TeamsEditMemberModal
        member={editMember}
        open={editMember != null}
        onClose={() => setEditMember(null)}
        onSaved={load}
        onError={(msg) => setErr(msg)}
      />

      {intelMember && (
        <OwnerIntelligenceDrawer member={intelMember} onClose={() => setIntelMember(null)} />
      )}

      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="presentation"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="scrollbar-hide relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-hx-border bg-hx-surface p-6 shadow-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-member-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-4 top-4 rounded-md p-1 text-hx-muted hover:bg-hx-surface-elevated hover:text-hx-text"
              aria-label="Close"
              onClick={() => setAddOpen(false)}
            >
              <X className="size-5" />
            </button>
            <h2 id="add-member-title" className="text-lg font-semibold text-hx-text">
              Add team member
            </h2>
            <p className="mt-1 text-sm text-hx-muted">
              Adds a roster row stored for your account (merged with ledger owners). Does not change execution tasks until that owner appears on work in the ledger.
            </p>
            <form className="mt-4 space-y-3" onSubmit={submitAddMember}>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="tm-name">
                  Name
                </label>
                <input
                  id="tm-name"
                  required
                  value={addForm.name}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="tm-email">
                  Email
                </label>
                <input
                  id="tm-email"
                  type="email"
                  required
                  value={addForm.email}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="tm-role">
                  Role
                </label>
                <select
                  id="tm-role"
                  value={addForm.role}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      role: e.target.value as (typeof ROLE_OPTIONS)[number],
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="tm-tier">
                  Level
                </label>
                <p className="mt-0.5 text-[11px] text-hx-muted">
                  How you think about depth of ownership (roster only).
                </p>
                <select
                  id="tm-tier"
                  value={addForm.talentTier}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      talentTier: e.target.value as (typeof TALENT_TIER_OPTIONS)[number],
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                >
                  {TALENT_TIER_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="tm-slack">
                  Slack ID
                </label>
                <input
                  id="tm-slack"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="U01234ABCD or @alex"
                  value={addForm.slackId}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, slackId: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 font-mono text-sm text-hx-text placeholder:text-hx-muted focus:border-hx-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="tm-team">
                  Scope / team
                </label>
                <input
                  id="tm-team"
                  value={addForm.team}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, team: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="tm-cap">
                  Capacity label
                </label>
                <input
                  id="tm-cap"
                  value={addForm.capacity}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, capacity: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setAddOpen(false)}
                >
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Save member
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
