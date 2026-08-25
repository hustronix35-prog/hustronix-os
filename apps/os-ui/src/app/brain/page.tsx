"use client";

import {
  Building2,
  Calendar,
  FileText,
  FolderKanban,
  Scale,
  SlidersHorizontal,
  Bookmark,
  Users,
  ArrowUpRight,
} from "@/components/icons";
import { HustronixMark } from "@/components/brand/HustronixMark";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatusIcon, TopBar } from "@/components/shell/AppShell";
import { FilterPills, Panel, PanelHeader, StatusPill } from "@/components/ui/Primitives";
import { DataTable } from "@/components/ui/DataTable";
import { Dropdown, useToast } from "@/components/ui/Interactions";
import { KnowledgeGraph } from "@/components/viz/Visualizations";
import {
  fetchBrainSummary,
  fetchOrganizationState,
  fetchReconciliationConflicts,
  fetchReconciliationState,
  saveView,
  type BrainSummary,
  type EntitySnapshot,
  type OrganizationStateDto,
  type ReconConflict,
} from "@/lib/api";
import { entityCardsFromCounts, tabsFromBrainCounts } from "@/lib/live-mappers";
import type { KGEdge, KGNode } from "@/lib/types";
import {
  brainInsights,
  dataSources,
  entityCounts,
  entityTabs,
  recentActivity,
  recentlyAccessed,
} from "@/lib/mock-data";
import styles from "../pages.module.css";

const entityIcons = {
  users: Users,
  folder: FolderKanban,
  building: Building2,
  gavel: Scale,
  calendar: Calendar,
  file: FileText,
};

const activityColumns = [
  { key: "title", label: "Item" },
  {
    key: "type",
    label: "Type",
    render: (row: Record<string, string>) => (
      <StatusPill label={row.type} tone={row.type === "Signal" ? "low" : "info"} />
    ),
  },
  { key: "updated", label: "Updated" },
  { key: "connected", label: "Connected to" },
];

function groupSnapshots(snaps: EntitySnapshot[]) {
  const map = new Map<string, EntitySnapshot[]>();
  for (const s of snaps) {
    const list = map.get(s.entity_id) ?? [];
    list.push(s);
    map.set(s.entity_id, list);
  }
  return [...map.entries()];
}

function toneForState(state: string): "low" | "medium" | "critical" | "info" {
  const u = state.toUpperCase();
  if (u === "COMPLETE" || u === "READY") return "low";
  if (u === "AT_RISK" || u === "IN_PROGRESS") return "medium";
  if (u === "BLOCKED") return "critical";
  return "info";
}

export default function BrainPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [snaps, setSnaps] = useState<EntitySnapshot[]>([]);
  const [conflicts, setConflicts] = useState<ReconConflict[]>([]);
  const [orgState, setOrgState] = useState<OrganizationStateDto | null>(null);
  const [brain, setBrain] = useState<BrainSummary | null>(null);
  const [live, setLive] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchBrainSummary(),
      fetchReconciliationState(),
      fetchReconciliationConflicts(),
      fetchOrganizationState(),
    ])
      .then(([summary, s, c, o]) => {
        if (cancelled) return;
        if (summary) setBrain(summary);
        if (s.length || c.length || o) {
          setSnaps(s);
          setConflicts(c);
          setOrgState(o);
        }
        setLive(true);
      })
      .catch(() => {
        setLive(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entities = useMemo(() => groupSnapshots(snaps), [snaps]);
  const insights = live
    ? [
        ...conflicts.slice(0, 4).map(
          (c) =>
            `${c.dimension.replace(/_/g, " ")} ${c.status.toLowerCase()} on ${c.entity_id} (${c.severity})`,
        ),
        ...(orgState?.risks?.items ?? []).slice(0, 3).map((r) => r.label || r.statement || "").filter(Boolean),
      ]
    : brainInsights;

  const activityRows = live
    ? [
        ...conflicts.map((c) => ({
          title: `${c.dimension} · ${c.entity_id}`,
          type: "Conflict",
          updated: c.status,
          connected: c.conflict_type,
        })),
        ...(orgState?.commitments?.items ?? []).map((c) => ({
          title: c.label || c.statement || "Commitment",
          type: "Commitment",
          updated: "active",
          connected: c.entity_id || "",
        })),
      ]
    : recentActivity.map((row) => ({
        title: row.title,
        type: row.type,
        updated: row.updated,
        connected: row.connected,
      }));

  return (
    <AppShell
      topBar={
        <TopBar
          title="Company Brain"
          subtitle="What Hustronix understands: people, initiatives, dependencies, and history."
          searchPlaceholder="Search anything in your company..."
        />
      }
    >
      <div className={styles.filterBar}>
        <FilterPills
          items={
            loaded
              ? tabsFromBrainCounts(
                  brain?.counts ?? {
                    people: 0,
                    projects: 0,
                    customers: 0,
                    decisions: 0,
                    meetings: 0,
                    documents: 0,
                    signals: 0,
                    integrations: 0,
                  },
                )
              : entityTabs
          }
          active="All"
        />
        <div className={styles.filterActions}>
          <Dropdown
            trigger={({ toggle }) => (
              <button type="button" className={styles.toolbarBtn} onClick={toggle}>
                <SlidersHorizontal size={14} />
                Filters
              </button>
            )}
            items={[
              { type: "header", label: "Filter by" },
              { type: "item", label: "Graph", onSelect: () => router.push("/brain/graph") },
              { type: "item", label: "People", onSelect: () => router.push("/brain/people") },
              { type: "item", label: "Projects", onSelect: () => router.push("/brain/projects") },
              { type: "item", label: "Decisions", onSelect: () => router.push("/brain/decisions") },
              { type: "item", label: "Signals", onSelect: () => router.push("/brain/signals") },
            ]}
          />
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={async () => {
              await saveView("Brain · All");
              toast("View saved", {
                description: "Current Brain view added to your saved views.",
                tone: "success",
              });
            }}
          >
            <Bookmark size={14} />
            Save view
          </button>
        </div>
      </div>

      <div className={styles.gridMainRail}>
        <div className={styles.stack}>
          <KnowledgeGraph
            nodes={loaded ? ((brain?.graph.nodes ?? []) as KGNode[]) : undefined}
            edges={loaded ? ((brain?.graph.edges ?? []) as KGEdge[]) : undefined}
          />

          {live && entities.length > 0 ? (
            <Panel>
              <PanelHeader title="Entity state" subtitle="Live reconciliation snapshots" />
              <div className={styles.entityStateStack}>
                {entities.slice(0, 6).map(([entityId, dims]) => (
                  <div key={entityId} className={styles.entityStateRow}>
                    <strong className={styles.entityStateTitle}>
                      {entityId.replace(/^feature:/, "").replace(/-/g, " ")}
                    </strong>
                    <div className={styles.entityStateDims}>
                      {dims.map((d) => (
                        <div key={`${d.entity_id}:${d.dimension}`} className={styles.entityStateDim}>
                          <span>{d.dimension.replace(/_/g, " ")}</span>
                          <StatusPill label={d.state} tone={toneForState(d.state)} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              title="Explore by entity"
              subtitle="Jump into the memory layer by type"
            />
            <div className={styles.entityGrid}>
              {(loaded
                ? entityCardsFromCounts(
                    brain?.counts ?? {
                      people: 0,
                      projects: 0,
                      customers: 0,
                      decisions: 0,
                      meetings: 0,
                      documents: 0,
                    },
                  )
                : entityCounts.map((e) => ({ ...e, count: 0 }))
              ).map((entity) => {
                const Icon = entityIcons[entity.icon as keyof typeof entityIcons] ?? Users;
                return (
                  <Link key={entity.label} href={entity.href} className={styles.entityCard}>
                    <StatusIcon tone={entity.tone}>
                      <Icon size={16} />
                    </StatusIcon>
                    <strong className="tabular">{entity.count}</strong>
                    <span>{entity.label}</span>
                    <em className={styles.link}>
                      View all <ArrowUpRight size={11} />
                    </em>
                  </Link>
                );
              })}
            </div>
          </Panel>

          <div className={styles.brainActivity}>
            <div className={styles.brainActivityHead}>
              <PanelHeader title={live ? "Conflicts, commitments, and state" : "Recent activity in Brain"} />
            </div>
            <DataTable columns={activityColumns} rows={activityRows.length ? activityRows : [{ title: "No live activity yet", type: "Info", updated: "—", connected: "—" }]} />
          </div>
        </div>

        <aside className={styles.rail}>
          <Panel>
            <PanelHeader title="Recently Accessed" />
            <ul className={styles.listPlain}>
              {(() => {
                const items = live
                  ? (orgState?.blockers?.items ?? []).slice(0, 5).map((b) => ({
                      title: b.label || b.entity_id || "Blocker",
                      meta: b.type || "blocked",
                    }))
                  : recentlyAccessed;
                if (!items.length) return <li className={styles.emptyHint}>No blockers on the ledger.</li>;
                return items.map((item) => (
                  <li key={item.title}>
                    <StatusIcon tone="medium">
                      <FileText size={14} />
                    </StatusIcon>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.meta}</small>
                    </div>
                  </li>
                ));
              })()}
            </ul>
          </Panel>

          <Panel className={styles.insightPanel}>
            <PanelHeader
              title="Insights from Brain"
              action={
                <span className={styles.aiBadge}>
                  <HustronixMark size={14} /> AI
                </span>
              }
            />
            <div className={styles.insightStack}>
              {insights.length ? (
                insights.slice(0, 6).map((insight) => (
                  <div key={insight} className={styles.insightItem}>
                    <HustronixMark size={16} />
                    <span>{insight}</span>
                  </div>
                ))
              ) : (
                <p className={styles.emptyHint}>No conflicts or risks on the ledger.</p>
              )}
              <a href="/decide" className={styles.link}>
                View all insights →
              </a>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Data Sources"
              action={
                <a className={styles.link} href="/settings/integrations">
                  Manage
                </a>
              }
            />
            {(brain?.sources.length
              ? brain.sources.map((s) => ({ name: s.name, status: s.connected ? "Connected" : "Disconnected" }))
              : live
                ? []
                : dataSources
            ).map((source) => {
              const statusKey = source.status.toLowerCase();
              const connected = statusKey === "connected";
              return (
                <div key={source.name} className={styles.sourceRow}>
                  <span>{source.name}</span>
                  <span
                    className={styles.sourceStatus}
                    data-status={connected ? "connected" : "disconnected"}
                  >
                    <i className={styles.dot} />
                    {source.status}
                  </span>
                </div>
              );
            })}
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}
