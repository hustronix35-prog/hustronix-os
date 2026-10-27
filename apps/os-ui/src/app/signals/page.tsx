"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, StatusIcon, TopBar } from "@/components/shell/AppShell";
import { FilterPills, Panel, PanelHeader, StatusPill } from "@/components/ui/Primitives";
import { Modal, buttonStyles } from "@/components/ui/Interactions";
import { AlertTriangle, ArrowUpRight } from "@/components/icons";
import {
  fetchReconciliationConflicts,
  apiGet,
  type ReconConflict,
} from "@/lib/api";
import { formatWhen, humanizeSignalEvent, humanizeSignalSource, humanizeSignalState, parseSignalContent, signalHeadline } from "@/lib/live-mappers";
import styles from "../pages.module.css";

type OpenTarget = { label: string; url: string; section: string };

type SignalRow = {
  id: string;
  content: string;
  source: string;
  sourceSubtype: string | null;
  externalId: string | null;
  owner: string;
  state: string;
  detected: string;
  received: string;
  linked: string | null;
  graceExpires: string | null;
  openTargets: OpenTarget[];
};

const FILTERS = ["All", "Unresolved", "Conflicting", "New", "Linked", "Killed"] as const;

function SignalEvidence({ content }: { content: string }) {
  const parsed = parseSignalContent(content);
  const hasStructure = Boolean(parsed.event || parsed.facts.length || parsed.body);
  if (!hasStructure && !parsed.title) {
    return <p className={styles.signalDetailBody}>{content}</p>;
  }

  const eventLabel = humanizeSignalEvent(parsed.event);

  return (
    <div className={styles.signalEvidence}>
      {eventLabel ? <span className={styles.signalEvent}>{eventLabel}</span> : null}
      {parsed.title ? <p className={styles.signalHeadline}>{parsed.title}</p> : null}
      {parsed.body ? <p className={styles.signalNote}>{parsed.body}</p> : null}
      {parsed.facts.length ? (
        <dl className={styles.signalFacts}>
          {parsed.facts.map((fact) => (
            <div key={`${fact.label}-${fact.value}`} className={styles.signalFact}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function mapSignal(s: Record<string, unknown>): SignalRow {
  const targets = Array.isArray(s.openTargets)
    ? (s.openTargets as OpenTarget[]).filter((t) => t?.url && t?.label)
    : [];
  return {
    id: String(s.id || ""),
    content: String(s.content || s.id || ""),
    source: String(s.source || "MANUAL"),
    sourceSubtype: s.source_subtype != null ? String(s.source_subtype) : null,
    externalId: s.external_id != null ? String(s.external_id) : null,
    owner: String(s.owner || "—"),
    state: String(s.state || ""),
    detected: formatWhen(s.detected_at != null ? String(s.detected_at) : null),
    received: formatWhen(s.received_at != null ? String(s.received_at) : null),
    linked: s.linked_execution_id != null ? String(s.linked_execution_id) : null,
    graceExpires: s.grace_expires_at != null ? formatWhen(String(s.grace_expires_at)) : null,
    openTargets: targets,
  };
}

export default function SignalsPage() {
  const [rows, setRows] = useState<SignalRow[] | null>(null);
  const [conflicts, setConflicts] = useState<ReconConflict[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [selected, setSelected] = useState<SignalRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet<{ signals?: Array<Record<string, unknown>> }>("/api/execution/signals/by-state?tab=all").catch(
        () => ({ signals: [] as Array<Record<string, unknown>> }),
      ),
      fetchReconciliationConflicts(),
    ]).then(([data, recon]) => {
      if (cancelled) return;
      setRows((data.signals ?? []).map(mapSignal));
      setConflicts(recon.filter((c) => c.status !== "RESOLVED"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const list = rows ?? [];
    if (filter === "Unresolved") return list.filter((r) => r.state === "UNVERIFIED" || r.state === "GRACE");
    if (filter === "New") return list.filter((r) => r.state === "UNVERIFIED");
    if (filter === "Linked") return list.filter((r) => r.state === "LINKED");
    if (filter === "Killed") return list.filter((r) => r.state === "KILLED");
    if (filter === "Conflicting") return list.slice(0, Math.min(list.length, Math.max(conflicts.length, 2)));
    return list.filter((r) => r.state !== "KILLED");
  }, [rows, filter, conflicts.length]);

  const primaryOpen = selected?.openTargets[0] ?? null;

  return (
    <AppShell
      topBar={
        <TopBar
          title="Updates"
          subtitle="What Hustronix is hearing from your tools. Each update is evidence—not a final answer."
        />
      }
    >
      {conflicts.length ? (
        <Panel className={styles.criticalCard}>
          <PanelHeader title="Conflicting updates" subtitle="Two sources disagree. That is a decision, not noise." />
          <div className={styles.blockerList}>
            {conflicts.slice(0, 4).map((c) => (
              <div key={c.id} className={styles.blockerItem}>
                <header>
                  <strong>
                    {c.dimension} · {c.entity_id}
                  </strong>
                  <StatusPill label={c.severity || "High"} />
                </header>
                <span>
                  {c.conflict_type.replace(/_/g, " ")} · {c.status}
                </span>
                <a
                  className={styles.link}
                  href={`/chat?q=${encodeURIComponent(`Resolve conflicting signals on ${c.dimension} for ${c.entity_id}`)}`}
                >
                  Investigate in Chat
                </a>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="From your tools" subtitle="Slack, meetings, email, Jira, GitHub, and notes you add." />
        <FilterPills
          items={FILTERS.map((label) => ({
            label,
            count:
              label === "Conflicting"
                ? conflicts.length
                : label === "Unresolved"
                  ? (rows ?? []).filter((r) => r.state === "UNVERIFIED" || r.state === "GRACE").length
                  : label === "Killed"
                    ? (rows ?? []).filter((r) => r.state === "KILLED").length
                    : undefined,
          }))}
          active={filter}
          onChange={(label) => setFilter(label as (typeof FILTERS)[number])}
        />
        <div className={styles.signalFeed}>
          {visible.length ? (
            visible.map((s) => (
              <button
                key={s.id}
                type="button"
                className={styles.signalRow}
                onClick={() => setSelected(s)}
              >
                <StatusIcon tone={s.state === "LINKED" ? "low" : s.state === "KILLED" ? "info" : "high"}>
                  <AlertTriangle size={15} />
                </StatusIcon>
                <div>
                  <strong>{signalHeadline(s.content)}</strong>
                  <p>
                    {humanizeSignalSource(s.source)}
                    {s.sourceSubtype ? ` · ${humanizeSignalEvent(s.sourceSubtype)}` : ""} · {s.owner} · {s.detected}
                    {s.linked ? ` · linked to work` : ""}
                    {s.openTargets[0] ? ` · ${s.openTargets[0].label}` : ""}
                  </p>
                </div>
                <StatusPill label={humanizeSignalState(s.state)} />
              </button>
            ))
          ) : (
            <p className={styles.emptyHint}>
              {rows === null ? "Loading updates…" : "No updates yet. Connect tools or add a note to get started."}
            </p>
          )}
        </div>
      </Panel>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? humanizeSignalSource(selected.source) : "Update"}
        subtitle={selected ? humanizeSignalState(selected.state) : undefined}
        size="lg"
        footer={
          selected ? (
            <>
              {primaryOpen ? (
                <a
                  href={primaryOpen.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonStyles.primary}
                >
                  <ArrowUpRight size={14} />
                  {primaryOpen.label}
                </a>
              ) : (
                <a href="/settings/integrations" className={buttonStyles.ghost}>
                  Connect source in Integrations
                </a>
              )}
              <a
                href={`/chat?q=${encodeURIComponent(`Investigate this ${selected.source} signal: ${signalHeadline(selected.content)}`)}`}
                className={buttonStyles.ghost}
              >
                Investigate in Chat
              </a>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className={styles.signalDetail}>
            <SignalEvidence content={selected.content} />
            <dl className={styles.signalMeta}>
              <div>
                <dt>Source</dt>
                <dd>
                  {selected.source}
                  {selected.sourceSubtype ? ` · ${selected.sourceSubtype}` : ""}
                </dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{selected.owner}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>
                  <StatusPill label={selected.state.replace(/_/g, " ")} />
                </dd>
              </div>
              <div>
                <dt>Detected</dt>
                <dd>{selected.detected}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{selected.received || "—"}</dd>
              </div>
              {selected.graceExpires ? (
                <div>
                  <dt>Review by</dt>
                  <dd>{selected.graceExpires}</dd>
                </div>
              ) : null}
              {selected.externalId ? (
                <div>
                  <dt>External id</dt>
                  <dd className="tabular">{selected.externalId}</dd>
                </div>
              ) : null}
              {selected.linked ? (
                <div>
                  <dt>Linked execution</dt>
                  <dd className="tabular">{selected.linked}</dd>
                </div>
              ) : null}
              <div>
                <dt>Signal id</dt>
                <dd className="tabular">{selected.id}</dd>
              </div>
            </dl>

            <div className={styles.signalOpenBlock}>
              <h3>Open in source</h3>
              {selected.openTargets.length ? (
                <div className={styles.signalOpenList}>
                  {selected.openTargets.map((t) => (
                    <a
                      key={`${t.section}-${t.url}`}
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.signalOpenBtn}
                    >
                      <strong>{t.label}</strong>
                      <span>
                        {t.section} · {selected.source}
                      </span>
                      <ArrowUpRight size={14} />
                    </a>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyHint}>
                  No deep link on this signal yet. For Slack, the ingest needs channel + message timestamp; connect
                  Integrations if the source is missing.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </AppShell>
  );
}
