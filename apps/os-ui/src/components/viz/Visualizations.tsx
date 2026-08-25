"use client";

import {
  Activity,
  Building2,
  CheckCircle2,
  Scale,
  GitBranch,
  Maximize2,
  Minimize2,
  Rocket,
  TrendingUp,
  Trophy,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "@/components/icons";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { kgEdges as mockKgEdges, kgNodes as mockKgNodes } from "@/lib/mock-data";
import { HealthRing, StatusPill } from "@/components/ui/Primitives";
import type { KGEdge, KGEdgeKind, KGKind, KGNode } from "@/lib/types";
import styles from "./viz.module.css";

/** Neutral SaaS flow-graph strokes — only blocking uses semantic red. */
const EDGE_NEUTRAL = "rgba(255, 255, 255, 0.28)";
const EDGE_ACTIVE = "rgba(255, 255, 255, 0.48)";
const EDGE_FOCUS = "rgba(212, 175, 55, 0.55)";
const EDGE_BLOCKS = "rgb(232, 106, 106)";
const RING_NEUTRAL = "rgba(255, 255, 255, 0.42)";
const RING_GOLD = "#D4AF37";
const RING_CRITICAL = "rgb(232, 106, 106)";

const KIND_ICON: Record<KGKind, typeof Trophy> = {
  goal: Trophy,
  initiative: Rocket,
  decision: Scale,
  execution: Zap,
  signal: Activity,
  metric: TrendingUp,
  customer: Building2,
};

const KIND_LABEL: Record<KGKind, string> = {
  goal: "Goal",
  initiative: "Initiative",
  decision: "Decision",
  execution: "Execution",
  signal: "Signal",
  metric: "Metric",
  customer: "Customer",
};

const EDGE_STYLE: Record<KGEdgeKind, { dashed: boolean; label: string; blocking?: boolean }> = {
  contributes: { dashed: true, label: "contributes to" },
  drives: { dashed: false, label: "drives" },
  depends: { dashed: false, label: "depends on" },
  influences: { dashed: false, label: "influences" },
  requires: { dashed: true, label: "requires" },
  affects: { dashed: false, label: "affects" },
  related: { dashed: true, label: "related to" },
  blocks: { dashed: false, label: "blocks", blocking: true },
};

const NODE_LEGEND: { kind: KGKind; label: string }[] = [
  { kind: "goal", label: "Goal" },
  { kind: "initiative", label: "Initiative" },
  { kind: "decision", label: "Decision" },
  { kind: "execution", label: "Execution" },
  { kind: "signal", label: "Signal" },
  { kind: "metric", label: "Metric" },
  { kind: "customer", label: "Customer" },
];

const EDGE_LEGEND: KGEdgeKind[] = [
  "drives",
  "depends",
  "influences",
  "requires",
  "affects",
  "related",
  "blocks",
];

const VIEWS = ["Strategic View", "Execution View", "Customer View", "Risk View"] as const;

function nodeById(nodes: KGNode[], id: string) {
  return nodes.find((n) => n.id === id);
}

function edgePath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * 4.5;
  const oy = (dx / len) * 4.5;
  return `M ${x1} ${y1} Q ${mx + ox} ${my + oy} ${x2} ${y2}`;
}

function NodeRing({
  pct,
  label,
  sub,
  color,
  size = 32,
}: {
  pct: number;
  label: string;
  sub?: string;
  color: string;
  size?: number;
}) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={styles.kgRing} aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform="rotate(-90 20 20)"
      />
      <text x="20" y={sub ? 19 : 21} textAnchor="middle" className={styles.kgRingLabel}>
        {label}
      </text>
      {sub ? (
        <text x="20" y="27" textAnchor="middle" className={styles.kgRingSub}>
          {sub}
        </text>
      ) : null}
    </svg>
  );
}

export function KnowledgeGraph({
  nodes: liveNodes,
  edges: liveEdges,
  onSelect,
}: {
  nodes?: KGNode[];
  edges?: KGEdge[];
  onSelect?: (node: KGNode) => void;
} = {}) {
  const live = liveNodes !== undefined;
  const kgNodes = liveNodes ?? mockKgNodes;
  const kgEdges = liveEdges ?? mockKgEdges;
  const [selected, setSelected] = useState<KGNode | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]>(VIEWS[0]);
  const [showLabels, setShowLabels] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const [showRisk, setShowRisk] = useState(false);
  const [zoom, setZoom] = useState(1);

  const relatedIds = useMemo(() => {
    if (!selected) return null;
    const ids = new Set<string>([selected.id]);
    for (const edge of kgEdges) {
      if (edge.from === selected.id || edge.to === selected.id) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    return ids;
  }, [selected, kgEdges]);

  const stats = useMemo(() => {
    if (!selected) return null;
    const inbound = kgEdges.filter((e) => e.to === selected.id);
    const outbound = kgEdges.filter((e) => e.from === selected.id);
    const neighbors = [...inbound.map((e) => e.from), ...outbound.map((e) => e.to)]
      .map((id) => nodeById(kgNodes, id))
      .filter(Boolean) as KGNode[];
    return {
      upstream: inbound.length,
      downstream: outbound.length,
      signals: neighbors.filter((n) => n.kind === "signal").length,
      metrics: neighbors.filter((n) => n.kind === "metric").length,
      decisions: neighbors.filter((n) => n.kind === "decision").length,
    };
  }, [selected, kgEdges, kgNodes]);

  useEffect(() => {
    if (!selected && !fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, fullscreen]);

  const riskCount = kgNodes.filter((n) => n.risky).length;

  return (
    <div className={styles.graphPanel} data-fullscreen={fullscreen ? "true" : "false"}>
      <div className={styles.graphHead}>
        <div className={styles.kgHeadCopy}>
          <p className={styles.kgEyebrow}>Knowledge Graph</p>
          <h2>How everything connects</h2>
          <p className={styles.kgSubhead}>
            {live
              ? kgNodes.length
                ? `${kgNodes.length} ledger entities · ${kgEdges.length} links`
                : "No ledger entities to map yet"
              : `${riskCount} entities flagged · Live map of goals, decisions, and signals`}
          </p>
        </div>
        <div className={styles.kgToolbar}>
          <div className={styles.kgViewTabs} role="tablist" aria-label="Graph view">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={styles.kgViewTab}
                data-active={view === v ? "true" : "false"}
                onClick={() => setView(v)}
              >
                {v.replace(" View", "")}
              </button>
            ))}
          </div>
          <div className={styles.kgToggles}>
            <label className={styles.kgToggle}>
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
              Labels
            </label>
            <label className={styles.kgToggle}>
              <input
                type="checkbox"
                checked={showConfidence}
                onChange={(e) => setShowConfidence(e.target.checked)}
              />
              Confidence
            </label>
            <label className={styles.kgToggle}>
              <input type="checkbox" checked={showRisk} onChange={(e) => setShowRisk(e.target.checked)} />
              Risk
            </label>
          </div>
          <div className={styles.kgZoomGroup}>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2)))}
            >
              <ZoomOut size={14} />
            </button>
            <button type="button" className={styles.kgZoomPct} onClick={() => setZoom(1)} aria-label="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(1.3, +(z + 0.1).toFixed(2)))}
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              onClick={() => setFullscreen((v) => !v)}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
      </div>

      {live && kgNodes.length === 0 ? (
        <div className={styles.graphCanvas}>
          <p style={{ margin: "48px 24px", color: "var(--text-muted)", fontSize: 14, textAlign: "center" }}>
            No decisions, executions, or signals on the ledger yet. The graph stays empty until those exist.
          </p>
        </div>
      ) : (
      <div className={styles.graphCanvas} data-focused={selected ? "true" : "false"}>
        <div className={styles.kgAtmosphere} aria-hidden />
        <div className={styles.kgStage} style={{ transform: `scale(${zoom})` }}>
          <svg className={styles.edges} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {kgEdges.map((edge) => {
              const from = nodeById(kgNodes, edge.from);
              const to = nodeById(kgNodes, edge.to);
              if (!from || !to) return null;
              const s = EDGE_STYLE[edge.kind];
              const related =
                !relatedIds || relatedIds.has(edge.from) || relatedIds.has(edge.to);
              const focused =
                Boolean(selected) &&
                (edge.from === selected?.id || edge.to === selected?.id);
              const stroke = s.blocking
                ? EDGE_BLOCKS
                : focused
                  ? EDGE_FOCUS
                  : related
                    ? EDGE_ACTIVE
                    : EDGE_NEUTRAL;
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={edgePath(from.x, from.y, to.x, to.y)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={focused || s.blocking ? 1.45 : related ? 1.2 : 1}
                  strokeDasharray={s.dashed ? "4.5 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                  opacity={related ? (s.blocking ? 0.85 : focused ? 0.9 : 0.55) : 0.12}
                  className={styles.kgEdgePath}
                  data-blocking={s.blocking ? "true" : "false"}
                />
              );
            })}
          </svg>

          {kgEdges.map((edge) => {
            const s = EDGE_STYLE[edge.kind];
            const label = showLabels ? edge.label : undefined;
            const pct = showConfidence ? edge.pct : undefined;
            if (!label && !pct) return null;
            const from = nodeById(kgNodes, edge.from);
            const to = nodeById(kgNodes, edge.to);
            if (!from || !to) return null;
            const active =
              !relatedIds || relatedIds.has(edge.from) || relatedIds.has(edge.to);
            return (
              <span
                key={`tag-${edge.from}-${edge.to}`}
                className={styles.kgEdgeTag}
                data-active={active ? "true" : "false"}
                data-blocking={s.blocking ? "true" : "false"}
                style={{
                  left: `${(from.x + to.x) / 2}%`,
                  top: `${(from.y + to.y) / 2}%`,
                }}
              >
                {label}
                {label && pct ? " · " : ""}
                {pct}
              </span>
            );
          })}

          {kgNodes.map((node) => {
            const Icon = KIND_ICON[node.kind];
            const active = !relatedIds || relatedIds.has(node.id);
            return (
              <button
                key={node.id}
                type="button"
                className={styles.kgNode}
                data-kind={node.kind}
                data-center={node.center ? "true" : "false"}
                data-risk={showRisk && node.risky ? "true" : "false"}
                data-selected={selected?.id === node.id ? "true" : "false"}
                data-dimmed={active ? "false" : "true"}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                onClick={() => {
                  setSelected((prev) => (prev?.id === node.id ? null : node));
                  onSelect?.(node);
                }}
                aria-pressed={selected?.id === node.id}
                aria-label={`${node.title}, ${KIND_LABEL[node.kind]}${node.pill ? `, ${node.pill.label}` : ""}`}
              >
                <span className={styles.kgIcon} aria-hidden>
                  <Icon size={14} />
                </span>
                <div className={styles.kgText}>
                  <span className={styles.kgKindLabel}>{KIND_LABEL[node.kind]}</span>
                  <strong>{node.title}</strong>
                  {node.value ? <em className={styles.kgValue}>{node.value}</em> : null}
                  {node.subtitle ? <span className={styles.kgSub}>{node.subtitle}</span> : null}
                  {node.pill ? <StatusPill label={node.pill.label} tone={node.pill.tone} /> : null}
                </div>
              </button>
            );
          })}
        </div>

        {selected && stats ? (
          <aside className={styles.kgDetail} aria-live="polite">
            <header>
              <span className={styles.kgKind}>
                {(() => {
                  const Icon = KIND_ICON[selected.kind];
                  return <Icon size={11} />;
                })()}
                {KIND_LABEL[selected.kind]}
              </span>
              <button type="button" aria-label="Close details" onClick={() => setSelected(null)}>
                <X size={14} />
              </button>
            </header>
            <h3>{selected.title}</h3>
            {selected.subtitle ? <p className={styles.kgDetailSub}>{selected.subtitle}</p> : null}
            {selected.ring ? (
              <div className={styles.kgDetailScore}>
                <span>Health Score</span>
                <div>
                  <NodeRing
                    pct={selected.ring.pct}
                    label={selected.ring.label}
                    sub={selected.ring.sub}
                    color={
                      selected.risky || selected.pill?.tone === "critical"
                        ? RING_CRITICAL
                        : selected.center
                          ? RING_GOLD
                          : RING_NEUTRAL
                    }
                    size={52}
                  />
                  {selected.pill ? <StatusPill label={selected.pill.label} tone={selected.pill.tone} /> : null}
                </div>
              </div>
            ) : null}
            <div className={styles.kgDetailWhy}>
              <span>Why it matters</span>
              <p>
                {selected.why ??
                  `${selected.title} is connected to ${stats.upstream + stats.downstream} entities in your company brain.`}
              </p>
            </div>
            <ul className={styles.kgDetailStats}>
              <li>
                <GitBranch size={12} /> Upstream <strong>{stats.upstream}</strong>
              </li>
              <li>
                <GitBranch size={12} /> Downstream <strong>{stats.downstream}</strong>
              </li>
              <li>
                <Activity size={12} /> Signals <strong>{stats.signals}</strong>
              </li>
              <li>
                <TrendingUp size={12} /> Impacted Metrics <strong>{stats.metrics}</strong>
              </li>
              <li>
                <Scale size={12} /> Related Decisions <strong>{stats.decisions}</strong>
              </li>
              <li>
                <CheckCircle2 size={12} /> Potential Impact{" "}
                <strong className={styles.kgGold}>{selected.impact ?? "Medium"}</strong>
              </li>
              <li>
                <Activity size={12} /> Confidence <strong>{selected.confidence ?? "—"}</strong>
              </li>
            </ul>
            {selected.href ? (
              <a
                href={selected.href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.kgDetailCta}
                onClick={() => setSelected(null)}
              >
                {selected.openLabel || "Open source →"}
              </a>
            ) : (
              <Link
                href={
                  selected.kind === "decision" && selected.id.startsWith("d:")
                    ? `/brain/projects/${selected.id.slice(2)}`
                    : "/decide"
                }
                className={styles.kgDetailCta}
                onClick={() => setSelected(null)}
              >
                {selected.kind === "decision" && selected.id.startsWith("d:") ? "Details →" : "Open Decide →"}
              </Link>
            )}
          </aside>
        ) : (
          <div className={styles.kgHint} aria-hidden>
            Select a node to inspect relationships
          </div>
        )}
      </div>
      )}

      <div className={styles.kgLegend}>
        <div className={styles.kgLegendRow}>
          {NODE_LEGEND.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <span key={item.label} className={styles.kgLegendNode}>
                <i>
                  <Icon size={11} />
                </i>
                {item.label}
              </span>
            );
          })}
        </div>
        <div className={styles.kgLegendRow}>
          {EDGE_LEGEND.map((kind) => {
            const s = EDGE_STYLE[kind];
            return (
              <span key={kind} className={styles.kgLegendEdge} data-blocking={s.blocking ? "true" : "false"}>
                <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden>
                  <line
                    x1="1"
                    y1="3"
                    x2="21"
                    y2="3"
                    stroke={s.blocking ? EDGE_BLOCKS : EDGE_NEUTRAL}
                    strokeWidth="1.6"
                    strokeDasharray={s.dashed ? "4 3" : undefined}
                  />
                </svg>
                {s.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ExecutionMap({
  rows: liveRows,
  subtitle,
}: {
  rows?: Array<{
    id?: string;
    tone: string;
    objective: { title: string; pct: number };
    project: string;
    milestones: Array<{ name: string; pct: number }>;
    tasks: { label: string; pct: number };
    signal: { label: string; delta: string };
    detail: string;
  }>;
  subtitle?: string;
}) {
  const columns = ["Objectives", "Projects", "Milestones", "Tasks", "Signals / Outcomes"];
  const fallback = [
    {
      id: "demo:mobile",
      tone: "purple",
      objective: { title: "Ship exceptional mobile experience", pct: 72 },
      project: "Mobile App Development",
      milestones: [
        { name: "MVP Build", pct: 100 },
        { name: "Beta Release", pct: 60 },
      ],
      tasks: { label: "128 / 182", pct: 70 },
      signal: { label: "Crash rate 1.2%", delta: "↓ 0.6%" },
      detail: "3 squads · 14 engineers · velocity 42 pts/sprint",
    },
    {
      id: "demo:backend",
      tone: "blue",
      objective: { title: "Ensure reliability & performance", pct: 58 },
      project: "Backend & Infrastructure",
      milestones: [
        { name: "Architecture Setup", pct: 100 },
        { name: "Load Testing", pct: 45 },
      ],
      tasks: { label: "67 / 134", pct: 50 },
      signal: { label: "API latency (p95) 320ms", delta: "↓ 40ms" },
      detail: "2 squads · 8 engineers · SLO 99.9% uptime",
    },
    {
      id: "demo:gtm",
      tone: "green",
      objective: { title: "Drive adoption & engagement", pct: 40 },
      project: "Go-to-Market",
      milestones: [
        { name: "Campaign Launch", pct: 70 },
        { name: "User Onboarding Flow", pct: 20 },
      ],
      tasks: { label: "43 / 108", pct: 40 },
      signal: { label: "Beta signups 1,842", delta: "↑ 18%" },
      detail: "Marketing + Growth · 6 people · CAC trending down",
    },
  ];
  const rows = liveRows ?? fallback;

  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [showDeps, setShowDeps] = useState(false);

  return (
    <div className={styles.mapPanel}>
      <div className={styles.graphHead}>
        <div>
          <h2>Execution Map</h2>
          <p>{subtitle || (liveRows ? "From execution ledger" : "Decision approved on Jun 12, 2025")}</p>
        </div>
        <div className={styles.graphControls}>
          <button type="button" className={styles.selectBtn}>
            {liveRows?.[0]?.objective.title.slice(0, 28) || "Mobile Launch"}
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            data-active={expanded ? "true" : "false"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Collapse All" : "Expand All"}
          </button>
          <button type="button" className={styles.iconBtn} aria-label="Reset zoom" onClick={() => setZoom(1)}>
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2)))}
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(1.3, +(z + 0.1).toFixed(2)))}
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
      <div className={styles.mapScroll}>
        <div className={styles.mapZoom} style={{ transform: `scale(${zoom})` }}>
          <div className={styles.mapCols}>
            {columns.map((col) => (
              <div key={col} className={styles.mapColHead}>
                {col}
              </div>
            ))}
          </div>
          {rows.map((row, rowIdx) => (
            <div
              key={row.id || `${row.objective.title}:${row.project}:${rowIdx}`}
              className={styles.mapRow}
              data-tone={row.tone}
              data-deps={showDeps ? "true" : "false"}
            >
              <div className={styles.mapCard}>
                <div className={styles.mapObjHead}>
                  <span className={styles.mapToneDot} data-tone={row.tone} />
                  <strong>{row.objective.title}</strong>
                </div>
                <div className={styles.mapProgress}>
                  <div style={{ width: `${row.objective.pct}%` }} />
                </div>
                <span className={styles.pct}>{row.objective.pct}%</span>
                {expanded ? <span className={styles.mapDetail}>{row.detail}</span> : null}
              </div>
              <div className={styles.mapCard}>
                <strong>{row.project}</strong>
                {expanded ? <span className={styles.mapDetail}>{row.detail}</span> : null}
              </div>
              <div className={styles.mapStack}>
                {row.milestones.map((m, mi) => (
                  <div key={`${row.id || rowIdx}:${m.name}:${mi}`} className={styles.mapCard}>
                    <div className={styles.milestoneRow}>
                      {m.pct === 100 ? (
                        <CheckCircle2 size={14} color="var(--status-low)" />
                      ) : (
                        <span className={styles.milestoneRing} />
                      )}
                      <strong>{m.name}</strong>
                      <span className={styles.pct} data-tone={m.pct === 100 ? "good" : "warn"}>
                        {m.pct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.mapCard}>
                <div className={styles.taskCell}>
                  <HealthRing value={row.tasks.pct} max={100} label="" tone="info" size="sm" />
                  <div>
                    <strong>{row.tasks.label}</strong>
                    <span className={styles.pct}>{row.tasks.pct}%</span>
                  </div>
                </div>
              </div>
              <div className={styles.mapCard}>
                <strong>{row.signal.label}</strong>
                <span className={styles.delta}>{row.signal.delta}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.mapFoot}>
        <button
          type="button"
          className={styles.ghostBtn}
          data-active={showDeps ? "true" : "false"}
          onClick={() => setShowDeps((v) => !v)}
        >
          <GitBranch size={13} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
          {showDeps ? "Hide dependencies" : "Show dependencies"}
        </button>
      </div>
    </div>
  );
}
