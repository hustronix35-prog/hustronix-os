"use client";

import {
  AlertTriangle,
  BellOff,
  Bookmark,
  Calendar,
  CheckCircle2,
  Clock,
  Ellipsis,
  SlidersHorizontal,
  Users,
  TrendingDown,
  ShieldAlert,
  Trash2,
} from "@/components/icons";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, StatusIcon, TopBar } from "@/components/shell/AppShell";
import {
  FilterPills,
  Panel,
  PanelHeader,
  StatusPill,
} from "@/components/ui/Primitives";
import {
  buttonStyles,
  Dropdown,
  Modal,
  modalStyles,
  useToast,
} from "@/components/ui/Interactions";
import {
  acknowledgeAlert,
  dismissAlert,
  fetchMoreAlerts,
  fetchNotifications,
  saveView,
  snoozeAlert,
} from "@/lib/api";
import {
  alertFilters,
} from "@/lib/mock-data";
import type { Alert } from "@/lib/types";
import styles from "../pages.module.css";

const severityIcons = {
  Critical: AlertTriangle,
  High: ShieldAlert,
  Medium: Users,
  Low: TrendingDown,
  Info: Calendar,
};

function AlertRow({
  alert,
  onAction,
  onDismiss,
  onSnooze,
  onMarkRead,
}: {
  alert: Alert;
  onAction: (alert: Alert) => void;
  onDismiss: (alert: Alert) => void;
  onSnooze: (alert: Alert) => void;
  onMarkRead: (alert: Alert) => void;
}) {
  const Icon = severityIcons[alert.severity as keyof typeof severityIcons] ?? AlertTriangle;
  return (
    <article className={styles.alertRow} data-sev={alert.severity}>
      <StatusIcon tone={alert.severity.toLowerCase()}>
        <Icon size={16} />
      </StatusIcon>
      <div className={styles.alertBody}>
        <header>
          <h3>{alert.title}</h3>
          <StatusPill label={alert.severity} />
        </header>
        <p>{alert.description}</p>
        <div className={styles.tagRow}>
          {alert.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.alertActions}>
        <span>{alert.time}</span>
        <button
          type="button"
          className={styles.alertActionBtn}
          data-sev={alert.severity}
          onClick={() => onAction(alert)}
        >
          {alert.action}
        </button>
        <Dropdown
          trigger={({ toggle }) => (
            <button type="button" aria-label="More" className={styles.iconGhostBtn} onClick={toggle}>
              <Ellipsis size={14} />
            </button>
          )}
          items={[
            { type: "item", label: "Mark as read", icon: <CheckCircle2 size={14} />, onSelect: () => onMarkRead(alert) },
            { type: "item", label: "Snooze for 1 day", icon: <Clock size={14} />, onSelect: () => onSnooze(alert) },
            { type: "separator" },
            { type: "item", label: "Dismiss alert", icon: <Trash2 size={14} />, tone: "danger", onSelect: () => onDismiss(alert) },
          ]}
        />
      </div>
    </article>
  );
}

export default function AlertsPage() {
  const [active, setActive] = useState("All Alerts");
  const [items, setItems] = useState<Alert[]>([]);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState<Alert | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedMore, setLoadedMore] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetchNotifications(50).then((notifs) => {
      if (cancelled || notifs == null) return;
      setLive(true);
      setItems(notifs);
      setLoadedMore(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const severity = active === "All Alerts" ? null : active.split(" ")[0];
  const filtered = useMemo(
    () => (severity ? items.filter((a) => a.severity === severity) : items),
    [items, severity],
  );
  const today = filtered.filter((a) => a.group === "Today");
  const yesterday = filtered.filter((a) => a.group === "Yesterday");
  const liveFilters = useMemo(() => {
    const count = (sev: string) => items.filter((a) => a.severity === sev).length;
    return [
      { label: "All Alerts", count: items.length },
      { label: "Critical", count: count("Critical") },
      { label: "High", count: count("High") },
      { label: "Medium", count: count("Medium") },
      { label: "Low", count: count("Low") },
      { label: "Info", count: count("Info") },
    ];
  }, [items]);
  const criticalLive = useMemo(
    () =>
      items
        .filter((a) => a.severity === "Critical" || a.severity === "High")
        .slice(0, 3)
        .map((a) => ({ title: a.title, meta: `${a.severity} · ${a.time}` })),
    [items],
  );

  const removeAlert = (alert: Alert) => setItems((prev) => prev.filter((a) => a.title !== alert.title));

  const destinationFor = (alert: Alert): string | null => {
    const blob = `${alert.action} ${alert.tags.join(" ")} ${alert.title} ${alert.description}`.toLowerCase();
    if (blob.includes("decision") || blob.includes("commit") || blob.includes("vow")) return "/decide";
    if (blob.includes("execut") || blob.includes("task") || blob.includes("capacity")) return "/execute";
    if (blob.includes("signal")) return "/signals";
    if (blob.includes("team")) return "/team";
    if (blob.includes("situation") || blob.includes("readiness") || blob.includes("talk")) return "/chat";
    return null;
  };

  const handleDismiss = async (alert: Alert) => {
    removeAlert(alert);
    await dismissAlert(alert.title);
    toast("Alert dismissed", { description: alert.title, tone: "success" });
  };

  const handleSnooze = async (alert: Alert) => {
    removeAlert(alert);
    await snoozeAlert(alert.title);
    toast("Snoozed for 1 day", { description: alert.title });
  };

  const handleMarkRead = async (alert: Alert) => {
    await acknowledgeAlert(alert.title);
    toast("Marked as read", { description: alert.title, tone: "success" });
  };

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const more = await fetchMoreAlerts();
    setItems((prev) => [...prev, ...more.filter((m) => !prev.some((p) => p.title === m.title))]);
    setLoadedMore(true);
    setLoadingMore(false);
  };

  const rowHandlers = {
    onAction: setSelected,
    onDismiss: handleDismiss,
    onSnooze: handleSnooze,
    onMarkRead: handleMarkRead,
  };

  return (
    <AppShell
      topBar={
        <TopBar
          title="Alerts"
          subtitle="Important changes and risks that need your attention."
          searchPlaceholder="Search alerts..."
          showUser
        />
      }
    >
      <div className={styles.filterBar}>
        <FilterPills items={live ? liveFilters : alertFilters} active={active} onChange={setActive} />
        <div className={styles.filterActions}>
          <Dropdown
            align="right"
            trigger={({ toggle }) => (
              <button type="button" className={styles.ghostAction} onClick={toggle}>
                <SlidersHorizontal size={14} /> Filters
              </button>
            )}
            items={[
              { type: "header", label: "Quick filters" },
              { type: "item", label: "Today only", onSelect: () => setActive("All Alerts") },
              { type: "item", label: "Critical only", onSelect: () => setActive("Critical 3") },
              { type: "item", label: "High only", onSelect: () => setActive("High 7") },
              { type: "separator" },
              { type: "item", label: "Reset filters", onSelect: () => setActive("All Alerts") },
            ]}
          />
          <button
            type="button"
            className={styles.ghostAction}
            aria-label="Save view"
            onClick={async () => {
              await saveView(active);
              toast("View saved", { description: `Filter "${active}" saved to your views.`, tone: "success" });
            }}
          >
            <Bookmark size={14} />
          </button>
        </div>
      </div>

      <div className={styles.gridMainRail}>
        <div className={styles.stack}>
          {today.length ? <h3 className={styles.groupTitle}>Today</h3> : null}
          {today.map((alert) => (
            <AlertRow key={alert.title} alert={alert} {...rowHandlers} />
          ))}

          {yesterday.length ? <h3 className={styles.groupTitle}>Yesterday</h3> : null}
          {yesterday.map((alert) => (
            <AlertRow key={alert.title} alert={alert} {...rowHandlers} />
          ))}

          <div className={styles.alertFooter}>
            <span>
              Showing 1–{filtered.length} of {live || loadedMore ? items.length : 28} alerts
            </span>
            {!loadedMore ? (
              <button
                type="button"
                className={styles.loadMore}
                style={{ width: "auto", margin: 0 }}
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </div>
        </div>

        <aside className={styles.rail}>
          <Panel>
            <PanelHeader
              title="Critical Now"
              action={<span className={styles.criticalCount}>{criticalLive.length}</span>}
            />
            <div className={styles.criticalNowList}>
              {criticalLive.map((item) => (
                <div key={item.title} className={styles.criticalNowItem}>
                  <StatusIcon tone="critical">
                    <AlertTriangle size={14} />
                  </StatusIcon>
                  <div>
                    <strong>{item.title}</strong>
                    <span className={styles.criticalNowMeta}>{item.meta}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.criticalNowFooter}>
              <button
                type="button"
                className={styles.link}
                onClick={() => setActive("Critical 3")}
              >
                View all critical alerts →
              </button>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Upcoming Risk Windows"
              action={<a className={styles.link} href="/brain/meetings">View calendar</a>}
            />
            <ul className={styles.riskList}>
              {items.slice(0, 3).map((a) => ({ title: a.title, note: a.description.slice(0, 80), when: a.time })).map((item) => (
                <li key={item.title}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.note}</span>
                  </div>
                  <em>{item.when}</em>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Alert Trends" action={<span className={styles.mutedLabel}>Last 7 days</span>} />
            <div className={styles.chartBox}>
              <svg className={styles.sparkline} viewBox="0 0 280 120" aria-label="Alert trends over last 7 days">
                <polyline fill="none" stroke="var(--status-critical)" strokeWidth="2" points="10,80 50,72 90,58 130,50 170,42 210,38 260,32" />
                <polyline fill="none" stroke="var(--status-high)" strokeWidth="2" points="10,88 50,82 90,76 130,70 170,64 210,60 260,55" />
                <polyline fill="none" stroke="var(--signal-gold)" strokeWidth="2" points="10,70 50,68 90,74 130,66 170,60 210,56 260,50" />
                <polyline fill="none" stroke="var(--status-low)" strokeWidth="2" points="10,96 50,94 90,90 130,92 170,88 210,86 260,84" />
                <polyline fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" points="10,102 50,100 90,98 130,99 170,96 210,95 260,94" />
              </svg>
              <div className={styles.trendLegend}>
                {["Critical", "High", "Medium", "Low", "Info"].map((label) => (
                  <span key={label} data-sev={label.toLowerCase()}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Alert Settings" action={<a className={styles.link} href="/settings">Manage</a>} />
            <button type="button" className={styles.settingsLink} onClick={() => router.push("/settings")}>
              Notification preferences <span>→</span>
            </button>
          </Panel>
        </aside>
      </div>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ""}
        subtitle={`${selected?.severity} · ${selected?.time}`}
        footer={
          <>
            <button type="button" className={buttonStyles.ghost} onClick={() => selected && handleSnooze(selected).then(() => setSelected(null))}>
              <BellOff size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              Snooze
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              onClick={async () => {
                if (!selected) return;
                const dest = destinationFor(selected);
                await acknowledgeAlert(selected.title);
                const title = selected.title;
                setSelected(null);
                if (dest) {
                  router.push(dest);
                  return;
                }
                toast("Acknowledged", { description: title, tone: "success" });
              }}
            >
              {selected?.action}
            </button>
          </>
        }
      >
        <p className={modalStyles.text}>{selected?.description}</p>
        <div className={modalStyles.kvGrid}>
          <div>
            <span>Severity</span>
            <strong>{selected?.severity}</strong>
          </div>
          <div>
            <span>Detected</span>
            <strong>{selected?.time}</strong>
          </div>
          <div>
            <span>Scope</span>
            <strong>{selected?.tags.join(", ")}</strong>
          </div>
        </div>
        <ul className={modalStyles.list}>
          <li>
            <AlertTriangle size={14} color="var(--status-high)" />
            {live ? "From in-app notifications" : "Related decision: Delay Mobile Launch by 5 Days (91% confidence)"}
          </li>
          <li>
            <Users size={14} color="var(--status-info)" />
            Owners notified: Engineering, QA leads
          </li>
        </ul>
      </Modal>
    </AppShell>
  );
}
