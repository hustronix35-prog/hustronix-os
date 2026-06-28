"use client";

import { Save, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActiveIntegrationsAside } from "@/components/integrations/ActiveIntegrationsAside";
import { ConnectionHealthCard } from "@/components/integrations/ConnectionHealthCard";
import { IntegrationConnectModal } from "@/components/integrations/IntegrationConnectModal";
import { CapacitySettingsPanel } from "@/components/settings/CapacitySettingsPanel";
import { ApprovalsPanel } from "@/components/settings/ApprovalsPanel";
import { PasswordCard } from "@/components/security/PasswordCard";
import { DashboardHero } from "@/components/shell/DashboardHero";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { useToast } from "@/components/ui/toast";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { ToggleRow } from "@/components/ui/toggle-row";
import {
  integrations,
  settingsTabs,
  type IntegrationDefinition,
} from "@/data/settings";
import { apiDelete, apiGet, apiPost, getApiBase } from "@/lib/api";
import {
  normalizeMeIntegrations,
  type MeIntegrationsPayload,
} from "@/lib/me-integrations";
import {
  fetchIntegrationsHealth,
  type IntegrationHealth,
  type IntegrationsHealthPayload,
} from "@/lib/integrations-health";
import { openIntegrationOAuthPopup } from "@/lib/oauth-window";
import { cn } from "@/lib/cn";

const SETTINGS_TAB_SLUG: Record<(typeof settingsTabs)[number], string> = {
  General: "general",
  Connections: "connections",
  Approvals: "approvals",
  "Rules & Policies": "rules",
  Capacity: "capacity",
  Notifications: "notifications",
  Security: "security",
  Billing: "billing",
};

/**
 * Backend `oauth_providers` ids map to one or more UI slugs. The backend
 * collapses Microsoft (Teams/Outlook Calendar/Outlook Mail) and Google
 * (Calendar/Gmail) onto a single provider id, but the UI exposes the per-
 * surface slug so the user picks specific scopes. Default to first slug
 * when the user clicks Reconnect from a health row.
 */
const PROVIDER_TO_PRIMARY_SLUG: Record<string, IntegrationDefinition["id"]> = {
  slack: "slack",
  github: "github",
  microsoft: "ms_teams",
  google: "google_calendar",
  notion: "notion",
  jira: "jira",
  linear: "linear",
};

function integrationLiveConnected(
  i: IntegrationDefinition,
  live: MeIntegrationsPayload | null,
): boolean {
  if (!live) return false;
  switch (i.id) {
    case "slack":
      return live.slack.connected;
    case "github":
      return live.github.connected;
    case "google_calendar":
      return live.googleCalendar.connected;
    case "notion":
      return live.notion.connected;
    case "gmail":
      return live.gmail.connected;
    default:
      return i.connected;
  }
}

const TAB_FROM_QUERY: Record<string, (typeof settingsTabs)[number]> = {
  general: "General",
  connections: "Connections",
  approvals: "Approvals",
  rules: "Rules & Policies",
  capacity: "Capacity",
  notifications: "Notifications",
  security: "Security",
  billing: "Billing",
};

const PREF = {
  autoKill: "ui.auto_kill_unverified",
  autoAssign: "ui.auto_assign_executions",
  smartNotif: "ui.smart_notifications",
  aiReports: "ui.ai_insights_reports",
  nDecision: "ui.notify_decision_updates",
  nExec: "ui.notify_execution_milestones",
  nSignal: "ui.notify_signal_digest",
  nWeekly: "ui.notify_weekly_summary",
} as const;

function parseBool(settings: Record<string, string>, key: string, defaultTrue = true) {
  const v = settings[key];
  if (v === undefined || v === "") return defaultTrue;
  return v === "true" || v === "1";
}

function parseSecurityEmailOtp(settings: Record<string, string>): boolean {
  const v = (settings["security.email_otp_login"] || "").trim().toLowerCase();
  if (v === "") return false;
  return v === "true" || v === "1" || v === "on";
}

function parseTeamCap(settings: Record<string, string>, key: string): number | null {
  const v = settings[key];
  if (v === undefined || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

type CapacitySummary = {
  configured: boolean;
  teamConfigured: boolean;
  systemTotal: number | null;
  currentLoad: number;
  usagePct: number | null;
};

type AuthSessionRow = {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastActive: string;
  userAgent: string;
  ip: string;
  status: string;
  isCurrent: boolean;
};

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: string;
};

type BillingPayload = {
  providerConfigured: boolean;
  planLabel: string | null;
  planPriceDisplay: string | null;
  billingEmail: string | null;
  taxId: string | null;
  address: string | null;
  invoiceContact: string | null;
  invoices: { id: string; issuedAt: string; description: string; amountDisplay: string; status: string }[];
};

function formatSessionWhen(iso: string): string {
  if (!iso) return ",";
  const t = Date.parse(iso);
  if (!Number.isNaN(t)) {
    try {
      return new Date(t).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return iso;
    }
  }
  return iso;
}

export function SettingsClient() {
  const { replace, push } = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const toast = useToast();
  const [tab, setTab] = useState<(typeof settingsTabs)[number]>("General");
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.values(PREF).map((k) => [k, true])),
  );
  const [org, setOrg] = useState({
    name: "Acme Growth",
    timezone: "(GMT+5:30) Asia/Kolkata",
    dateFormat: "DD MMM YYYY",
    currency: "INR (₹) - Indian Rupee",
    fiscalStart: "April",
    weekStart: "Monday",
  });
  const [grace, setGrace] = useState({
    slack: "24",
    github: "24",
    manual: "24",
  });
  const [confidencePct, setConfidencePct] = useState(60);
  const [capTotal, setCapTotal] = useState<number | null>(null);
  const [teamCaps, setTeamCaps] = useState<{
    Leadership: number | null;
    Growth: number | null;
    Product: number | null;
    Operations: number | null;
  }>({
    Leadership: null,
    Growth: null,
    Product: null,
    Operations: null,
  });
  const [capacitySummary, setCapacitySummary] = useState<CapacitySummary | null>(null);
  const [securityEmailOtp, setSecurityEmailOtp] = useState(false);
  const [securitySessions, setSecuritySessions] = useState<AuthSessionRow[] | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[] | null>(null);
  const [meHasPassword, setMeHasPassword] = useState<boolean | null>(null);
  const [meUserId, setMeUserId] = useState<string | null>(null);
  const [billing, setBilling] = useState({
    planLabel: "",
    planPriceDisplay: "",
    billingEmail: "",
    taxId: "",
    address: "",
    invoiceContact: "",
  });
  const [billingPayloadMeta, setBillingPayloadMeta] = useState<{
    providerConfigured: boolean;
  } | null>(null);
  const [billingSaveMsg, setBillingSaveMsg] = useState<string | null>(null);
  const [quiet, setQuiet] = useState({ start: "22:00", end: "08:00" });
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [connectModal, setConnectModal] = useState<{
    integration: IntegrationDefinition;
    mode: "connect" | "manage";
  } | null>(null);
  const [meIntegrations, setMeIntegrations] = useState<MeIntegrationsPayload | null>(null);
  const [health, setHealth] = useState<IntegrationsHealthPayload | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const slackConnected = searchParams.get("slack_connected");
  const slackError = searchParams.get("slack_error");

  const oauthMissingSlug = searchParams.get("oauthMissing");
  const oauthMissingLabel = useMemo(() => {
    if (!oauthMissingSlug) return null;
    const row = integrations.find((i) => i.apiSlug === oauthMissingSlug);
    return row?.name ?? oauthMissingSlug.replace(/_/g, " ");
  }, [oauthMissingSlug]);

  const integrationsLive = useMemo(
    () =>
      integrations.map((i) => ({
        ...i,
        connected: integrationLiveConnected(i, meIntegrations),
      })),
    [meIntegrations],
  );

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && TAB_FROM_QUERY[t]) setTab(TAB_FROM_QUERY[t]);
  }, [searchParams, searchParamsKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{
          integrations?: unknown;
          user?: { id: string };
          hasPassword?: boolean;
        }>("/api/me");
        if (cancelled) return;
        setMeIntegrations(normalizeMeIntegrations(data.integrations));
        if (data.user?.id) setMeUserId(data.user.id);
        if (typeof data.hasPassword === "boolean") setMeHasPassword(data.hasPassword);
      } catch {
        if (!cancelled) setMeIntegrations(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadHealth = useCallback(async () => {
    try {
      const data = await fetchIntegrationsHealth();
      setHealth(data);
      setHealthError(null);
    } catch (e: unknown) {
      setHealthError(e instanceof Error ? e.message : "Could not load connection health");
    }
  }, []);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as { source?: string; provider?: string; ok?: boolean };
      if (
        d?.source === "hustronix-oauth" &&
        d?.provider === "slack" &&
        d?.ok === true
      ) {
        replace("/settings?tab=connections&slack_connected=1");
        void (async () => {
          try {
            const data = await apiGet<{ integrations?: unknown }>("/api/me");
            setMeIntegrations(normalizeMeIntegrations(data.integrations));
          } catch {
            /* keep prior */
          }
        })();
      }
      /**
       * Any successful OAuth window (`hustronix-oauth` + `ok:true`) means the
       * health surface changed , refresh the Connections panel without forcing
       * a page reload so the user sees a green "Healthy" within a second.
       */
      if (d?.source === "hustronix-oauth" && d?.ok === true) {
        void reloadHealth();
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [replace, reloadHealth]);

  /**
   * Only poll while the Connections tab is visible , anywhere else it's wasted
   * traffic and a database scan. 30s cadence matches the renewal worker's
   * smallest meaningful tick; expiring-soon thresholds are 60min so a stale
   * page still gives the user plenty of lead time to react.
   */
  useEffect(() => {
    if (tab !== "Connections") return;
    void reloadHealth();
    const id = window.setInterval(() => {
      void reloadHealth();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [tab, reloadHealth]);

  const mergeSettings = useCallback((settings: Record<string, string>) => {
    setPrefs((prev) => {
      const next = { ...prev };
      for (const k of Object.values(PREF)) {
        next[k] = parseBool(settings, k);
      }
      return next;
    });
  }, []);

  const reloadPrefs = useCallback(async () => {
    setSaveMsg(null);
    try {
      const data = await apiGet<{ settings: Record<string, string> }>("/api/settings");
      const s = data.settings || {};
      mergeSettings(s);
      setSecurityEmailOtp(parseSecurityEmailOtp(s));
      setOrg({
        name: s["org.name"] || "Acme Growth",
        timezone: s["org.timezone"] || "(GMT+5:30) Asia/Kolkata",
        dateFormat: s["org.date_format"] || "DD MMM YYYY",
        currency: s["org.currency"] || "INR (₹) - Indian Rupee",
        fiscalStart: s["org.fiscal_year_start"] || "April",
        weekStart: s["org.week_start"] || "Monday",
      });
      setGrace({
        slack: s["grace.slack_hours"] || "24",
        github: s["grace.github_hours"] || "24",
        manual: s["grace.manual_hours"] || "24",
      });
      setConfidencePct(
        Math.min(95, Math.max(40, parseInt(s["rules.min_confidence_pct"] || "60", 10) || 60)),
      );
      const capRaw = (s["capacity.system_total"] ?? "").trim();
      setCapTotal(capRaw !== "" ? Math.max(1, parseInt(capRaw, 10) || 1) : null);
      setTeamCaps({
        Leadership: parseTeamCap(s, "capacity.team_leadership"),
        Growth: parseTeamCap(s, "capacity.team_growth"),
        Product: parseTeamCap(s, "capacity.team_product"),
        Operations: parseTeamCap(s, "capacity.team_operations"),
      });
      setQuiet({
        start: s["notify.quiet_start"] || "22:00",
        end: s["notify.quiet_end"] || "08:00",
      });
      try {
        const cs = await apiGet<CapacitySummary>("/api/settings/capacity-summary");
        setCapacitySummary(cs);
      } catch {
        setCapacitySummary(null);
      }
    } catch {
      setCapacitySummary(null);
      /* keep defaults for non-capacity prefs */
    }
  }, [mergeSettings]);

  useEffect(() => {
    void reloadPrefs();
  }, [reloadPrefs]);

  const loadSecurityPanel = useCallback(async () => {
    try {
      const [sess, keys] = await Promise.all([
        apiGet<{ sessions: AuthSessionRow[] }>("/api/auth/sessions"),
        apiGet<{ keys: ApiKeyRow[] }>("/api/auth/api-keys"),
      ]);
      setSecuritySessions(sess.sessions);
      setApiKeys(keys.keys);
    } catch {
      setSecuritySessions(null);
      setApiKeys(null);
    }
  }, []);

  useEffect(() => {
    if (tab !== "Security") return;
    void loadSecurityPanel();
  }, [tab, loadSecurityPanel]);

  const loadBillingPanel = useCallback(async () => {
    setBillingSaveMsg(null);
    try {
      const b = await apiGet<BillingPayload>("/api/billing");
      setBillingPayloadMeta({ providerConfigured: b.providerConfigured });
      setBilling({
        planLabel: b.planLabel ?? "",
        planPriceDisplay: b.planPriceDisplay ?? "",
        billingEmail: b.billingEmail ?? "",
        taxId: b.taxId ?? "",
        address: b.address ?? "",
        invoiceContact: b.invoiceContact ?? "",
      });
    } catch {
      setBillingPayloadMeta(null);
    }
  }, []);

  useEffect(() => {
    if (tab !== "Billing") return;
    void loadBillingPanel();
  }, [tab, loadBillingPanel]);

  async function saveBillingSection() {
    setBillingSaveMsg(null);
    try {
      await apiPost("/api/billing", {
        planLabel: billing.planLabel,
        planPriceDisplay: billing.planPriceDisplay,
        billingEmail: billing.billingEmail,
        taxId: billing.taxId,
        address: billing.address,
        invoiceContact: billing.invoiceContact,
      });
      setBillingSaveMsg("Saved.");
      toast.success("Billing details saved.");
      await loadBillingPanel();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setBillingSaveMsg(msg);
      toast.error(msg);
    }
  }

  async function createApiKey() {
    if (!meUserId || meUserId === "system") {
      window.alert("API keys require a signed-in user account.");
      return;
    }
    const name = window.prompt("Name for this API key", "API Key");
    if (name == null) return;
    try {
      const r = await apiPost<{ token?: string; warning?: string }>("/api/auth/api-keys", {
        name: name.trim() || "API Key",
      });
      void loadSecurityPanel();
      window.alert(
        r.token ? `${r.warning || "Store this token now."}\n\n${r.token}` : "Key created.",
      );
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Could not create key");
    }
  }

  async function revokeApiKey(id: string) {
    if (!window.confirm("Revoke this API key?")) return;
    try {
      await apiDelete(`/api/auth/api-keys/${encodeURIComponent(id)}`);
      void loadSecurityPanel();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Revoke failed");
    }
  }

  async function revokeSessionRow(id: string) {
    if (!window.confirm("Sign out this session?")) return;
    try {
      await apiDelete(`/api/auth/sessions/${encodeURIComponent(id)}`);
      void loadSecurityPanel();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  }

  async function savePrefs() {
    setSaveMsg(null);
    try {
      const settings: Record<string, string> = Object.fromEntries(
        Object.entries(prefs).map(([k, v]) => [k, v ? "true" : "false"]),
      );
      Object.assign(settings, {
        "org.name": org.name,
        "org.timezone": org.timezone,
        "org.date_format": org.dateFormat,
        "org.currency": org.currency,
        "org.fiscal_year_start": org.fiscalStart,
        "org.week_start": org.weekStart,
        "grace.slack_hours": grace.slack,
        "grace.github_hours": grace.github,
        "grace.manual_hours": grace.manual,
        "rules.min_confidence_pct": String(confidencePct),
        "capacity.system_total": capTotal != null ? String(capTotal) : "",
        "capacity.team_leadership":
          teamCaps.Leadership != null ? String(teamCaps.Leadership) : "",
        "capacity.team_growth": teamCaps.Growth != null ? String(teamCaps.Growth) : "",
        "capacity.team_product": teamCaps.Product != null ? String(teamCaps.Product) : "",
        "capacity.team_operations":
          teamCaps.Operations != null ? String(teamCaps.Operations) : "",
        "notify.quiet_start": quiet.start,
        "notify.quiet_end": quiet.end,
        "security.email_otp_login": securityEmailOtp ? "1" : "0",
      });
      await apiPost("/api/settings/bulk", { settings });
      setSaveMsg("Saved.");
      toast.success("Settings saved.");
      try {
        const cs = await apiGet<CapacitySummary>("/api/settings/capacity-summary");
        setCapacitySummary(cs);
      } catch {
        setCapacitySummary(null);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("hx-settings-saved"));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setSaveMsg(msg);
      toast.error(msg);
    }
  }

  async function downloadAuditCsv() {
    try {
      const res = await fetch(`${getApiBase()}/api/audit-log`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hustronix_audit_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function signOutEverywhere() {
    if (!window.confirm("Sign out all sessions on this account?")) return;
    try {
      await apiPost("/api/auth/sessions/revoke-all", { keepCurrent: false });
      await fetch(`${getApiBase()}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      window.location.href = "/login";
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  }

  function resetLocalClientData() {
    if (
      !window.confirm(
        "Clear browser-only Hustronix data (rosters, UI cache)? Server database is not deleted.",
      )
    )
      return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.toLowerCase().includes("hustronix")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    setSaveMsg("Local browser data cleared.");
    toast.success("Local browser data cleared.");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-hx-bg">
      <DashboardHero>
        <PageHeader
          variant="dashboard"
          className="border-b-0 pb-0"
          title="SETTINGS"
          subtitle="Configure your Hustronix system and preferences."
          trailingActions={
            <>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => void reloadPrefs()}
              >
                Discard Changes
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="gap-2"
                type="button"
                data-tour="settings-save"
                onClick={() => void savePrefs()}
              >
                <Save className="size-4" />
                Save Changes
              </Button>
            </>
          }
        />
        {saveMsg && (
          <p
            className={cn(
              "mt-2 text-xs",
              /saved\.|cleared/i.test(saveMsg)
                ? "text-hx-success"
                : /fail|error/i.test(saveMsg)
                  ? "text-hx-danger"
                  : "text-hx-muted",
            )}
          >
            {saveMsg}
          </p>
        )}
      </DashboardHero>

      <div className="scrollbar-hide min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-8 lg:px-10 lg:py-10">
        <SegmentTabs
          layout="wide"
          data-tour="settings-tabs"
          ariaLabel="Settings sections"
          value={tab}
          onChange={(t) => {
            setTab(t);
            replace(`/settings?tab=${SETTINGS_TAB_SLUG[t]}`, { scroll: false });
          }}
          items={settingsTabs.map((t) => ({
            value: t,
            label: t.toUpperCase(),
          }))}
        />

        <div className="flex min-h-0 flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-6">
            {tab === "General" && (
              <>
                <Card>
                  <h3 className="text-lg font-semibold text-hx-text">
                    Organization Settings
                  </h3>
                  <p className="text-sm text-hx-muted">
                    Basic information about your organization.
                  </p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <OrgField
                      label="Organization Name"
                      value={org.name}
                      onChange={(v) => setOrg((o) => ({ ...o, name: v }))}
                    />
                    <OrgField
                      label="Time Zone"
                      value={org.timezone}
                      onChange={(v) => setOrg((o) => ({ ...o, timezone: v }))}
                    />
                    <OrgField
                      label="Date Format"
                      value={org.dateFormat}
                      onChange={(v) => setOrg((o) => ({ ...o, dateFormat: v }))}
                    />
                    <OrgField
                      label="Currency"
                      value={org.currency}
                      onChange={(v) => setOrg((o) => ({ ...o, currency: v }))}
                    />
                    <OrgField
                      label="Fiscal Year Start"
                      value={org.fiscalStart}
                      onChange={(v) => setOrg((o) => ({ ...o, fiscalStart: v }))}
                    />
                    <OrgField
                      label="Week Start Day"
                      value={org.weekStart}
                      onChange={(v) => setOrg((o) => ({ ...o, weekStart: v }))}
                    />
                  </div>
                </Card>
                <Card>
                  <h3 className="text-lg font-semibold">Default Grace Windows</h3>
                  <p className="text-sm text-hx-muted">
                    Set default time windows for signal verification.
                  </p>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    {(
                      [
                        ["Slack Signals", "slack", grace.slack] as const,
                        ["GitHub Signals", "github", grace.github] as const,
                        ["Manual Signals", "manual", grace.manual] as const,
                      ] as const
                    ).map(([title, key, val]) => (
                      <div
                        key={title}
                        className="rounded-lg border border-hx-border bg-hx-surface-elevated/50 p-4"
                      >
                        <p className="font-medium">{title}</p>
                        <p className="mt-1 text-xs text-hx-muted">
                          Grace period before auto-actions apply (hours).
                        </p>
                        <select
                          className="mt-3 w-full rounded-md border border-hx-border bg-hx-surface px-3 py-2 text-sm"
                          value={val}
                          onChange={(e) =>
                            setGrace((g) => ({ ...g, [key]: e.target.value }))
                          }
                        >
                          <option value="24">24 hours</option>
                          <option value="48">48 hours</option>
                          <option value="72">72 hours</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <h3 className="text-lg font-semibold">System Preferences</h3>
                  <p className="text-sm text-hx-muted">
                    Configure default system behavior.
                  </p>
                  <ToggleRow
                    title="Auto Kill Unverified Signals"
                    description="Automatically kill signals after grace window expires."
                    on={prefs[PREF.autoKill]}
                    onChange={(v) =>
                      setPrefs((p) => ({ ...p, [PREF.autoKill]: v }))
                    }
                  />
                  <ToggleRow
                    title="Auto Assign Executions"
                    description="Automatically assign executions to optimal team members."
                    on={prefs[PREF.autoAssign]}
                    onChange={(v) =>
                      setPrefs((p) => ({ ...p, [PREF.autoAssign]: v }))
                    }
                  />
                  <ToggleRow
                    title="Smart Notifications"
                    description="Receive important alerts about executions and signals."
                    on={prefs[PREF.smartNotif]}
                    onChange={(v) =>
                      setPrefs((p) => ({ ...p, [PREF.smartNotif]: v }))
                    }
                  />
                  <ToggleRow
                    title="Include AI Insights in Reports"
                    description="Show AI-generated insights in reports."
                    on={prefs[PREF.aiReports]}
                    onChange={(v) =>
                      setPrefs((p) => ({ ...p, [PREF.aiReports]: v }))
                    }
                  />
                </Card>
              </>
            )}

            {tab === "Connections" && (
              <>
                {slackConnected === "1" && (
                  <div
                    role="status"
                    className="rounded-lg border border-hx-success/40 bg-hx-success/10 px-4 py-3 text-sm text-hx-success"
                  >
                    Slack workspace connected , bot token saved for your account.
                    <button
                      type="button"
                      className="ml-3 font-semibold underline hover:no-underline"
                      onClick={() => replace("/settings?tab=connections")}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {slackError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-hx-danger/40 bg-hx-danger/10 px-4 py-3 text-sm text-hx-danger"
                  >
                    Slack OAuth failed: <strong>{slackError}</strong>
                    <button
                      type="button"
                      className="ml-3 font-semibold underline hover:no-underline"
                      onClick={() => replace("/settings?tab=connections")}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {oauthMissingSlug && oauthMissingLabel && (
                  <div
                    role="alert"
                    className="rounded-lg border border-hx-warning/40 bg-hx-warning/10 px-4 py-3 text-sm text-hx-warning"
                  >
                    <span className="font-medium">OAuth not configured.</span>{" "}
                    Set{" "}
                    <code className="rounded bg-hx-surface px-1 font-mono text-xs">
                      OAUTH_{oauthMissingSlug.toUpperCase()}_URL
                    </code>{" "}
                    (full authorize URL) or{" "}
                    <code className="rounded bg-hx-surface px-1 font-mono text-xs">
                      NEXT_PUBLIC_OAUTH_{oauthMissingSlug.toUpperCase()}_URL
                    </code>{" "}
                    for <strong>{oauthMissingLabel}</strong>, then try again.
                    <button
                      type="button"
                      className="ml-3 font-semibold underline hover:no-underline"
                      onClick={() => replace("/settings")}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                <ConnectionsPanel
                  health={health}
                  healthError={healthError}
                  integrationsLive={integrationsLive}
                  onReconnectProvider={(providerId) => {
                    const slug = PROVIDER_TO_PRIMARY_SLUG[providerId];
                    if (!slug) return;
                    openIntegrationOAuthPopup(slug);
                  }}
                  onOpenManageById={(id) => {
                    const def = integrationsLive.find((row) => row.id === id);
                    if (!def) return;
                    setConnectModal({
                      integration: def,
                      mode: def.connected ? "manage" : "connect",
                    });
                  }}
                />
              </>
            )}

            {tab === "Approvals" && <ApprovalsPanel />}

            {tab === "Rules & Policies" && (
              <Card className="space-y-6">
                <Block title="Signal Rules" />
                <Block title="Execution Rules" />
                <Block title="Decision Rules" />
                <div>
                  <p className="font-medium text-hx-text">
                    Minimum Confidence Threshold
                  </p>
                  <input
                    type="range"
                    min={40}
                    max={95}
                    value={confidencePct}
                    onChange={(e) => setConfidencePct(Number(e.target.value))}
                    className="mt-2 w-full accent-hx-accent"
                  />
                  <p className="text-sm text-hx-muted">{confidencePct}%</p>
                </div>
              </Card>
            )}

            {tab === "Capacity" && (
              <Card className="p-6 sm:p-8">
                <CapacitySettingsPanel
                  capTotal={capTotal}
                  setCapTotal={setCapTotal}
                  teamCaps={teamCaps}
                  setTeamCaps={setTeamCaps}
                  capacitySummary={capacitySummary}
                />
              </Card>
            )}

            {tab === "Notifications" && (
              <Card>
                <ToggleRow
                  title="Decision Updates"
                  on={prefs[PREF.nDecision]}
                  onChange={(v) =>
                    setPrefs((p) => ({ ...p, [PREF.nDecision]: v }))
                  }
                />
                <ToggleRow
                  title="Execution Milestones"
                  on={prefs[PREF.nExec]}
                  onChange={(v) => setPrefs((p) => ({ ...p, [PREF.nExec]: v }))}
                />
                <ToggleRow
                  title="Signal Digest"
                  on={prefs[PREF.nSignal]}
                  onChange={(v) =>
                    setPrefs((p) => ({ ...p, [PREF.nSignal]: v }))
                  }
                />
                <ToggleRow
                  title="Weekly Summary Email"
                  on={prefs[PREF.nWeekly]}
                  onChange={(v) =>
                    setPrefs((p) => ({ ...p, [PREF.nWeekly]: v }))
                  }
                />
                <div className="pt-4">
                  <p className="font-medium">Quiet Hours</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="time"
                      value={quiet.start}
                      onChange={(e) =>
                        setQuiet((q) => ({ ...q, start: e.target.value }))
                      }
                      className="rounded border border-hx-border bg-hx-surface px-2 py-1 text-sm"
                    />
                    <span className="self-center text-hx-muted">to</span>
                    <input
                      type="time"
                      value={quiet.end}
                      onChange={(e) =>
                        setQuiet((q) => ({ ...q, end: e.target.value }))
                      }
                      className="rounded border border-hx-border bg-hx-surface px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              </Card>
            )}

            {tab === "Security" && (
              <div className="space-y-6">
                <PasswordCard
                  meReady={meUserId !== null}
                  firstTimePassword={meHasPassword === false}
                  disabledReason={
                    meUserId === "system"
                      ? "Password change is not available for the system principal."
                      : null
                  }
                  onChanged={() => void loadSecurityPanel()}
                />

                <Card>
                  <ToggleRow
                    title="Email code at sign-in"
                    description="Add an extra layer to your password: we'll email you a one-time code to enter each time you sign in. Don't forget to hit Save Changes."
                    on={securityEmailOtp}
                    onChange={setSecurityEmailOtp}
                  />
                </Card>

                <Card className="space-y-3">
                  <h3 className="text-lg font-semibold text-hx-text">Authenticator (TOTP)</h3>
                  <p className="text-sm text-hx-muted">
                    Enroll or disable authenticator-based 2FA on your Profile (full backup codes and
                    disable flow).
                  </p>
                  <Button
                    variant="outlineGold"
                    size="sm"
                    type="button"
                    onClick={() => push("/profile?tab=security")}
                  >
                    Open Profile → Security
                  </Button>
                </Card>

                <Card className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-hx-text">API keys</h3>
                    <Button
                      variant="outlineGold"
                      size="sm"
                      type="button"
                      disabled={!meUserId || meUserId === "system"}
                      onClick={() => void createApiKey()}
                    >
                      Create key
                    </Button>
                  </div>
                  {!meUserId || meUserId === "system" ? (
                    <p className="text-sm text-hx-muted">Not available for the system principal.</p>
                  ) : apiKeys === null ? (
                    <p className="text-sm text-hx-muted">Could not load API keys.</p>
                  ) : apiKeys.length === 0 ? (
                    <p className="text-sm text-hx-muted">No API keys yet.</p>
                  ) : (
                    <ul className="divide-y divide-hx-border text-sm">
                      {apiKeys.map((k) => (
                        <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div>
                            <p className="font-medium">{k.name}</p>
                            <p className="text-xs text-hx-muted">
                              {k.prefix}… · {k.status}
                              {k.lastUsedAt ? ` · last used ${formatSessionWhen(k.lastUsedAt)}` : ""}
                            </p>
                          </div>
                          {k.status === "Active" && (
                            <Button
                              variant="dangerOutline"
                              size="sm"
                              type="button"
                              onClick={() => void revokeApiKey(k.id)}
                            >
                              Revoke
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card className="space-y-3">
                  <h3 className="text-lg font-semibold text-hx-text">Sessions</h3>
                  {securitySessions === null ? (
                    <p className="text-sm text-hx-muted">Could not load sessions.</p>
                  ) : securitySessions.length === 0 ? (
                    <p className="text-sm text-hx-muted">No active sessions on file.</p>
                  ) : (
                    <ul className="space-y-3 text-sm">
                      {securitySessions.map((s) => (
                        <li
                          key={s.id}
                          className="rounded-lg border border-hx-border bg-hx-surface-elevated/40 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-hx-text">
                                {s.status}
                                {s.isCurrent ? " · This device" : ""}
                              </p>
                              <p className="mt-1 break-all text-xs text-hx-muted">{s.userAgent}</p>
                              <p className="text-xs text-hx-muted">
                                IP {s.ip} · Last active {formatSessionWhen(s.lastActive)} · Created{" "}
                                {formatSessionWhen(s.createdAt)}
                              </p>
                            </div>
                            {!s.isCurrent && s.status === "Active" && (
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => void revokeSessionRow(s.id)}
                              >
                                Revoke
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="text-sm font-semibold text-hx-danger hover:underline"
                    onClick={() => void signOutEverywhere()}
                  >
                    Sign out all sessions
                  </button>
                </Card>

                <Card>
                  <h3 className="text-sm font-semibold text-hx-text">Network access</h3>
                  <p className="mt-2 text-sm text-hx-muted">
                    IP allowlisting is not configured in this app layer , enforce it at your reverse proxy,
                    API gateway, or hosting edge in production.
                  </p>
                </Card>
              </div>
            )}

            {tab === "Billing" && (
              <Card className="space-y-6">
                {billingSaveMsg && (
                  <p
                    className={cn(
                      "text-xs",
                      /saved/i.test(billingSaveMsg) ? "text-hx-success" : "text-hx-danger",
                    )}
                  >
                    {billingSaveMsg}
                  </p>
                )}
                <div>
                  <p className="text-sm text-hx-muted">Plan (self-reported)</p>
                  <p className="mt-1 text-xs text-hx-muted">
                    Stored as your billing display preferences until a payment provider is connected.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="text-hx-muted">Plan name</span>
                      <input
                        value={billing.planLabel}
                        onChange={(e) =>
                          setBilling((b) => ({ ...b, planLabel: e.target.value }))
                        }
                        placeholder="Not configured"
                        className="mt-1 w-full rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-hx-muted">Price line</span>
                      <input
                        value={billing.planPriceDisplay}
                        onChange={(e) =>
                          setBilling((b) => ({ ...b, planPriceDisplay: e.target.value }))
                        }
                        placeholder="e.g. ₹0 / month"
                        className="mt-1 w-full rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      <span className="text-hx-muted">Billing email</span>
                      <input
                        type="email"
                        value={billing.billingEmail}
                        onChange={(e) =>
                          setBilling((b) => ({ ...b, billingEmail: e.target.value }))
                        }
                        placeholder="Not configured"
                        className="mt-1 w-full rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-hx-muted">Tax ID</span>
                      <input
                        value={billing.taxId}
                        onChange={(e) => setBilling((b) => ({ ...b, taxId: e.target.value }))}
                        placeholder="Not configured"
                        className="mt-1 w-full rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-hx-muted">Invoice contact</span>
                      <input
                        value={billing.invoiceContact}
                        onChange={(e) =>
                          setBilling((b) => ({ ...b, invoiceContact: e.target.value }))
                        }
                        placeholder="Not configured"
                        className="mt-1 w-full rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      <span className="text-hx-muted">Billing address</span>
                      <textarea
                        rows={3}
                        value={billing.address}
                        onChange={(e) =>
                          setBilling((b) => ({ ...b, address: e.target.value }))
                        }
                        placeholder="Not configured"
                        className="mt-1 w-full rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    className="mt-4"
                    onClick={() => void saveBillingSection()}
                  >
                    Save billing details
                  </Button>
                </div>

                <div>
                  <p className="font-medium text-hx-text">Usage summary</p>
                  <p className="mt-2 text-sm text-hx-muted">
                    Usage metering for billing is not connected , no provider-linked execution, storage, or
                    integration quotas are shown here yet.
                  </p>
                </div>

                <div>
                  <p className="font-medium text-hx-text">Payment method</p>
                  <p className="mt-2 text-sm text-hx-muted">Not configured , connect a billing provider to
                    manage cards and mandates.</p>
                </div>

                <div>
                  <p className="font-medium text-hx-text">Invoice history</p>
                  {billingPayloadMeta?.providerConfigured ? (
                    <p className="mt-2 text-sm text-hx-muted">
                      Provider flag is on, but no invoice rows are stored in this database build yet.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-hx-muted">
                      Billing provider not connected , set{" "}
                      <code className="rounded bg-hx-surface px-1 font-mono text-xs">
                        BILLING_PROVIDER_CONFIGURED=1
                      </code>{" "}
                      on the API server when a gateway is wired; until then, no invoice list is shown.
                    </p>
                  )}
                </div>
              </Card>
            )}
          </div>

          <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
            <ActiveIntegrationsAside integrationStatus={meIntegrations} />
            <Card>
              <SectionTitle>System Information</SectionTitle>
              <dl className="mt-3 space-y-2 text-sm">
                <Row k="Hustronix Version" v="v2.4.1" />
                <Row k="Environment" v="Production" />
                <Row k="Region" v="Asia (Mumbai)" />
                <Row k="Data Retention" v="365 days" />
              </dl>
              <button
                type="button"
                className="mt-3 text-sm font-medium text-hx-accent hover:underline"
                onClick={() => void downloadAuditCsv()}
              >
                View System Logs →
              </button>
            </Card>
            <Card className="border-hx-danger/40">
              <h3 className="text-sm font-bold text-hx-danger">Danger Zone</h3>
              <p className="mt-1 text-xs text-hx-muted">
                Irreversible and sensitive actions.
              </p>
              <Button
                variant="dangerOutline"
                className="mt-4 w-full gap-2"
                type="button"
                onClick={resetLocalClientData}
              >
                <Trash2 className="size-4" />
                Reset System Data
              </Button>
            </Card>
          </aside>
        </div>
      </div>

      <IntegrationConnectModal
        integration={connectModal?.integration ?? null}
        mode={connectModal?.mode ?? "connect"}
        onClose={() => setConnectModal(null)}
      />
    </div>
  );
}

/**
 * Connections-tab body. Lives inside SettingsClient.tsx so the parent passes
 * already-computed live status and modal callbacks. We render two regions:
 *   1. A summary banner when anything needs reauth or is expiring within 1h.
 *   2. A grid of `ConnectionHealthCard` for every backend provider that has
 *      a row in `health.providers`. When health hasn't loaded yet, we fall
 *      back to the simple integrationsLive list so the page is never empty.
 */
function ConnectionsPanel({
  health,
  healthError,
  integrationsLive,
  onReconnectProvider,
  onOpenManageById,
}: {
  health: IntegrationsHealthPayload | null;
  healthError: string | null;
  integrationsLive: (IntegrationDefinition & { connected: boolean })[];
  onReconnectProvider: (providerId: string) => void;
  onOpenManageById: (id: IntegrationDefinition["id"]) => void;
}) {
  const summary = health?.summary;
  const providers = health?.providers ?? [];

  return (
    <Card data-tour="settings-connections">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Connected Integrations</h3>
          <p className="mt-1 text-sm text-hx-muted">
            Connect or manage OAuth apps , you&apos;ll complete approval on each
            provider&apos;s site (Slack-style flow).
          </p>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-2 text-xs text-hx-muted">
            <span>
              <span className="font-mono tabular-nums text-hx-text">{summary.connected}</span>{" "}
              connected
            </span>
            {summary.needsReauth > 0 && (
              <span className="text-hx-danger">
                <span className="font-mono tabular-nums">{summary.needsReauth}</span> need reauth
              </span>
            )}
            {summary.expiringSoon > 0 && (
              <span className="text-hx-warning">
                <span className="font-mono tabular-nums">{summary.expiringSoon}</span> expiring soon
              </span>
            )}
          </div>
        )}
      </div>

      {healthError && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-hx-danger/40 bg-hx-danger/10 px-3 py-2 text-xs text-hx-danger"
        >
          Live health temporarily unavailable: {healthError}
        </p>
      )}

      {summary && summary.needsReauth > 0 && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-hx-danger/40 bg-hx-danger/10 px-3 py-2 text-sm text-hx-danger"
        >
          One or more connectors stopped refreshing their access tokens , click{" "}
          <strong>Reconnect</strong> on the affected provider below to restore signal extraction.
        </p>
      )}

      {/* Rich grid (health loaded). */}
      {providers.length > 0 && (
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {providers.map((h: IntegrationHealth) => (
            <ConnectionHealthCard
              key={h.provider}
              health={h}
              onReconnect={() => onReconnectProvider(h.provider)}
              onManage={() => {
                const id = PROVIDER_TO_PRIMARY_SLUG[h.provider];
                if (id) onOpenManageById(id);
              }}
            />
          ))}
        </div>
      )}

      {/*
        Skeleton: shown only when health hasn't arrived AND we don't have any
        provider rows yet. Real-time data takes over within ~1s; we deliberately
        keep the fallback list short so we don't render conflicting state.
      */}
      {providers.length === 0 && (
        <ul className="mt-4 divide-y divide-hx-border">
          {integrationsLive.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div>
                <p className="font-medium">{i.name}</p>
                <p className="text-xs text-hx-muted">Sync data and automate workflows.</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={
                    i.connected
                      ? "text-xs font-semibold text-hx-success"
                      : "text-xs font-semibold text-hx-danger"
                  }
                >
                  {i.connected ? "Connected" : "Disconnected"}
                </span>
                <Button
                  variant="outlineGold"
                  size="sm"
                  type="button"
                  onClick={() => onOpenManageById(i.id)}
                >
                  {i.connected ? "Settings" : "Connect"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OrgField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-hx-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm text-hx-text"
      />
    </label>
  );
}

function Block({ title }: { title: string }) {
  return (
    <div>
      <p className="font-semibold text-hx-text">{title}</p>
      <ToggleRow title="Enforce routing rules" description="Apply workspace defaults." />
      <ToggleRow title="Escalate on SLA breach" description="Notify owners automatically." />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-hx-muted">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
