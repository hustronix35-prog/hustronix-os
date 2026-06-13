import type { HustronixDB } from "../database.js";

/** Keys persisted by Settings UI (`SettingsClient.tsx` + `/api/settings/bulk`). */
export const NOTIFY_KEYS = {
  /** General → Smart notifications: when on, batch outbound email+Slack via digest instead of per-event. */
  digestMode: "ui.smart_notifications",
  /** Notifications tab — category gates. */
  categoryDecision: "ui.notify_decision_updates",
  categoryExecution: "ui.notify_execution_milestones",
  categorySignal: "ui.notify_signal_digest",
  /** Weekly summary toggle — also used as legacy “email notifications on” until a dedicated channel toggle exists in UI. */
  weeklySummaryEmail: "ui.notify_weekly_summary",
  /** Optional explicit channel toggles (defaults applied when unset). */
  channelInApp: "notify.channel_in_app",
  channelEmail: "notify.channel_email",
  channelSlack: "notify.channel_slack",
  quietStart: "notify.quiet_start",
  quietEnd: "notify.quiet_end",
} as const;

export function parseBoolSetting(raw: string | null, defaultVal: boolean): boolean {
  if (raw === undefined || raw === null || raw === "") return defaultVal;
  const v = String(raw).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "on" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "off" || v === "no") return false;
  return defaultVal;
}

function categorySettingKeyForKind(kind: string): string {
  if (kind.startsWith("execution.")) return NOTIFY_KEYS.categoryExecution;
  if (kind.startsWith("signal.")) return NOTIFY_KEYS.categorySignal;
  return NOTIFY_KEYS.categoryDecision;
}

export function categoryAllowsEvent(db: HustronixDB, userId: string, kind: string): boolean {
  const key = categorySettingKeyForKind(kind);
  return parseBoolSetting(db.getSetting(userId, key), true);
}

export type ResolvedNotifyPrefs = {
  digestMode: boolean;
  categoryOk: boolean;
  inAppChannel: boolean;
  emailChannel: boolean;
  slackChannel: boolean;
  inQuietHours: boolean;
};

function parseTimeHHMM(s: string | null): { h: number; m: number } | null {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s.trim())) return null;
  const [a, b] = s.trim().split(":");
  const h = parseInt(a, 10);
  const m = parseInt(b, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** True if `now` falls inside [quietStart, quietEnd) possibly crossing midnight. */
export function inQuietHours(
  now: Date,
  quietStart: string | null,
  quietEnd: string | null,
): boolean {
  const a = parseTimeHHMM(quietStart);
  const b = parseTimeHHMM(quietEnd);
  if (!a || !b) return false;
  const cur = minutesSinceMidnight(now);
  const s = a.h * 60 + a.m;
  const e = b.h * 60 + b.m;
  if (s === e) return false;
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e;
}

export function resolveNotifyPreferences(db: HustronixDB, userId: string, kind: string, now = new Date()): ResolvedNotifyPrefs {
  const digestMode = parseBoolSetting(db.getSetting(userId, NOTIFY_KEYS.digestMode), false);
  const categoryOk = categoryAllowsEvent(db, userId, kind);
  const inAppChannel = parseBoolSetting(db.getSetting(userId, NOTIFY_KEYS.channelInApp), true);
  const weeklyOn = parseBoolSetting(db.getSetting(userId, NOTIFY_KEYS.weeklySummaryEmail), false);
  const explicitEmail = db.getSetting(userId, NOTIFY_KEYS.channelEmail);
  const emailChannel =
    explicitEmail !== null && explicitEmail !== ""
      ? parseBoolSetting(explicitEmail, false)
      : weeklyOn;
  const explicitSlack = db.getSetting(userId, NOTIFY_KEYS.channelSlack);
  const slackChannel =
    explicitSlack !== null && explicitSlack !== ""
      ? parseBoolSetting(explicitSlack, false)
      : false;
  const inQuiet = inQuietHours(now, db.getSetting(userId, NOTIFY_KEYS.quietStart), db.getSetting(userId, NOTIFY_KEYS.quietEnd));
  return {
    digestMode,
    categoryOk,
    inAppChannel,
    emailChannel,
    slackChannel,
    inQuietHours: inQuiet,
  };
}
