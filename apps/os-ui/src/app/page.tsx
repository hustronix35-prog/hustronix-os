"use client";

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Rocket,
  Tag,
  Users,
} from "@/components/icons";
import { useEffect, useState } from "react";
import { AppShell, StatusIcon, TopBar } from "@/components/shell/AppShell";
import {
  HealthRing,
  Panel,
  PanelHeader,
  ProgressBar,
  StatusPill,
} from "@/components/ui/Primitives";
import {
  fetchMe,
  fetchMissionSummary,
  fetchNotifications,
  fetchAttentionBrief,
  talkToHustronix,
  type AttentionItem,
  type LedgerDecision,
  type MissionSummary,
} from "@/lib/api";
import {
  confidencePct,
  firstName,
  focusFromExecutions,
  founderDecisionBrief,
  greetingForHour,
  readableLedgerText,
  scheduleFromSignals,
} from "@/lib/live-mappers";
import type { Alert, FocusItem, ScheduleItem } from "@/lib/types";
import styles from "./pages.module.css";

const focusIcons = {
  rocket: Rocket,
  users: Users,
  tag: Tag,
  building: Building2,
};

function whyFromDecision(d: LedgerDecision, s: MissionSummary): string[] {
  const out: string[] = [];
  const brief = founderDecisionBrief(d.decision_reasoning);
  if (brief.summary) out.push(brief.summary.slice(0, 220));
  const outcomes = readableLedgerText(d.expected_outcomes);
  if (outcomes) out.push(`Expected: ${outcomes.slice(0, 140)}`);
  if (s.executionSummary.blocked) out.push(`${s.executionSummary.blocked} blocked execution(s) on the ledger`);
  if (s.unverifiedSignalCount) out.push(`${s.unverifiedSignalCount} unverified signal(s)`);
  if (s.capacity.loadPct >= 80) out.push(`Owner ${s.capacity.owner} at ${s.capacity.loadPct}% load`);
  if (!out.length) out.push("Commit writes an auditable entry on the decision ledger.");
  return out.slice(0, 3);
}

export default function HomePage() {
  const [name, setName] = useState("Spandan");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [focus, setFocus] = useState<FocusItem[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [summary, setSummary] = useState<MissionSummary | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchMe(),
      fetchMissionSummary(),
      fetchNotifications(20),
    ]).then(([me, s, notifs]) => {
        if (cancelled) return;
        if (!s && !me) return;
        setLive(true);
        if (me?.profile.displayName) setName(firstName(me.profile.displayName, "there"));
        if (s) {
          setSummary(s);
          const focusLive = focusFromExecutions(s.mcExecutions);
          if (focusLive.length) setFocus(focusLive);
          else setFocus([]);
          setSchedule(scheduleFromSignals(s.signalsPreview));
        } else if (me) {
          setAlerts(notifs ? notifs.slice(0, 4) : []);
        }
        if (notifs) setAlerts(notifs.slice(0, 4));
        else if (me || s) setAlerts([]);
      },
    );
    talkToHustronix("What's going wrong in the company?").then((turn) => {
      if (!cancelled && turn?.answer) setBrief(turn.answer);
    });
    fetchAttentionBrief().then((b) => {
      if (!cancelled && b?.items) setAttention(b.items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const decision = summary?.decision ?? null;
  const conf = confidencePct(decision?.confidence);
  const health = summary
    ? Math.max(0, Math.min(100, 100 - summary.executionSummary.blocked * 15 - (summary.capacity.loadPct >= 100 ? 20 : 0)))
    : 0;
  const healthTone =
    !summary ? "at-risk" : summary.executionSummary.blocked ? "at-risk" : health >= 70 ? "healthy" : "at-risk";
  const why = decision && summary ? whyFromDecision(decision, summary) : [];

  return (
    <AppShell
      topBar={
        <TopBar
          title={`${greetingForHour()}, ${name}`}
          subtitle={live ? "What needs attention — then continue in Talk." : "Loading live ledger…"}
          showAsk={false}
        />
      }
    >
      <div className={`${styles.grid2} ${styles.homeLead}`}>
        <div className={styles.stack}>
        <Panel className={styles.criticalCard}>
          <div className={styles.criticalTop}>
            <div className={styles.criticalMain}>
              <p className={styles.eyebrow}>{live ? "Active decision" : "Ledger"}</p>
              {decision ? (
                <>
                  <h3>{decision.vow}</h3>
                  <p>
                    {founderDecisionBrief(decision.decision_reasoning).summary ||
                      readableLedgerText(decision.expected_outcomes) ||
                      `Status ${decision.status.replace(/_/g, " ")} on the decision ledger.`}
                  </p>
                  <div className={styles.metaRow}>
                    <div className={styles.metaItem}>
                      <span>Confidence</span>
                      <strong>{conf != null ? `${conf}%` : "—"}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Status</span>
                      <strong>{decision.status.replace(/_/g, " ")}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Owner</span>
                      <strong>{summary?.decisionOwner.displayName || summary?.capacity.owner || "—"}</strong>
                    </div>
                  </div>
                  <div className={styles.actionsRow}>
                    <a href="/chat" className={styles.primaryBtn}>
                      Ask Hustronix <ArrowRight size={15} />
                    </a>
                    <a
                      href={`/chat?q=${encodeURIComponent(`What's happening: ${decision.vow}`)}`}
                      className={styles.ghostLink}
                    >
                      Explain this risk
                    </a>
                    <a className={styles.link} href="/decide">
                      Inspect ledger
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <h3>{live ? "No active decision" : "Loading…"}</h3>
                  <p>
                    {live
                      ? "Nothing on the ledger needs a commit right now. New vows show up here after Decide."
                      : "Reading the decision ledger."}
                  </p>
                  <div className={styles.actionsRow}>
                    <a href="/chat" className={styles.primaryBtn}>
                      Ask Hustronix <ArrowRight size={15} />
                    </a>
                  </div>
                </>
              )}
            </div>
            <div className={styles.criticalAside}>
              <HealthRing
                value={live ? health : 0}
                label={live ? (summary?.executionSummary.blocked ? "Blocked" : "Ledger") : "Live"}
                tone={healthTone}
                size="lg"
              />
              <div className={styles.whyBox}>
                <h4>Why it matters</h4>
                {live ? (
                  <ul className={styles.whyList}>
                    {why.map((line) => (
                      <li key={line}>
                        <StatusIcon tone="medium">
                          <AlertTriangle size={14} />
                        </StatusIcon>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.emptyHint}>Loading live ledger…</p>
                )}
                <a className={styles.link} href="/chat" style={{ marginTop: 8, display: "inline-block" }}>
                  Ask Hustronix →
                </a>
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Critical initiatives"
            action={<a className={styles.link} href="/execute">Open tasks</a>}
          />
          <div className={styles.focusGrid}>
            {focus.length ? (
              focus.map((item, index) => {
                const Icon = focusIcons[item.icon as keyof typeof focusIcons] ?? Rocket;
                return (
                  <article key={item.id || `${item.title}-${index}`} className={styles.focusCard}>
                    <header>
                      <div className={styles.focusTitle}>
                        <StatusIcon tone={item.statusTone}>
                          <Icon size={15} />
                        </StatusIcon>
                        <h3>{item.title}</h3>
                      </div>
                      <StatusPill label={item.status} tone={item.statusTone} />
                    </header>
                    <ProgressBar
                      value={item.progress}
                      tone={
                        item.statusTone === "at-risk"
                          ? "orange"
                          : item.statusTone === "pending"
                            ? "purple"
                            : "blue"
                      }
                    />
                    <footer>
                      <span>{item.progress}%</span>
                      <span>{item.due}</span>
                    </footer>
                  </article>
                );
              })
            ) : (
              <p className={styles.emptyHint}>No active or blocked executions.</p>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title={live ? "Unverified signals" : "Signals"}
            action={<a className={styles.link} href="/signals">View signals</a>}
          />
          <div className={styles.schedule}>
            {schedule.length ? (
              schedule.map((item, index) => (
                <div
                  key={`${item.time}-${item.title}`}
                  className={styles.scheduleItem}
                  data-highlight={item.highlight ? "true" : "false"}
                >
                  <div className={styles.scheduleRail} aria-hidden>
                    <span className={styles.scheduleDot} />
                    {index < schedule.length - 1 ? <span className={styles.scheduleLine} /> : null}
                  </div>
                  <time>{item.time}</time>
                  <div className={styles.scheduleBody}>
                    <strong>{item.title}</strong>
                    {item.badge ? <StatusPill label={item.badge} tone="medium" /> : null}
                  </div>
                </div>
              ))
            ) : (
              <p className={styles.emptyHint}>{live ? "No unverified signals." : "Loading live signals…"}</p>
            )}
          </div>
        </Panel>
        </div>

        <div className={styles.stack}>
          {attention.length ? (
            <Panel>
              <PanelHeader
                title="What needs attention"
                action={
                  <a className={styles.link} href="/chat">
                    Open Talk
                  </a>
                }
              />
              <div className={styles.alertList}>
                {attention.map((item) => (
                  <div key={`${item.kind}-${item.rank}-${item.title}`} className={styles.alertItem}>
                    <StatusIcon tone={item.kind === "failed_outcome" || item.kind === "blocked_execution" ? "critical" : "medium"}>
                      <AlertTriangle size={15} />
                    </StatusIcon>
                    <div>
                      <strong>
                        {item.rank}. {item.title}
                      </strong>
                      <p>{item.why}</p>
                      <a className={styles.link} href={item.href}>
                        Ask in Talk
                      </a>
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.actionsRow} style={{ marginTop: 12 }}>
                <a href="/chat" className={styles.primaryBtn}>
                  Ask Hustronix <ArrowRight size={15} />
                </a>
              </div>
            </Panel>
          ) : brief ? (
            <Panel>
              <PanelHeader
                title="Company brief"
                action={
                  <a className={styles.link} href="/chat">
                    Continue in Talk
                  </a>
                }
              />
              <p style={{ whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.5 }}>
                {brief.split("\n").slice(0, 10).join("\n")}
              </p>
              <div className={styles.actionsRow} style={{ marginTop: 12 }}>
                <a href="/chat" className={styles.primaryBtn}>
                  Ask Hustronix <ArrowRight size={15} />
                </a>
              </div>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Attention required" action={<a className={styles.link} href="/alerts">View all</a>} />
            <div className={styles.alertList}>
              {alerts.length ? (
                alerts.map((alert) => (
                  <div key={alert.id || alert.title} className={styles.alertItem}>
                    <StatusIcon tone={alert.severity.toLowerCase()}>
                      <AlertTriangle size={15} />
                    </StatusIcon>
                    <div>
                      <strong>{alert.title}</strong>
                      <p>{alert.description}</p>
                      <a
                        className={styles.link}
                        href={`/chat?q=${encodeURIComponent(`Explain this risk: ${alert.title}`)}`}
                      >
                        Explain this risk
                      </a>
                    </div>
                    <div className={styles.alertMeta}>
                      <StatusPill label={alert.severity} />
                      <span>{alert.time}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className={styles.emptyHint}>No notifications on the ledger.</p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
