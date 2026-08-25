"use client";

import { useEffect, useState } from "react";
import { Panel, PanelHeader } from "@/components/ui/Primitives";
import { fetchSettingsMap, saveSettingsBulk } from "@/lib/api";
import { SaveButton, SettingsShell, Toggle } from "../_components/SettingsShell";
import styles from "../settings.module.css";

type Tab = "Channels" | "Preferences";

function on(v: string | undefined, fallback = true) {
  if (v == null) return fallback;
  return v !== "0" && v !== "false";
}

export default function NotificationsSettingsPage() {
  const [tab, setTab] = useState<Tab>("Channels");
  const [email, setEmail] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [slack, setSlack] = useState(true);
  const [decisionAlerts, setDecisionAlerts] = useState(true);
  const [execRisks, setExecRisks] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [mentions, setMentions] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSettingsMap().then((settings) => {
      if (cancelled) return;
      if (settings) {
        setEmail(on(settings["notify.email.decisions"]));
        setInApp(on(settings["notify.in_app.system"]));
        setSlack(on(settings["notify.slack.alerts"]));
        setDecisionAlerts(on(settings["notify.in_app.decision_updates"]));
        setExecRisks(on(settings["notify.in_app.executions"]));
        setWeeklyDigest(on(settings["notify.in_app.digest"]));
        setMentions(on(settings["notify.in_app.mentions"]));
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setHint(null);
    setError(null);
    try {
      const flag = (v: boolean) => (v ? "1" : "0");
      await saveSettingsBulk({
        "notify.email.decisions": flag(email),
        "notify.email.executions": flag(email),
        "notify.email.signals": flag(email),
        "notify.in_app.system": flag(inApp),
        "notify.slack.alerts": flag(slack),
        "notify.slack.decisions": flag(slack),
        "notify.in_app.decision_updates": flag(decisionAlerts),
        "ui.notify_decision_updates": flag(decisionAlerts),
        "notify.in_app.executions": flag(execRisks),
        "ui.notify_execution_milestones": flag(execRisks),
        "notify.in_app.digest": flag(weeklyDigest),
        "ui.notify_weekly_summary": flag(weeklyDigest),
        "notify.in_app.mentions": flag(mentions),
      });
      setHint("Saved to your account");
      window.setTimeout(() => setHint(null), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save notifications");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsShell title="Notifications" subtitle="Channels and alert delivery preferences.">
      <div className={styles.tabs} role="tablist" aria-label="Notification sections">
        {(["Channels", "Preferences"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className={styles.tab}
            data-active={tab === t}
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Channels" ? (
        <Panel>
          <PanelHeader title="Delivery Channels" />
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>Email</strong>
              <span>Send alerts and digests to your work inbox</span>
            </div>
            <Toggle on={email} onClick={() => setEmail((v) => !v)} label="Email notifications" />
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>In-App</strong>
              <span>Show notifications inside Hustronix</span>
            </div>
            <Toggle on={inApp} onClick={() => setInApp((v) => !v)} label="In-app notifications" />
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>Slack</strong>
              <span>Critical and high severity only, when Slack is connected</span>
            </div>
            <Toggle on={slack} onClick={() => setSlack((v) => !v)} label="Slack notifications" />
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>Microsoft Teams</strong>
              <span>Teams delivery is not connected yet</span>
            </div>
            <button type="button" className={styles.ghostBtn} disabled title="Microsoft Teams delivery is not available yet">
              Unavailable
            </button>
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>SMS</strong>
              <span>Critical-only SMS is not available yet</span>
            </div>
            <button type="button" className={styles.ghostBtn} disabled title="SMS is not available yet">
              Unavailable
            </button>
          </div>
        </Panel>
      ) : (
        <Panel>
          <PanelHeader title="Alert Preferences" />
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>Decision alerts</strong>
              <span>Notify when decisions need your commit or review</span>
            </div>
            <Toggle
              on={decisionAlerts}
              onClick={() => setDecisionAlerts((v) => !v)}
              label="Decision alerts"
            />
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>Execution risks</strong>
              <span>Surface blockers and off-track milestones</span>
            </div>
            <Toggle on={execRisks} onClick={() => setExecRisks((v) => !v)} label="Execution risks" />
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>Weekly digest</strong>
              <span>Monday summary of decisions, alerts, and progress</span>
            </div>
            <Toggle
              on={weeklyDigest}
              onClick={() => setWeeklyDigest((v) => !v)}
              label="Weekly digest"
            />
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleMeta}>
              <strong>Mentions & assignments</strong>
              <span>When someone @mentions you or assigns work</span>
            </div>
            <Toggle on={mentions} onClick={() => setMentions((v) => !v)} label="Mentions" />
          </div>
        </Panel>
      )}

      <div className={styles.footerActions}>
        {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
        {error ? <span className={styles.fieldHint}>{error}</span> : null}
        <SaveButton onClick={() => void save()} busy={busy} disabled={!loaded} />
      </div>
    </SettingsShell>
  );
}
