"use client";

import { Check, CheckCircle2, Edit, Eye, EyeOff, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActiveIntegrationsAside } from "@/components/integrations/ActiveIntegrationsAside";
import { CompanyContextPanel } from "@/components/profile/CompanyContextPanel";
import { DashboardHero } from "@/components/shell/DashboardHero";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { ToggleRow } from "@/components/ui/toggle-row";
import {
  activityRows,
  profileTabs,
  sessions as sessionsFallback,
} from "@/data/profile";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  buildApiHeaders,
  getApiBase,
  clearStoredUserId,
} from "@/lib/api";
import { clearChatBrowserStorageForUser } from "@/lib/chatStorage";
import {
  fmtBool,
  mergeProfileSettings,
  parseBool,
} from "@/lib/profile-settings-defaults";
import { cn } from "@/lib/cn";
import { normalizeMeIntegrations, type MeIntegrationsPayload } from "@/lib/me-integrations";
import { useProductTour } from "@/components/tour/product-tour-context";

const MIN_PW = 10;

type MePayload = {
  hasPassword?: boolean;
  user: { id: string; username: string; created_at: string | null };
  profile: {
    displayName: string;
    bio: string;
    email: string;
    phone: string;
    location: string;
    department: string;
    role: string;
  };
  org: {
    name: string;
    role: string | null;
    ownerUserId: string | null;
    isOwner: boolean;
  };
  stats: {
    decisionsCreated: number;
    executionsOwned: number;
    signalsLinked: number;
    successRatePct: number;
  };
  integrations?: MeIntegrationsPayload;
};

type SessionRow = {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastActive: string;
  userAgent: string;
  ip: string;
  status: string;
  isCurrent: boolean;
};

const TAB_QUERY: Record<string, (typeof profileTabs)[number]> = {
  overview: "Overview",
  company: "Company",
  preferences: "Preferences",
  security: "Security",
  activity: "Activity",
  sessions: "Sessions",
  notifications: "Notifications",
};

const TAB_SLUG: Record<(typeof profileTabs)[number], string> = {
  Overview: "overview",
  Company: "company",
  Preferences: "preferences",
  Security: "security",
  Activity: "activity",
  Sessions: "sessions",
  Notifications: "notifications",
};

const ACTIVITY_PAGE = 12;

function parsePasswordApiError(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: string };
    return j.error || body;
  } catch {
    return body;
  }
}

type StrengthTier = 0 | 1 | 2 | 3;

function analyzeNewPassword(pw: string) {
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const lenOk = pw.length >= MIN_PW;
  const mixed = hasLower && hasUpper;
  const extraCount = [mixed, hasDigit, hasSymbol].filter(Boolean).length;
  let tier: StrengthTier = 0;
  let label = "Weak";
  if (!lenOk) {
    tier = 0;
    label = "Weak";
  } else if (extraCount === 0) {
    tier = 1;
    label = "Fair";
  } else if (extraCount === 1) {
    tier = 2;
    label = "Good";
  } else {
    tier = 3;
    label = "Strong";
  }
  return { hasLower, hasUpper, hasDigit, hasSymbol, lenOk, mixed, tier, label };
}

function strengthBarClass(tier: StrengthTier, barIndex: number, length: number): string {
  if (length === 0) return "bg-hx-border/40";
  if (barIndex > tier) return "bg-hx-border/40";
  if (tier === 0) return "bg-hx-danger";
  if (tier === 1) return "bg-hx-warning";
  if (tier === 2) return "bg-hx-accent";
  return "bg-hx-success";
}

function strengthLabelClass(length: number, tier: StrengthTier): string {
  if (length === 0) return "text-hx-muted";
  if (tier === 0) return "text-hx-danger";
  if (tier === 1) return "text-hx-warning";
  if (tier === 2) return "text-hx-accent";
  return "text-hx-success";
}

function formatActivityWhen(iso: string): string {
  if (!iso) return ",";
  const t = Date.parse(iso);
  if (!Number.isNaN(t)) {
    try {
      return new Date(t).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      /* fallthrough */
    }
  }
  return iso;
}

export function ProfileClient() {
  const { replace } = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const toast = useToast();
  const productTour = useProductTour();
  const [tab, setTab] = useState<(typeof profileTabs)[number]>("Overview");
  const [me, setMe] = useState<MePayload | null>(null);
  const [activityLive, setActivityLive] = useState<
    { activity: string; details: string; source: string; when: string; ip: string }[]
  >([]);
  const [sessionsLive, setSessionsLive] = useState<SessionRow[] | null>(null);
  const [profileEdit, setProfileEdit] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    displayName: "",
    bio: "",
    email: "",
    phone: "",
    location: "",
    department: "",
    role: "",
  });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwShow, setPwShow] = useState({ current: false, next: false, confirm: false });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwBanner, setPwBanner] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const [pwFocus, setPwFocus] = useState<"current" | "next" | "confirm" | null>(null);
  const [capsOn, setCapsOn] = useState(false);
  const pwBannerClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activityPage, setActivityPage] = useState(0);
  const [settings, setSettings] = useState<Record<string, string>>(() =>
    mergeProfileSettings(undefined),
  );
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [prefSection, setPrefSection] = useState<"general" | "appearance" | "dashboard">(
    "general",
  );
  const [securitySection, setSecuritySection] = useState<
    "password" | "2fa" | "alerts" | "devices"
  >("password");
  const [notifSection, setNotifSection] = useState<
    "in_app" | "email" | "slack" | "digest"
  >("in_app");
  const [activityTypeFilter, setActivityTypeFilter] = useState<
    "all" | "decisions" | "executions" | "security"
  >("all");
  const [activityDaysFilter, setActivityDaysFilter] = useState<string>("30");

  const [totpStatus, setTotpStatus] = useState<{
    totpServerReady: boolean;
    totpEnabled: boolean;
    totpPendingSetup: boolean;
  } | null>(null);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpConfirmCode, setTotpConfirmCode] = useState("");
  const [totpSetupSecret, setTotpSetupSecret] = useState<string | null>(null);
  const [totpSetupUri, setTotpSetupUri] = useState<string | null>(null);
  const [totpDisablePw, setTotpDisablePw] = useState("");
  const [totpDisableCode, setTotpDisableCode] = useState("");
  const [totpDisableBackup, setTotpDisableBackup] = useState("");
  const [totpBackupModal, setTotpBackupModal] = useState<string[] | null>(null);

  const loadTotpStatus = useCallback(async () => {
    try {
      const s = await apiGet<{
        totpServerReady: boolean;
        totpEnabled: boolean;
        totpPendingSetup: boolean;
      }>("/api/auth/totp/status");
      setTotpStatus(s);
    } catch (e) {
      setTotpStatus(null);
      window.alert(e instanceof Error ? e.message : "Could not load two-factor status.");
    }
  }, []);

  useEffect(() => {
    if (tab === "Security" && securitySection === "2fa") void loadTotpStatus();
  }, [tab, securitySection, loadTotpStatus]);

  const reloadSettings = useCallback(async () => {
    try {
      const d = await apiGet<{ settings: Record<string, string> }>("/api/settings");
      setSettings(mergeProfileSettings(d.settings));
    } catch {
      setSettings(mergeProfileSettings(undefined));
    }
  }, []);

  const onCompanyContextSaved = useCallback(async () => {
    await reloadSettings();
    try {
      const data = await apiGet<MePayload>("/api/me");
      setMe(data);
    } catch {
      /* keep current me */
    }
  }, [reloadSettings]);

  const persistPartialSettings = useCallback(
    async (patch: Record<string, string>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      try {
        await apiPost("/api/settings/bulk", { settings: patch });
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Could not save settings");
        await reloadSettings();
      }
    },
    [reloadSettings],
  );

  useEffect(() => {
    const q = searchParams.get("tab");
    if (q && TAB_QUERY[q]) setTab(TAB_QUERY[q]);
  }, [searchParams, searchParamsKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<MePayload>("/api/me");
        if (!cancelled) setMe(data);
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await apiGet<{ settings: Record<string, string> }>("/api/settings");
        if (!cancelled) setSettings(mergeProfileSettings(d.settings));
      } catch {
        if (!cancelled) setSettings(mergeProfileSettings(undefined));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    setProfileDraft({
      displayName: me.profile.displayName,
      bio: me.profile.bio,
      email: me.profile.email,
      phone: me.profile.phone,
      location: me.profile.location,
      department: me.profile.department,
      role: me.profile.role ?? "",
    });
  }, [me]);

  useEffect(() => {
    setActivityPage(0);
  }, [tab]);

  useEffect(() => {
    setActivityPage(0);
  }, [activityTypeFilter, activityDaysFilter]);

  useEffect(() => {
    setPwBanner((b) => (b?.kind === "error" ? null : b));
  }, [pw.current, pw.next, pw.confirm]);

  useEffect(() => {
    return () => {
      if (pwBannerClearRef.current) clearTimeout(pwBannerClearRef.current);
    };
  }, []);

  useEffect(() => {
    if (tab !== "Activity") return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{
          activity: {
            action: string;
            reason: string;
            timestamp: string;
            affected_entity_id: string | null;
            source?: string;
          }[];
        }>("/api/activity?limit=150");
        if (cancelled) return;
        setActivityLive(
          (data.activity || []).map((a) => ({
            activity: a.action,
            details: a.reason?.slice(0, 120) || ",",
            source: a.source || "Ledger",
            when: formatActivityWhen(a.timestamp),
            ip: a.affected_entity_id?.slice(0, 18) || ",",
          })),
        );
      } catch {
        if (!cancelled) setActivityLive([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "Sessions") return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{ sessions: SessionRow[] }>("/api/auth/sessions");
        if (!cancelled) setSessionsLive(data.sessions || []);
      } catch {
        if (!cancelled) setSessionsLive(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const displayNameTrim = me?.profile.displayName?.trim() ?? "";
  const displayName = me
    ? displayNameTrim || me.user.username || "Not provided"
    : ",";
  const nameForInitials = me
    ? displayNameTrim || me.user.username || "?"
    : "?";
  const initials = nameForInitials
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const memberSince = me?.user.created_at?.slice(0, 10) ?? "";
  /** Green badge = org owner; gold = profile job title , hide gold when it repeats "Owner". */
  const profileRoleTrimmed = me?.profile?.role?.trim();
  const hideProfileRoleAsDuplicateOwner = Boolean(
    me?.org?.isOwner && profileRoleTrimmed && profileRoleTrimmed.toLowerCase() === "owner",
  );

  const summaryBlocks = me
    ? [
        ["Decisions Created", String(me.stats.decisionsCreated), "ledger", true],
        ["Executions Linked", String(me.stats.executionsOwned), "ledger", true],
        ["Signals Linked", String(me.stats.signalsLinked), "ledger", true],
        ["Success Rate", `${me.stats.successRatePct}%`, "terminal tasks", me.stats.successRatePct >= 60],
      ]
    : [
        ["Decisions Created", ",", ",", false],
        ["Executions Linked", ",", ",", false],
        ["Signals Linked", ",", ",", false],
        ["Success Rate", ",", ",", false],
      ];

  const activityRowsMerged =
    activityLive.length > 0 ? activityLive : activityRows;

  let activityFiltered = activityRowsMerged;
  {
    const days = parseInt(activityDaysFilter, 10);
    if (!Number.isNaN(days) && days > 0) {
      // eslint-disable-next-line react-hooks/purity -- wall clock for relative "last N days" window (client-only)
      const cutoff = Date.now() - days * 86400000;
      activityFiltered = activityFiltered.filter((r) => {
        const t = Date.parse(r.when);
        return !Number.isNaN(t) && t >= cutoff;
      });
    }
    if (activityTypeFilter !== "all") {
      activityFiltered = activityFiltered.filter((r) => {
        const a = r.activity.toUpperCase();
        if (activityTypeFilter === "decisions") return a.includes("DECISION");
        if (activityTypeFilter === "executions")
          return (
            a.includes("TASK") ||
            a.includes("EXECUTION") ||
            a.includes("SPAWN") ||
            a.includes("BLOCKED")
          );
        if (activityTypeFilter === "security")
          return (
            a.includes("LOGIN") ||
            a.includes("SESSION") ||
            a.includes("PASSWORD") ||
            a.includes("OAUTH") ||
            a.includes("API_KEY")
          );
        return true;
      });
    }
  }

  const sessionsMerged =
    sessionsLive !== null && sessionsLive.length > 0
      ? sessionsLive.map((s) => ({
          key: s.id,
          device: shortUa(s.userAgent),
          location: ",",
          ip: s.ip,
          last: s.lastActive?.slice(0, 16) || ",",
          status: s.isCurrent ? ("Active now" as const) : (s.status as string),
          remoteId: s.id,
        }))
      : sessionsFallback.map((s, i) => ({
          key: `mock-${i}-${s.ip}`,
          device: s.device,
          location: s.location,
          ip: s.ip,
          last: s.last,
          status: s.status,
          remoteId: null as string | null,
        }));

  async function revokeSessionRow(id: string) {
    if (!window.confirm("Sign out this session?")) return;
    const wasCurrent = Boolean(sessionsLive?.find((s) => s.id === id)?.isCurrent);
    const uid = me?.user.id;
    try {
      await apiDelete(`/api/auth/sessions/${id}`);
      if (wasCurrent && uid) clearChatBrowserStorageForUser(uid);
      const data = await apiGet<{ sessions: SessionRow[] }>("/api/auth/sessions");
      setSessionsLive(data.sessions || []);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  }

  async function saveProfile() {
    try {
      await apiPatch("/api/me", {
        profile: {
          displayName: profileDraft.displayName,
          bio: profileDraft.bio,
          email: profileDraft.email,
          phone: profileDraft.phone,
          location: profileDraft.location,
          department: profileDraft.department,
          role: profileDraft.role,
        },
      });
      const data = await apiGet<MePayload>("/api/me");
      setMe(data);
      setProfileEdit(false);
      toast.success("Profile saved.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save profile";
      toast.error(msg);
    }
  }

  async function updatePassword() {
    const sendCurrent = me !== null && me.hasPassword !== false;
    if (pw.next !== pw.confirm) {
      setPwBanner({ kind: "error", text: "New password and confirmation do not match." });
      return;
    }
    if (pwBannerClearRef.current) {
      clearTimeout(pwBannerClearRef.current);
      pwBannerClearRef.current = null;
    }
    setPwBusy(true);
    setPwBanner(null);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/password`, {
        method: "POST",
        headers: buildApiHeaders(),
        credentials: "include",
        body: JSON.stringify({
          currentPassword: sendCurrent ? pw.current : "",
          newPassword: pw.next,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = parsePasswordApiError(text) || res.statusText;
        if (res.status === 401) msg = "Current password is incorrect.";
        setPwBanner({ kind: "error", text: msg });
        toast.error(msg);
        return;
      }
      setPw({ current: "", next: "", confirm: "" });
      setPwShow({ current: false, next: false, confirm: false });
      setPwBanner({
        kind: "success",
        text: "Password updated. Sign in again on other devices if needed.",
      });
      toast.success("Password updated.");
      try {
        const data = await apiGet<MePayload>("/api/me");
        setMe(data);
      } catch {
        /* keep existing me */
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("hx-me-updated"));
      }
      pwBannerClearRef.current = setTimeout(() => {
        setPwBanner(null);
        pwBannerClearRef.current = null;
      }, 5000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Password update failed";
      setPwBanner({ kind: "error", text: msg });
      toast.error(msg);
    } finally {
      setPwBusy(false);
    }
  }

  async function startTotpSetup() {
    if (!totpStatus?.totpServerReady) {
      window.alert(
        "The API server is missing TOTP_ENCRYPTION_KEY in its environment. Set it in the root .env (same process as Express), restart the API, then try again.",
      );
      return;
    }
    setTotpBusy(true);
    try {
      const r = await apiPost<{ secret: string; otpauthUrl: string }>("/api/auth/totp/setup/start", {});
      setTotpSetupSecret(r.secret);
      setTotpSetupUri(r.otpauthUrl);
      setTotpConfirmCode("");
      await loadTotpStatus();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not start 2FA setup");
    } finally {
      setTotpBusy(false);
    }
  }

  async function confirmTotpSetup() {
    if (!/^\d{6}$/.test(totpConfirmCode.trim())) {
      window.alert("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setTotpBusy(true);
    try {
      const r = await apiPost<{ backupCodes: string[] }>("/api/auth/totp/setup/confirm", {
        code: totpConfirmCode.trim(),
      });
      setTotpBackupModal(r.backupCodes || []);
      setTotpSetupSecret(null);
      setTotpSetupUri(null);
      setTotpConfirmCode("");
      await reloadSettings();
      await loadTotpStatus();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not confirm 2FA");
    } finally {
      setTotpBusy(false);
    }
  }

  async function cancelTotpSetup() {
    setTotpBusy(true);
    try {
      await apiPost("/api/auth/totp/setup/cancel", {});
      setTotpSetupSecret(null);
      setTotpSetupUri(null);
      setTotpConfirmCode("");
      await loadTotpStatus();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not cancel setup");
    } finally {
      setTotpBusy(false);
    }
  }

  async function disableTotp() {
    if (!totpDisablePw.trim()) {
      window.alert("Enter your current account password.");
      return;
    }
    if (!totpDisableCode.trim() && !totpDisableBackup.trim()) {
      window.alert("Enter either a 6-digit authenticator code or a backup code.");
      return;
    }
    setTotpBusy(true);
    try {
      await apiPost("/api/auth/totp/disable", {
        password: totpDisablePw,
        totpCode: totpDisableCode.trim() || undefined,
        backupCode: totpDisableBackup.trim() || undefined,
      });
      setTotpDisablePw("");
      setTotpDisableCode("");
      setTotpDisableBackup("");
      window.alert("Two-factor authentication is now disabled for this account.");
      await reloadSettings();
      await loadTotpStatus();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not disable 2FA");
    } finally {
      setTotpBusy(false);
    }
  }

  const exportActivityCsv = useCallback(() => {
    const rows = activityFiltered;
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [
      ["Activity", "Details", "Source", "When", "IP"].join(","),
      ...rows.map((r) =>
        [r.activity, r.details, r.source, r.when, r.ip].map(esc).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activityFiltered]);

  const activityPaged = useMemo(() => {
    const start = activityPage * ACTIVITY_PAGE;
    return activityFiltered.slice(start, start + ACTIVITY_PAGE);
  }, [activityFiltered, activityPage]);

  const activityPages = Math.max(1, Math.ceil(activityFiltered.length / ACTIVITY_PAGE));

  const meReady = me !== null;
  const firstTimePassword = meReady && me.hasPassword === false;
  const requiresCurrentPassword = meReady && !firstTimePassword;
  const pwAnalysis = useMemo(() => analyzeNewPassword(pw.next), [pw.next]);
  const pwFormValid = useMemo(() => {
    if (!meReady) return false;
    if (pw.next.length < MIN_PW || pw.next !== pw.confirm) return false;
    if (requiresCurrentPassword) {
      if (pw.current.trim() === "") return false;
      if (pw.next === pw.current) return false;
    }
    return true;
  }, [meReady, requiresCurrentPassword, pw.current, pw.next, pw.confirm]);

  async function saveAllPreferences() {
    setSettingsSaving(true);
    try {
      const keys = [
        "prefs.language",
        "prefs.theme",
        "prefs.default_dashboard",
        "prefs.items_per_page",
        "prefs.compact_mode",
        "prefs.enable_animations",
        "prefs.auto_save",
      ] as const;
      const patch: Record<string, string> = {};
      for (const k of keys) patch[k] = settings[k] ?? mergeProfileSettings(undefined)[k];
      await apiPost("/api/settings/bulk", { settings: patch });
      await reloadSettings();
      window.alert("Preferences saved.");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function revokeAllSessions() {
    if (!window.confirm("Sign out all devices? You will need to log in again.")) return;
    const uid = me?.user.id;
    try {
      await apiPost("/api/auth/sessions/revoke-all", { keepCurrent: false });
      if (uid) clearChatBrowserStorageForUser(uid);
      clearStoredUserId();
      window.location.href = "/login";
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-hx-bg">
      <DashboardHero>
        <PageHeader
          variant="dashboard"
          className="border-b-0 pb-0"
          title="PROFILE"
          subtitle="Manage your profile information and preferences."
          trailingActions={
            tab === "Overview" ? (
              profileEdit ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="shrink-0"
                    onClick={() => setProfileEdit(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    className="shrink-0"
                    onClick={() => void saveProfile()}
                  >
                    Save
                  </Button>
                </>
              ) : (
                <Button
                  variant="outlineGold"
                  size="sm"
                  type="button"
                  className="shrink-0 gap-2"
                  onClick={() => setProfileEdit(true)}
                >
                  <Edit className="size-4" />
                  Edit Profile
                </Button>
              )
            ) : null
          }
        />
      </DashboardHero>

      <div className="scrollbar-hide min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-8 lg:px-10 lg:py-10">
        <SegmentTabs
          layout="wide"
          ariaLabel="Profile sections"
          value={tab}
          onChange={(t) => {
            setTab(t);
            replace(`/profile?tab=${TAB_SLUG[t]}`, { scroll: false });
          }}
          items={profileTabs.map((t) => ({
            value: t,
            label: t.toUpperCase(),
          }))}
        />
        {tab === "Overview" && (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <div className="flex flex-col items-center text-center">
                <div className="flex size-24 items-center justify-center rounded-full bg-hx-accent/20 text-2xl font-bold text-hx-accent">
                  {initials || "?"}
                </div>
                <h2 className="mt-4 text-xl font-bold">
                  {profileEdit ? (
                    <input
                      className="w-full rounded border border-hx-border bg-hx-surface px-2 py-1 text-lg"
                      value={profileDraft.displayName}
                      onChange={(e) =>
                        setProfileDraft((d) => ({ ...d, displayName: e.target.value }))
                      }
                    />
                  ) : (
                    displayName
                  )}
                </h2>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  {me?.org?.isOwner ? (
                    <StatusBadge variant="success" className="shrink-0">
                      Owner
                    </StatusBadge>
                  ) : null}
                  {me?.profile.role?.trim() && !hideProfileRoleAsDuplicateOwner ? (
                    <StatusBadge variant="accent" className="shrink-0">
                      {me.profile.role}
                    </StatusBadge>
                  ) : !me?.org?.isOwner && !me?.profile.role?.trim() ? (
                    <p className="text-xs italic text-hx-muted">Not provided</p>
                  ) : null}
                </div>
                {profileEdit ? (
                  <textarea
                    className="mt-4 w-full rounded border border-hx-border bg-hx-surface p-2 text-sm"
                    rows={3}
                    value={profileDraft.bio}
                    onChange={(e) => setProfileDraft((d) => ({ ...d, bio: e.target.value }))}
                  />
                ) : (
                  <p className="mt-4 text-sm">
                    <FieldValue value={me?.profile.bio} />
                  </p>
                )}
                <dl className="mt-6 w-full space-y-2 text-left text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-hx-muted">Email</dt>
                    <dd className="min-w-0 flex-1">
                      {profileEdit ? (
                        <input
                          className="w-full rounded border border-hx-border bg-hx-surface px-2 py-1"
                          value={profileDraft.email}
                          onChange={(e) =>
                            setProfileDraft((d) => ({ ...d, email: e.target.value }))
                          }
                        />
                      ) : (
                        <FieldValue value={me?.profile.email} />
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-hx-muted">Phone</dt>
                    <dd className="min-w-0 flex-1">
                      {profileEdit ? (
                        <input
                          className="w-full rounded border border-hx-border bg-hx-surface px-2 py-1"
                          value={profileDraft.phone}
                          onChange={(e) =>
                            setProfileDraft((d) => ({ ...d, phone: e.target.value }))
                          }
                        />
                      ) : (
                        <FieldValue value={me?.profile.phone} />
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-hx-muted">Location</dt>
                    <dd className="min-w-0 flex-1">
                      {profileEdit ? (
                        <input
                          className="w-full rounded border border-hx-border bg-hx-surface px-2 py-1"
                          value={profileDraft.location}
                          onChange={(e) =>
                            setProfileDraft((d) => ({ ...d, location: e.target.value }))
                          }
                        />
                      ) : (
                        <FieldValue value={me?.profile.location} />
                      )}
                    </dd>
                  </div>
                  {profileEdit && (
                    <>
                      <div className="flex justify-between gap-2">
                        <dt className="text-hx-muted">Role</dt>
                        <dd className="min-w-0 flex-1">
                          <input
                            className="w-full rounded border border-hx-border bg-hx-surface px-2 py-1"
                            value={profileDraft.role}
                            onChange={(e) =>
                              setProfileDraft((d) => ({ ...d, role: e.target.value }))
                            }
                          />
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-hx-muted">Department</dt>
                        <dd className="min-w-0 flex-1">
                          <input
                            className="w-full rounded border border-hx-border bg-hx-surface px-2 py-1"
                            value={profileDraft.department}
                            onChange={(e) =>
                              setProfileDraft((d) => ({ ...d, department: e.target.value }))
                            }
                          />
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                <div className="mt-6 grid w-full grid-cols-3 gap-2 border-t border-hx-border pt-6 text-center text-xs">
                  <div>
                    <p className="text-hx-muted">Role</p>
                    <p className="mt-1 flex flex-wrap items-center justify-center gap-1 font-medium">
                      {me?.org?.isOwner ? (
                        <StatusBadge variant="success" className="text-[10px]">
                          Owner
                        </StatusBadge>
                      ) : null}
                      {me?.profile.role?.trim() && !hideProfileRoleAsDuplicateOwner ? (
                        <span className="not-italic">{me.profile.role}</span>
                      ) : !me?.org?.isOwner && !me?.profile.role?.trim() ? (
                        <FieldValue value={undefined} className="not-italic" />
                      ) : null}
                    </p>
                  </div>
                  <div>
                    <p className="text-hx-muted">Department</p>
                    <p className="mt-1 font-medium">
                      <FieldValue value={me?.profile.department} className="not-italic" />
                    </p>
                  </div>
                  <div>
                    <p className="text-hx-muted">Member Since</p>
                    <p className="mt-1 font-medium">
                      <FieldValue value={memberSince} className="not-italic" />
                    </p>
                  </div>
                </div>
              </div>
            </Card>
            <Card className="lg:col-span-2" data-tour="profile-overview">
              <SectionTitle>Account Summary</SectionTitle>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {summaryBlocks.map(([l, v, ch, up]) => (
                  <div
                    key={String(l)}
                    className="rounded-lg border border-hx-border p-4"
                  >
                    <p className="text-xs text-hx-muted">{l}</p>
                    <p className="mt-1 text-2xl font-bold">{v}</p>
                    <p
                      className={
                        up ? "text-xs text-hx-success" : "text-xs text-hx-danger"
                      }
                    >
                      {ch}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="lg:col-span-2">
              <h3 className="font-semibold">Contact Information</h3>
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-hx-muted">Email</span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <FieldValue value={me?.profile.email} />
                    {me?.profile.email?.trim() ? (
                      <StatusBadge variant="success">Verified</StatusBadge>
                    ) : null}
                  </span>
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-hx-muted">Phone</span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <FieldValue value={me?.profile.phone} />
                    {me?.profile.phone?.trim() ? (
                      <StatusBadge variant="success">Verified</StatusBadge>
                    ) : null}
                  </span>
                </li>
              </ul>
              <Button
                variant="outlineGold"
                className="mt-4"
                size="sm"
                type="button"
                onClick={() => setProfileEdit(true)}
              >
                Edit Contact Info
              </Button>
            </Card>
            <Card>
              <h3 className="font-semibold">Preferences</h3>
              <p className="mt-2 text-sm text-hx-muted">
                Language, theme, dashboard density.
              </p>
              <Button
                variant="outlineGold"
                className="mt-4"
                size="sm"
                type="button"
                onClick={() => {
                  setTab("Preferences");
                  replace("/profile?tab=preferences", { scroll: false });
                }}
              >
                Manage Preferences
              </Button>
            </Card>
            <Card>
              <h3 className="font-semibold">Notifications</h3>
              <div className="mt-4 space-y-1">
                {(
                  [
                    ["Decision updates", "notify.in_app.decision_updates"],
                    ["Executions", "notify.in_app.executions"],
                    ["Signals", "notify.in_app.signals"],
                    ["Digest", "notify.in_app.digest"],
                    ["System", "notify.in_app.system"],
                  ] as const
                ).map(([label, key]) => (
                  <ToggleRow
                    key={key}
                    title={label}
                    on={parseBool(settings[key])}
                    onChange={(next) =>
                      void persistPartialSettings({ [key]: fmtBool(next) })
                    }
                  />
                ))}
              </div>
              <Button
                variant="outlineGold"
                className="mt-4 w-full"
                size="sm"
                type="button"
                onClick={() => {
                  setTab("Notifications");
                  replace("/profile?tab=notifications", { scroll: false });
                }}
              >
                Manage Notifications
              </Button>
            </Card>
            <ActiveIntegrationsAside
              className="h-fit"
              integrationStatus={
                me ? normalizeMeIntegrations(me.integrations) : null
              }
            />
          </div>
        )}

        {tab === "Company" && (
          <CompanyContextPanel
            settings={settings}
            onboardingCompleted={settings["org.onboarding.completed"] === "1"}
            onSaved={onCompanyContextSaved}
          />
        )}

        {tab === "Preferences" && (
          <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
            <Card className="h-fit space-y-2 p-3">
              {(
                [
                  ["general", "General"],
                  ["appearance", "Appearance"],
                  ["dashboard", "Dashboard"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPrefSection(id)}
                  className={`block w-full rounded px-3 py-2 text-left text-sm ${
                    prefSection === id
                      ? "bg-hx-accent/15 font-medium text-hx-accent"
                      : "text-hx-muted hover:bg-hx-surface-elevated"
                  }`}
                >
                  {label}
                </button>
              ))}
            </Card>
            <Card>
              <div className="mb-6 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outlineGold"
                  size="sm"
                  type="button"
                  onClick={() => void productTour.restartTour()}
                >
                  Restart guided tour
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  disabled={settingsSaving}
                  onClick={() => void saveAllPreferences()}
                >
                  {settingsSaving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
              {prefSection === "general" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Language"
                    value={settings["prefs.language"]}
                    options={[
                      { value: "en", label: "English" },
                      { value: "es", label: "Español" },
                      { value: "fr", label: "Français" },
                    ]}
                    onChange={(v) => void persistPartialSettings({ "prefs.language": v })}
                  />
                  <SelectField
                    label="Items Per Page"
                    value={settings["prefs.items_per_page"]}
                    options={["10", "25", "50", "100"].map((n) => ({
                      value: n,
                      label: n,
                    }))}
                    onChange={(v) => void persistPartialSettings({ "prefs.items_per_page": v })}
                  />
                </div>
              )}
              {prefSection === "appearance" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      label="Theme"
                      value={settings["prefs.theme"]}
                      options={[
                        { value: "dark", label: "Dark" },
                        { value: "light", label: "Light" },
                        { value: "system", label: "System" },
                      ]}
                      onChange={(v) => void persistPartialSettings({ "prefs.theme": v })}
                    />
                  </div>
                  <ToggleRow
                    title="Compact Mode"
                    on={parseBool(settings["prefs.compact_mode"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "prefs.compact_mode": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="Enable Animations"
                    on={parseBool(settings["prefs.enable_animations"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "prefs.enable_animations": fmtBool(n) })
                    }
                  />
                </>
              )}
              {prefSection === "dashboard" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      label="Default Dashboard"
                      value={settings["prefs.default_dashboard"]}
                      options={[
                        { value: "mission-control", label: "Mission Control" },
                        { value: "execute", label: "Execute" },
                        { value: "signals", label: "Signals" },
                        { value: "teams", label: "Teams" },
                        { value: "reports", label: "Reports" },
                      ]}
                      onChange={(v) =>
                        void persistPartialSettings({ "prefs.default_dashboard": v })
                      }
                    />
                  </div>
                  <ToggleRow
                    title="Auto Save"
                    on={parseBool(settings["prefs.auto_save"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "prefs.auto_save": fmtBool(n) })
                    }
                  />
                </>
              )}
            </Card>
          </div>
        )}

        {tab === "Security" && (
          <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
            <Card className="h-fit space-y-2 p-3">
              {(
                [
                  ["password", "Password"],
                  ["2fa", "2FA"],
                  ["alerts", "Login Alerts"],
                  ["devices", "Devices"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSecuritySection(id)}
                  className={`block w-full rounded px-3 py-2 text-left text-sm ${
                    securitySection === id
                      ? "bg-hx-accent/15 font-medium text-hx-accent"
                      : "text-hx-muted hover:bg-hx-surface-elevated"
                  }`}
                >
                  {label}
                </button>
              ))}
            </Card>
            <div className="space-y-6">
              {securitySection === "password" && (
                <Card className="space-y-0 overflow-hidden p-0">
                  <div className="border-b border-hx-border/70 px-6 pb-5 pt-6">
                    <SectionTitle>Password</SectionTitle>
                    <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-hx-muted">
                      Choose a strong password to keep your account secure. We recommend a passphrase
                      or password manager.
                    </p>
                  </div>

                  {!meReady ? (
                    <p className="px-6 py-8 text-sm text-hx-muted">Loading account…</p>
                  ) : (
                    <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="space-y-5">
                        {firstTimePassword ? (
                          <div className="rounded-md border border-hx-accent/40 bg-hx-accent/10 px-3 py-2 text-xs text-hx-text">
                            You&apos;re setting a password for the first time.
                          </div>
                        ) : null}

                        {requiresCurrentPassword ? (
                          <div className="space-y-1.5">
                            <label
                              className="block text-xs font-medium uppercase tracking-wide text-hx-muted"
                              htmlFor="profile-pw-current"
                            >
                              Current password
                            </label>
                            <div className="relative">
                              <input
                                id="profile-pw-current"
                                type={pwShow.current ? "text" : "password"}
                                autoComplete="current-password"
                                className="w-full rounded-lg border border-hx-border bg-hx-surface-elevated py-2 pl-3 pr-10 text-sm text-hx-text placeholder:text-hx-muted/60 focus:border-hx-accent focus:outline-none focus:ring-1 focus:ring-hx-accent/40"
                                value={pw.current}
                                onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                                onFocus={() => setPwFocus("current")}
                                onBlur={() => {
                                  setPwFocus(null);
                                  setCapsOn(false);
                                }}
                                onKeyDown={(e) => {
                                  if (e.getModifierState) setCapsOn(e.getModifierState("CapsLock"));
                                }}
                                onKeyUp={(e) => {
                                  if (e.getModifierState) setCapsOn(e.getModifierState("CapsLock"));
                                }}
                              />
                              <button
                                type="button"
                                tabIndex={-1}
                                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-hx-muted hover:text-hx-text"
                                aria-label={pwShow.current ? "Hide password" : "Show password"}
                                aria-pressed={pwShow.current}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() =>
                                  setPwShow((s) => ({ ...s, current: !s.current }))
                                }
                              >
                                {pwShow.current ? (
                                  <EyeOff className="size-4" aria-hidden />
                                ) : (
                                  <Eye className="size-4" aria-hidden />
                                )}
                              </button>
                            </div>
                            {pwFocus === "current" && capsOn ? (
                              <p className="text-[11px] text-hx-warning">Caps Lock is on.</p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="space-y-1.5">
                          <label
                            className="block text-xs font-medium uppercase tracking-wide text-hx-muted"
                            htmlFor="profile-pw-new"
                          >
                            New password
                          </label>
                          <div className="relative">
                            <input
                              id="profile-pw-new"
                              type={pwShow.next ? "text" : "password"}
                              autoComplete="new-password"
                              placeholder={`At least ${MIN_PW} characters`}
                              className="w-full rounded-lg border border-hx-border bg-hx-surface-elevated py-2 pl-3 pr-10 text-sm text-hx-text placeholder:text-hx-muted/60 focus:border-hx-accent focus:outline-none focus:ring-1 focus:ring-hx-accent/40"
                              value={pw.next}
                              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                              onFocus={() => setPwFocus("next")}
                              onBlur={() => {
                                setPwFocus(null);
                                setCapsOn(false);
                              }}
                              onKeyDown={(e) => {
                                if (e.getModifierState) setCapsOn(e.getModifierState("CapsLock"));
                              }}
                              onKeyUp={(e) => {
                                if (e.getModifierState) setCapsOn(e.getModifierState("CapsLock"));
                              }}
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-hx-muted hover:text-hx-text"
                              aria-label={pwShow.next ? "Hide password" : "Show password"}
                              aria-pressed={pwShow.next}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => setPwShow((s) => ({ ...s, next: !s.next }))}
                            >
                              {pwShow.next ? (
                                <EyeOff className="size-4" aria-hidden />
                              ) : (
                                <Eye className="size-4" aria-hidden />
                              )}
                            </button>
                          </div>
                          {pwFocus === "next" && capsOn ? (
                            <p className="text-[11px] text-hx-warning">Caps Lock is on.</p>
                          ) : null}
                        </div>

                        <div className="space-y-1.5">
                          <label
                            className="block text-xs font-medium uppercase tracking-wide text-hx-muted"
                            htmlFor="profile-pw-confirm"
                          >
                            Confirm new password
                          </label>
                          <div className="relative">
                            <input
                              id="profile-pw-confirm"
                              type={pwShow.confirm ? "text" : "password"}
                              autoComplete="new-password"
                              placeholder="Repeat your new password"
                              className="w-full rounded-lg border border-hx-border bg-hx-surface-elevated py-2 pl-3 pr-10 text-sm text-hx-text placeholder:text-hx-muted/60 focus:border-hx-accent focus:outline-none focus:ring-1 focus:ring-hx-accent/40"
                              value={pw.confirm}
                              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                              onFocus={() => setPwFocus("confirm")}
                              onBlur={() => {
                                setPwFocus(null);
                                setCapsOn(false);
                              }}
                              onKeyDown={(e) => {
                                if (e.getModifierState) setCapsOn(e.getModifierState("CapsLock"));
                              }}
                              onKeyUp={(e) => {
                                if (e.getModifierState) setCapsOn(e.getModifierState("CapsLock"));
                              }}
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-hx-muted hover:text-hx-text"
                              aria-label={pwShow.confirm ? "Hide password" : "Show password"}
                              aria-pressed={pwShow.confirm}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() =>
                                setPwShow((s) => ({ ...s, confirm: !s.confirm }))
                              }
                            >
                              {pwShow.confirm ? (
                                <EyeOff className="size-4" aria-hidden />
                              ) : (
                                <Eye className="size-4" aria-hidden />
                              )}
                            </button>
                          </div>
                          {pwFocus === "confirm" && capsOn ? (
                            <p className="text-[11px] text-hx-warning">Caps Lock is on.</p>
                          ) : null}
                          {pw.confirm.length > 0 ? (
                            pw.next === pw.confirm ? (
                              <p className="flex items-center gap-1.5 text-xs text-hx-success">
                                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                                Passwords match
                              </p>
                            ) : (
                              <p className="flex items-center gap-1.5 text-xs text-hx-danger">
                                <span
                                  className="size-1.5 shrink-0 rounded-full bg-hx-danger"
                                  aria-hidden
                                />
                                Passwords don&apos;t match
                              </p>
                            )
                          ) : null}
                        </div>
                      </div>

                      <aside className="space-y-4 self-start rounded-lg border border-hx-border/70 bg-hx-surface-elevated/40 p-4">
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-hx-muted">
                              Strength
                            </span>
                            <span
                              className={cn(
                                "text-xs font-medium",
                                strengthLabelClass(pw.next.length, pwAnalysis.tier),
                              )}
                            >
                              {pw.next.length === 0 ? "," : pwAnalysis.label}
                            </span>
                          </div>
                          <div
                            className="flex gap-1"
                            role="status"
                            aria-label={`Password strength: ${pw.next.length === 0 ? "empty" : pwAnalysis.label}`}
                          >
                            {([0, 1, 2, 3] as const).map((i) => (
                              <div
                                key={i}
                                className={cn(
                                  "h-1.5 flex-1 rounded-full transition-colors",
                                  strengthBarClass(pwAnalysis.tier, i, pw.next.length),
                                )}
                              />
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-hx-muted">
                            Requirements
                          </p>
                          <ul className="space-y-1.5 text-xs">
                            <li
                              className={cn(
                                "flex items-center gap-2",
                                pwAnalysis.lenOk ? "text-hx-success" : "text-hx-muted",
                              )}
                            >
                              <Check
                                className={cn(
                                  "size-3.5 shrink-0",
                                  pwAnalysis.lenOk ? "text-hx-success" : "opacity-35",
                                )}
                                aria-hidden
                              />
                              At least {MIN_PW} characters
                            </li>
                            <li
                              className={cn(
                                "flex items-center gap-2",
                                pwAnalysis.hasUpper ? "text-hx-success" : "text-hx-muted",
                              )}
                            >
                              <Check
                                className={cn(
                                  "size-3.5 shrink-0",
                                  pwAnalysis.hasUpper ? "text-hx-success" : "opacity-35",
                                )}
                                aria-hidden
                              />
                              Includes an uppercase letter
                            </li>
                            <li
                              className={cn(
                                "flex items-center gap-2",
                                pwAnalysis.hasDigit ? "text-hx-success" : "text-hx-muted",
                              )}
                            >
                              <Check
                                className={cn(
                                  "size-3.5 shrink-0",
                                  pwAnalysis.hasDigit ? "text-hx-success" : "opacity-35",
                                )}
                                aria-hidden
                              />
                              Includes a number
                            </li>
                            <li
                              className={cn(
                                "flex items-center gap-2",
                                pwAnalysis.hasSymbol ? "text-hx-success" : "text-hx-muted",
                              )}
                            >
                              <Check
                                className={cn(
                                  "size-3.5 shrink-0",
                                  pwAnalysis.hasSymbol ? "text-hx-success" : "opacity-35",
                                )}
                                aria-hidden
                              />
                              Includes a symbol
                            </li>
                          </ul>
                        </div>
                      </aside>
                    </div>
                  )}

                  <div className="border-t border-hx-border/70 bg-hx-surface-elevated/30 px-6 py-4">
                    {pwBanner?.kind === "success" ? (
                      <p
                        role="status"
                        className="mb-3 rounded-md border border-hx-success/40 bg-hx-success/10 px-3 py-2 text-sm text-hx-success"
                      >
                        {pwBanner.text}
                      </p>
                    ) : pwBanner?.kind === "error" ? (
                      <p
                        role="alert"
                        className="mb-3 rounded-md border border-hx-danger/40 bg-hx-danger/15 px-3 py-2 text-sm text-hx-danger"
                      >
                        {pwBanner.text}
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] text-hx-muted">
                        You&apos;ll stay signed in on this device. Other sessions may need to re-authenticate.
                      </p>
                      <Button
                        variant="primary"
                        type="button"
                        className="shrink-0"
                        disabled={!pwFormValid || pwBusy || !meReady}
                        onClick={() => void updatePassword()}
                      >
                        {pwBusy ? "Updating…" : "Update password"}
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
              {securitySection === "2fa" && (
                <Card>
                  <p className="font-semibold">Two-factor authentication (TOTP)</p>
                  <p className="mt-2 text-sm text-hx-muted">
                    Use an authenticator app (Google Authenticator, 1Password, etc.). When 2FA is on, sign-in also
                    requires a time-based code after your password (and email code when the server has SMTP
                    configured).
                  </p>
                  {totpStatus && !totpStatus.totpServerReady && (
                    <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      Server is not configured for 2FA: set{" "}
                      <code className="rounded bg-hx-bg px-1">TOTP_ENCRYPTION_KEY</code> on the API host, restart, then
                      reload this page.
                    </p>
                  )}
                  {totpStatus && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge variant={totpStatus.totpEnabled ? "success" : "neutral"}>
                        {totpStatus.totpEnabled
                          ? "2FA on"
                          : totpStatus.totpPendingSetup
                            ? "Setup in progress"
                            : "2FA off"}
                      </StatusBadge>
                      {!totpStatus.totpEnabled && totpStatus.totpPendingSetup && (
                        <StatusBadge variant="warning">Finish setup below</StatusBadge>
                      )}
                    </div>
                  )}

                  {!totpStatus?.totpEnabled && (
                    <div className="mt-6 space-y-4">
                      <p className="text-sm font-medium text-hx-text">Enable</p>
                      <Button
                        variant="outlineGold"
                        size="sm"
                        type="button"
                        disabled={totpBusy || !totpStatus?.totpServerReady || totpStatus?.totpEnabled}
                        onClick={() => void startTotpSetup()}
                      >
                        {totpSetupSecret ? "Regenerate setup key" : "Begin setup"}
                      </Button>
                      {totpSetupUri && totpSetupSecret && (
                        <div className="space-y-3 rounded-lg border border-hx-border bg-hx-surface-elevated p-4 text-sm">
                          <p className="text-hx-muted">Add this account to your authenticator app:</p>
                          <label htmlFor="totp-setup-uri" className="block text-xs text-hx-muted">
                            Key URI (copy into app if needed)
                          </label>
                          <textarea
                            id="totp-setup-uri"
                            readOnly
                            className="mt-1 h-20 w-full resize-none rounded border border-hx-border bg-hx-bg px-2 py-1 font-mono text-xs text-hx-text"
                            value={totpSetupUri}
                            onFocus={(e) => e.currentTarget.select()}
                          />
                          <p className="text-xs text-hx-muted">
                            Manual entry secret:{" "}
                            <code className="rounded bg-hx-bg px-1 font-mono text-hx-text">{totpSetupSecret}</code>
                          </p>
                          <label htmlFor="totp-confirm-code" className="mt-2 block text-xs font-medium text-hx-muted">
                            6-digit code
                          </label>
                          <input
                            id="totp-confirm-code"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="123456"
                            value={totpConfirmCode}
                            onChange={(e) => setTotpConfirmCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            className="mt-1 w-full max-w-xs rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              type="button"
                              disabled={totpBusy}
                              onClick={() => void confirmTotpSetup()}
                            >
                              Confirm &amp; enable
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              disabled={totpBusy}
                              onClick={() => void cancelTotpSetup()}
                            >
                              Cancel setup
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {totpStatus?.totpEnabled && (
                    <div className="mt-6 space-y-3">
                      <p className="text-sm font-medium text-hx-text">Turn off 2FA</p>
                      <p className="text-xs text-hx-muted">Requires your password plus one authenticator or backup code.</p>
                      <input
                        type="password"
                        autoComplete="current-password"
                        placeholder="Account password"
                        value={totpDisablePw}
                        onChange={(e) => setTotpDisablePw(e.target.value)}
                        className="w-full max-w-sm rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm"
                      />
                      <input
                        inputMode="numeric"
                        placeholder="6-digit authenticator code"
                        value={totpDisableCode}
                        onChange={(e) => setTotpDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="w-full max-w-sm rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Or backup code XXXX-XXXX"
                        value={totpDisableBackup}
                        onChange={(e) => setTotpDisableBackup(e.target.value.toUpperCase())}
                        className="w-full max-w-sm rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={totpBusy}
                        onClick={() => void disableTotp()}
                      >
                        Disable 2FA
                      </Button>
                    </div>
                  )}
                </Card>
              )}
              {totpBackupModal && totpBackupModal.length > 0 && (
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="totp-backup-title"
                >
                  <Card className="max-h-[90vh] max-w-lg overflow-y-auto p-6 shadow-2xl">
                    <h2 id="totp-backup-title" className="text-lg font-semibold text-hx-text">
                      Save your backup codes
                    </h2>
                    <p className="mt-2 text-sm text-hx-muted">
                      Each code works once. Store them somewhere safe (password manager). You will not see them again
                      on this screen.
                    </p>
                    <ul className="mt-4 grid gap-1 font-mono text-sm text-hx-text">
                      {totpBackupModal.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                    <div className="mt-6 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outlineGold"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard?.writeText(totpBackupModal.join("\n"));
                          window.alert("Backup codes copied to clipboard.");
                        }}
                      >
                        Copy all
                      </Button>
                      <Button type="button" variant="primary" size="sm" onClick={() => setTotpBackupModal(null)}>
                        I have stored these safely
                      </Button>
                    </div>
                  </Card>
                </div>
              )}
              {securitySection === "alerts" && (
                <Card>
                  <ToggleRow
                    title="Email login alerts"
                    on={parseBool(settings["security.email_login_alerts"])}
                    onChange={(n) =>
                      void persistPartialSettings({
                        "security.email_login_alerts": fmtBool(n),
                      })
                    }
                  />
                  <ToggleRow
                    title="SMS login alerts"
                    on={parseBool(settings["security.sms_login_alerts"])}
                    onChange={(n) =>
                      void persistPartialSettings({
                        "security.sms_login_alerts": fmtBool(n),
                      })
                    }
                  />
                </Card>
              )}
              {securitySection === "devices" && (
                <Card>
                  <p className="text-sm text-hx-muted">
                    Review browsers and revoke access from Sessions , revoke signs out that device.
                  </p>
                  <Button
                    variant="outlineGold"
                    className="mt-4"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setTab("Sessions");
                      replace("/profile?tab=sessions", { scroll: false });
                    }}
                  >
                    Open Sessions
                  </Button>
                </Card>
              )}
            </div>
          </div>
        )}

        {tab === "Activity" && (
          <Card>
            <div className="mb-4 flex flex-wrap justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded border border-hx-border bg-hx-surface px-2 py-1 text-sm"
                  value={activityTypeFilter}
                  onChange={(e) =>
                    setActivityTypeFilter(e.target.value as typeof activityTypeFilter)
                  }
                >
                  <option value="all">All types</option>
                  <option value="decisions">Decisions</option>
                  <option value="executions">Executions</option>
                  <option value="security">Security</option>
                </select>
                <select
                  className="rounded border border-hx-border bg-hx-surface px-2 py-1 text-sm"
                  value={activityDaysFilter}
                  onChange={(e) => setActivityDaysFilter(e.target.value)}
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="365">Last year</option>
                  <option value="0">All time</option>
                </select>
              </div>
              <Button variant="outlineGold" size="sm" type="button" onClick={exportActivityCsv}>
                Export Activity
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-hx-border text-xs text-hx-muted">
                  <tr>
                    <th className="py-2 pr-4">Activity</th>
                    <th className="py-2 pr-4">Details</th>
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2 pr-4">Date & Time</th>
                    <th className="py-2">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hx-border">
                  {activityFiltered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-sm text-hx-muted">
                        No activity matches these filters. Try “All time” or “All types”.
                      </td>
                    </tr>
                  )}
                  {activityPaged.map((r, i) => (
                    <tr
                      key={`${r.when}-${r.activity}-${r.details}-${r.ip}-${i}`}
                    >
                      <td className="py-3">{r.activity}</td>
                      <td className="py-3 text-hx-muted">{r.details}</td>
                      <td className="py-3">{r.source}</td>
                      <td className="py-3 text-hx-muted">{r.when}</td>
                      <td className="py-3 font-mono text-xs">{r.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end gap-2 text-sm text-hx-muted">
              <button
                type="button"
                className="hover:text-hx-text disabled:opacity-40"
                disabled={activityPage <= 0}
                onClick={() => setActivityPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span className="self-center text-xs tabular-nums">
                {activityPage + 1} / {activityPages}
              </span>
              <button
                type="button"
                className="hover:text-hx-text disabled:opacity-40"
                disabled={activityPage >= activityPages - 1}
                onClick={() => setActivityPage((p) => Math.min(activityPages - 1, p + 1))}
              >
                Next
              </button>
            </div>
          </Card>
        )}

        {tab === "Sessions" && (
          <Card>
            <div className="mb-4 flex justify-end">
              <Button
                variant="dangerOutline"
                size="sm"
                type="button"
                onClick={() => void revokeAllSessions()}
              >
                Sign Out All
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-hx-border text-xs text-hx-muted">
                  <tr>
                    <th className="py-2">Device</th>
                    <th className="py-2">Location</th>
                    <th className="py-2">IP</th>
                    <th className="py-2">Last Active</th>
                    <th className="py-2">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-hx-border">
                  {sessionsMerged.map((s) => (
                    <tr key={s.key}>
                      <td className="py-3">{s.device}</td>
                      <td className="py-3 text-hx-muted">{s.location}</td>
                      <td className="py-3 font-mono text-xs">{s.ip}</td>
                      <td className="py-3 text-hx-muted">{s.last}</td>
                      <td className="py-3">
                        <StatusBadge
                          variant={
                            s.status === "Active now" ? "success" : "neutral"
                          }
                        >
                          {s.status}
                        </StatusBadge>
                      </td>
                      <td className="py-3 text-right">
                        {s.remoteId ? (
                          <button
                            type="button"
                            className="inline-flex rounded p-1 hover:bg-hx-surface-elevated"
                            title="Revoke session"
                            onClick={() => void revokeSessionRow(s.remoteId!)}
                          >
                            <Trash2 className="size-4 text-hx-danger" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="inline-flex rounded p-1 hover:bg-hx-surface-elevated"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === "Notifications" && (
          <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
            <Card className="h-fit space-y-2 p-3">
              {(
                [
                  ["in_app", "In-App"],
                  ["email", "Email"],
                  ["slack", "Slack"],
                  ["digest", "Digest"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setNotifSection(id)}
                  className={`block w-full rounded px-3 py-2 text-left text-sm ${
                    notifSection === id
                      ? "bg-hx-accent/15 font-medium text-hx-accent"
                      : "text-hx-muted hover:bg-hx-surface-elevated"
                  }`}
                >
                  {label}
                </button>
              ))}
            </Card>
            <Card>
              {notifSection === "in_app" && (
                <>
                  <h3 className="font-semibold">In-app</h3>
                  <ToggleRow
                    title="Mentions"
                    description="When someone @mentions you."
                    on={parseBool(settings["notify.in_app.mentions"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.in_app.mentions": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="System announcements"
                    description="Maintenance and product updates."
                    on={parseBool(settings["notify.in_app.system"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.in_app.system": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="Decision outcomes"
                    on={parseBool(settings["notify.in_app.decision_updates"])}
                    onChange={(n) =>
                      void persistPartialSettings({
                        "notify.in_app.decision_updates": fmtBool(n),
                      })
                    }
                  />
                  <ToggleRow
                    title="Executions"
                    on={parseBool(settings["notify.in_app.executions"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.in_app.executions": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="Signals"
                    on={parseBool(settings["notify.in_app.signals"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.in_app.signals": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="Digest summaries"
                    on={parseBool(settings["notify.in_app.digest"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.in_app.digest": fmtBool(n) })
                    }
                  />
                </>
              )}
              {notifSection === "email" && (
                <>
                  <h3 className="font-semibold">Email</h3>
                  <ToggleRow
                    title="Decisions"
                    on={parseBool(settings["notify.email.decisions"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.email.decisions": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="Executions"
                    on={parseBool(settings["notify.email.executions"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.email.executions": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="Signals"
                    on={parseBool(settings["notify.email.signals"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.email.signals": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="Weekly digest"
                    on={parseBool(settings["notify.email.digest"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.email.digest": fmtBool(n) })
                    }
                  />
                </>
              )}
              {notifSection === "slack" && (
                <>
                  <h3 className="font-semibold">Slack</h3>
                  <p className="mb-4 text-sm text-hx-muted">
                    Requires a connected Slack workspace (Connections). These toggles record intent;
                    delivery uses your bot installation.
                  </p>
                  <ToggleRow
                    title="Decision posts"
                    on={parseBool(settings["notify.slack.decisions"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.slack.decisions": fmtBool(n) })
                    }
                  />
                  <ToggleRow
                    title="Critical alerts"
                    on={parseBool(settings["notify.slack.alerts"])}
                    onChange={(n) =>
                      void persistPartialSettings({ "notify.slack.alerts": fmtBool(n) })
                    }
                  />
                </>
              )}
              {notifSection === "digest" && (
                <>
                  <h3 className="font-semibold">Digest</h3>
                  <SelectField
                    label="Digest frequency"
                    value={settings["notify.digest.frequency"]}
                    options={[
                      { value: "off", label: "Off" },
                      { value: "daily", label: "Daily" },
                      { value: "weekly", label: "Weekly" },
                    ]}
                    onChange={(v) =>
                      void persistPartialSettings({ "notify.digest.frequency": v })
                    }
                  />
                </>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldValue({
  value,
  placeholder = "Not provided",
  className,
}: {
  value?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const v = value?.trim();
  if (v) return <span className={className}>{v}</span>;
  return <span className={cn("italic text-hx-muted", className)}>{placeholder}</span>;
}

function shortUa(ua: string): string {
  if (!ua || ua === ",") return "Unknown device";
  if (ua.includes("Edg")) return "Edge";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari")) return "Safari";
  return ua.length > 56 ? `${ua.slice(0, 53)}…` : ua;
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-hx-muted">{label}</span>
      <select
        className="mt-1 w-full rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

