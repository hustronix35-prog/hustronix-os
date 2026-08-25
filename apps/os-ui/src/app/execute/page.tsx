"use client";

import { AlertTriangle, TrendingUp } from "@/components/icons";
import { useEffect, useState } from "react";
import { AppShell, StatusIcon, TopBar } from "@/components/shell/AppShell";
import {
  HealthRing,
  Panel,
  PanelHeader,
  ProgressBar,
  StatusPill,
} from "@/components/ui/Primitives";
import { ExecutionMap } from "@/components/viz/Visualizations";
import { buttonStyles } from "@/components/ui/Interactions";
import {
  answerClarification,
  dismissClarification,
  fetchExecutionLedger,
  fetchMissionSummary,
  fetchOpenClarifications,
  fetchOrchestration,
  fetchTeamMetrics,
  authorizeOrchestrationAction,
  runOrchestration,
  completeDecision,
  type ClarificationView,
  type MissionSummary,
  type OrchestrationSummary,
} from "@/lib/api";
import {
  activeDecisionsFromLedger,
  blockersFromLedger,
  capacityRowsFromTeams,
  executeMetricsFromSummary,
  mapRowsFromLedger,
} from "@/lib/live-mappers";
import {
  activeExecutionDecisions,
  blockers as mockBlockers,
  capacityData,
} from "@/lib/mock-data";
import type { Metric } from "@/lib/types";
import styles from "../pages.module.css";

function MetricRing({
  value,
  max = 12,
  tone,
}: {
  value: number;
  max?: number;
  tone: string;
}) {
  return <HealthRing value={value} max={max} label="" tone={tone} size="sm" />;
}

const ACTION_LABEL: Record<string, string> = {
  LINK_EXISTING_WORK: "Existing work reconciled",
  CREATE_JIRA: "Create Jira issue",
  UPDATE_JIRA: "Update Jira issue",
  CREATE_MEETING: "Coordination meeting",
  ASK_CLARIFICATION: "Clarification",
  NOTIFY_OWNER: "Notify owner",
  NOTIFY_FOUNDER: "Notify founder",
  RECOMMEND_OWNER: "Recommend owner",
  ASSIGN_OWNER: "Assign owner",
};

function orchTone(status: string): string {
  const s = status.toUpperCase();
  if (s === "COMPLETED") return "low";
  if (s === "AWAITING_APPROVAL") return "medium";
  if (s === "BLOCKED_CONNECTOR" || s === "FAILED" || s === "DENIED") return "critical";
  return "medium";
}

export default function ExecutePage() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [decisions, setDecisions] = useState<typeof activeExecutionDecisions>([]);
  const [capacity, setCapacity] = useState<typeof capacityData>([]);
  const [blockers, setBlockers] = useState<typeof mockBlockers>([]);
  const [insights, setInsights] = useState<string[]>([]);
  const [mapRows, setMapRows] = useState<ReturnType<typeof mapRowsFromLedger> | null>(null);
  const [summary, setSummary] = useState<MissionSummary | null>(null);
  const [live, setLive] = useState(false);
  const [clarifications, setClarifications] = useState<ClarificationView[]>([]);
  const [clarifyDrafts, setClarifyDrafts] = useState<Record<string, string>>({});
  const [clarifyBusy, setClarifyBusy] = useState<string | null>(null);
  const [clarifyError, setClarifyError] = useState<string | null>(null);
  const [clarifyFocus, setClarifyFocus] = useState<string | null>(null);
  const [focusVow, setFocusVow] = useState<string | null>(null);
  const [focusDecision, setFocusDecision] = useState<string | null>(null);
  const [orch, setOrch] = useState<OrchestrationSummary | null>(null);
  const [orchBusy, setOrchBusy] = useState<string | null>(null);
  const [completeBusy, setCompleteBusy] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const clarify = q.get("clarify");
    const decision = q.get("decision");
    if (clarify) setClarifyFocus(clarify);

    if (decision) setFocusDecision(decision);

    let cancelled = false;
    Promise.all([
      fetchMissionSummary(),
      fetchExecutionLedger("all"),
      fetchTeamMetrics(),
      fetchOpenClarifications(),
      decision ? fetchOrchestration(decision) : Promise.resolve(null),
    ]).then(([s, ledger, teams, openClarify, orchestration]) => {
      if (cancelled) return;
      if (!s && !ledger && !teams && !openClarify && !orchestration) return;
      setLive(true);
      if (s) {
        setSummary(s);
        setMetrics(executeMetricsFromSummary(s));
      }
      if (ledger) {
        const scoped = decision ? ledger.filter((r) => r.decision_id === decision) : ledger;
        const use = scoped.length ? scoped : ledger;
        setDecisions(activeDecisionsFromLedger(use));
        setBlockers(blockersFromLedger(use));
        setMapRows(mapRowsFromLedger(use));
        if (decision) {
          const vow = use.find((r) => r.decision_id === decision)?.decision_vow;
          if (vow) setFocusVow(vow);
        }
      } else {
        setDecisions([]);
        setBlockers([]);
        setMapRows([]);
      }
      if (teams) {
        const rows = capacityRowsFromTeams(teams);
        if (rows.length) setCapacity(rows);
        else setCapacity([]);
        if (teams.insights.length) setInsights(teams.insights);
      } else if (s) {
        const { blocked, active, pending, total } = s.executionSummary;
        const next: string[] = [];
        if (blocked) next.push(`${blocked} execution(s) blocked on the ledger.`);
        if (s.capacity.loadPct >= 80) next.push(`${s.capacity.owner} load is ${s.capacity.loadPct}% of capacity.`);
        if (total) next.push(`${active} active, ${pending} pending, ${total} total executions.`);
        setInsights(next.length ? next : ["No team metrics yet — executions drive this panel."]);
      }
      if (openClarify) {
        setClarifications(
          decision ? openClarify.filter((c) => c.decisionId === decision) : openClarify,
        );
      }
      if (orchestration) setOrch(orchestration);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = summary?.executionSummary.total || 0;
  const active = summary?.executionSummary.active || 0;
  const pending = summary?.executionSummary.pending || 0;
  const blocked = summary?.executionSummary.blocked || 0;
  const done = summary?.executionSummary.done || 0;
  const onTrackPct = total ? Math.round(((done + active) / total) * 100) : 0;
  const pendingPct = total ? Math.round((pending / total) * 100) : 0;
  const blockedPct = total ? Math.round((blocked / total) * 100) : 0;
  const healthRing = live
    ? total
      ? Math.max(0, Math.min(100, Math.round((done / total) * 100) + Math.round((active / total) * 40)))
      : 0
    : 68;

  const refreshOrch = async () => {
    if (!focusDecision) return;
    const next = await fetchOrchestration(focusDecision);
    if (next) setOrch(next);
  };

  const authorizeOne = async (actionId: string) => {
    setOrchBusy(actionId);
    try {
      const out = await authorizeOrchestrationAction(actionId);
      if (out?.orchestration) setOrch(out.orchestration);
      else await refreshOrch();
    } finally {
      setOrchBusy(null);
    }
  };

  const rerunOrch = async () => {
    if (!focusDecision) return;
    setOrchBusy("run");
    try {
      const next = await runOrchestration(focusDecision);
      if (next) setOrch(next);
    } finally {
      setOrchBusy(null);
    }
  };

  const markComplete = async (decisionId: string) => {
    if (!decisionId || completeBusy) return;
    setCompleteBusy(decisionId);
    setCompleteError(null);
    try {
      const out = await completeDecision(decisionId);
      if (!out.ok) {
        setCompleteError(out.error || "Could not complete that decision.");
        return;
      }
      const ledger = await fetchExecutionLedger("all");
      if (ledger) {
        setDecisions(activeDecisionsFromLedger(ledger));
      }
    } finally {
      setCompleteBusy(null);
    }
  };

  return (
    <AppShell
      topBar={
        <TopBar
          title="Tasks"
          subtitle={
            focusVow
              ? `Execution for: ${focusVow}`
              : live
                ? "Are decisions turning into outcomes? Blockers, owners, and the critical path."
                : "Work created from decisions. Not a generic task list."
          }
          askLabel="Ask AI"
          showUser
        />
      }
    >
      <div className={styles.executeMetrics}>
        {metrics.map((m) => (
          <Panel key={m.label} className={styles.executeMetricCard}>
            <div>
              <div className={styles.executeMetricValue}>{m.value}</div>
              <div className={styles.executeMetricLabel}>{m.label}</div>
              <div className={styles.executeMetricSub}>{m.subtitle}</div>
            </div>
            {m.label.toLowerCase().includes("active") ? (
              <span className={styles.sparkWrap} aria-hidden>
                <TrendingUp size={28} color="var(--status-low)" />
              </span>
            ) : (
              <MetricRing
                value={Number(m.value)}
                max={Math.max(12, Number(m.value) || 12)}
                tone={m.status ?? "info"}
              />
            )}
          </Panel>
        ))}
      </div>

      <div className={styles.gridMainRail}>
        <div className={styles.stack}>
          {orch ? (
            <Panel>
              <PanelHeader
                title="Orchestration"
                subtitle={`${orch.status} · readiness ${orch.readinessPct}%`}
                action={
                  <button type="button" className={styles.link} disabled={orchBusy === "run"} onClick={() => void rerunOrch()}>
                    {orchBusy === "run" ? "Running…" : "Re-run"}
                  </button>
                }
              />
              <p className={styles.consoleVow}>{orch.vow}</p>
              <div className={styles.teamStats}>
                <span>
                  <strong>{orch.counts.existing}</strong> existing
                </span>
                <span>
                  <strong>{orch.counts.missing}</strong> missing
                </span>
                <span>
                  <strong>{orch.counts.meetings}</strong> meetings
                </span>
                <span>
                  <strong>{orch.counts.clarifications}</strong> clarifications
                </span>
                <span>
                  <strong>{orch.people.length}</strong> owners
                </span>
              </div>
              <ProgressBar
                value={orch.readinessPct}
                tone={orch.readinessPct >= 70 ? "green" : orch.readinessPct >= 45 ? "orange" : "red"}
              />
              <p className={styles.mutedLabel}>{orch.recommendedNext}</p>
              {orch.people.length ? (
                <p className={styles.mutedLabel}>People: {orch.people.join(" · ")}</p>
              ) : null}
              <ul className={styles.orchList}>
                {orch.actions.map((a) => (
                  <li key={a.id}>
                    <div>
                      <strong>{ACTION_LABEL[a.actionType] || a.actionType}</strong>
                      <span>{a.reason}</span>
                      {a.error ? <small>{a.error}</small> : null}
                    </div>
                    <StatusPill label={a.status.replace(/_/g, " ")} tone={orchTone(a.status)} />
                    {a.status === "AWAITING_APPROVAL" ? (
                      <button
                        type="button"
                        className={buttonStyles.primary}
                        disabled={orchBusy === a.id}
                        onClick={() => void authorizeOne(a.id)}
                      >
                        {orchBusy === a.id ? "Authorizing…" : "Authorize"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {mapRows && mapRows.length === 0 ? (
            <Panel>
              <PanelHeader title="Execution Map" />
              <p className={styles.emptyHint}>No executions on the ledger yet.</p>
            </Panel>
          ) : (
            <ExecutionMap rows={mapRows ?? undefined} subtitle={live ? "From execution ledger" : undefined} />
          )}

          <div className={styles.grid2}>
            <Panel>
              <PanelHeader title="Active Decisions" />
              {completeError ? <p className={styles.emptyHint}>{completeError}</p> : null}
              <div className={styles.miniList}>
                {decisions.length ? (
                  decisions.map((item) => (
                    <div key={item.decisionId || item.title} className={styles.miniItem}>
                      <header>
                        <strong>{item.title}</strong>
                        <StatusPill label={item.status} />
                      </header>
                      <div className={styles.executeDecisionMeta}>
                        <HealthRing
                          value={item.progress}
                          label=""
                          tone={item.status === "At Risk" ? "at-risk" : "healthy"}
                          size="sm"
                        />
                        <div>
                          <ProgressBar
                            value={item.progress}
                            tone={item.status === "At Risk" ? "orange" : "green"}
                          />
                          <div className={styles.executeDecisionFoot}>
                            <span>Started {item.start}</span>
                            <span>Updated {item.due}</span>
                          </div>
                          <div className={styles.avatarStack}>
                            {item.avatars.map((a) => (
                              <span key={a} className={styles.miniAvatar}>
                                {a}
                              </span>
                            ))}
                          </div>
                          {"completionEligible" in item && item.completionEligible && item.decisionId ? (
                            <button
                              type="button"
                              className={buttonStyles.primary}
                              disabled={completeBusy === item.decisionId}
                              onClick={() => void markComplete(item.decisionId)}
                            >
                              {completeBusy === item.decisionId ? "Completing…" : "Complete decision"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className={styles.emptyHint}>No active or blocked executions.</p>
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Capacity Overview" action={<span className={styles.mutedLabel}>{live ? "Ledger owners" : "This Week"}</span>} />
              <div className={styles.capacityLegend}>
                <span data-tone="over">Over</span>
                <span data-tone="opt">Optimal</span>
                <span data-tone="under">Under</span>
              </div>
              <div className={styles.capacityChart}>
                {capacity.map((row) => (
                  <div key={row.team} className={styles.capacityRow}>
                    <span>{row.team}</span>
                    <div className={styles.capacityBar} aria-label={`${row.team} capacity`}>
                      <span style={{ width: `${row.over}%` }} />
                      <span style={{ width: `${row.optimal}%` }} />
                      <span style={{ width: `${row.under}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <aside className={styles.rail}>
          {live && clarifications.length > 0 ? (
            <Panel>
              <PanelHeader
                title="Needs clarification"
                subtitle="Exception channel. Answers update the ledger, not a chat transcript."
              />
              <div className={styles.clarifyList}>
                {clarifications.map((c) => (
                  <div
                    key={c.id}
                    className={styles.clarifyItem}
                    data-focus={clarifyFocus === c.id ? "true" : undefined}
                  >
                    <header>
                      <strong>{c.questionType}</strong>
                      <StatusPill label={c.trigger} />
                    </header>
                    <p className={styles.clarifyReason}>{c.question}</p>
                    <div className={styles.clarifyMeta}>
                      {c.owner || "unassigned"} · {c.requestedFields.join(" · ") || c.questionType.toLowerCase()}
                    </div>
                    <textarea
                      className={styles.clarifyTextarea}
                      rows={3}
                      placeholder="Status, ETA, blocker, or owner. One or two facts."
                      value={clarifyDrafts[c.id] ?? ""}
                      onChange={(e) =>
                        setClarifyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                    />
                    {clarifyError && clarifyBusy === c.id ? (
                      <p className={styles.clarifyResult} data-tone="danger">
                        {clarifyError}
                      </p>
                    ) : null}
                    <div className={styles.clarifyActions}>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        disabled={clarifyBusy === c.id || !(clarifyDrafts[c.id] || "").trim()}
                        onClick={async () => {
                          const answer = (clarifyDrafts[c.id] || "").trim();
                          if (!answer) return;
                          setClarifyBusy(c.id);
                          setClarifyError(null);
                          const result = await answerClarification(c.id, answer);
                          setClarifyBusy(null);
                          if (!result) {
                            setClarifyError("Could not commit that answer. Try again.");
                            return;
                          }
                          setClarifications((prev) => prev.filter((row) => row.id !== c.id));
                          setClarifyDrafts((prev) => {
                            const next = { ...prev };
                            delete next[c.id];
                            return next;
                          });
                        }}
                      >
                        {clarifyBusy === c.id ? "Updating ledger…" : "Update ledger"}
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={clarifyBusy === c.id}
                        onClick={async () => {
                          setClarifyBusy(c.id);
                          setClarifyError(null);
                          const dismissed = await dismissClarification(c.id);
                          setClarifyBusy(null);
                          if (!dismissed) {
                            setClarifyError("Dismiss failed.");
                            return;
                          }
                          setClarifications((prev) => prev.filter((row) => row.id !== c.id));
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Execution Health" />
            <div className={styles.healthBlock}>
              <HealthRing
                value={healthRing}
                label={live ? (blocked ? "Blocked" : total ? "Ledger" : "Empty") : "Live"}
                tone={blocked ? "critical" : healthRing >= 70 ? "healthy" : "at-risk"}
                size="lg"
              />
              <div className={styles.legendStack}>
                <div><span>Executed + active</span><strong>{live ? `${onTrackPct}%` : "—"}</strong></div>
                <ProgressBar value={live ? onTrackPct : 0} tone="green" />
                <div><span>Pending</span><strong>{live ? `${pendingPct}%` : "—"}</strong></div>
                <ProgressBar value={live ? pendingPct : 0} tone="orange" />
                <div><span>Blocked</span><strong>{live ? `${blockedPct}%` : "—"}</strong></div>
                <ProgressBar value={live ? blockedPct : 0} tone="red" />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Top Blockers" />
            <div className={styles.blockerList}>
              {blockers.length ? (
                blockers.map((b) => (
                  <div key={b.title} className={styles.blockerItem}>
                    <header>
                      <strong>{b.title}</strong>
                      <StatusPill label={b.severity} />
                    </header>
                    <div className={styles.blockerMeta}>
                      <span>
                        {b.note} · {b.since}
                      </span>
                      <span className={styles.miniAvatar}>{b.owner}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className={styles.emptyHint}>No blocked executions.</p>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Execution Insights" />
            <ul className={styles.insightBullets}>
              {insights.map((item) => (
                <li key={item}>
                  <StatusIcon tone="medium">
                    <AlertTriangle size={14} />
                  </StatusIcon>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}
