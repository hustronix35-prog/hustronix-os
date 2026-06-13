/** Keys stored via GET/POST `/api/settings` (SQLite `settings` table per user). */

export const PROFILE_SETTING_DEFAULTS: Record<string, string> = {
  "prefs.language": "en",
  "prefs.theme": "dark",
  "prefs.default_dashboard": "mission-control",
  "prefs.items_per_page": "25",
  "prefs.compact_mode": "true",
  "prefs.enable_animations": "true",
  "prefs.auto_save": "false",
  "security.totp_enabled": "false",
  "security.email_login_alerts": "true",
  "security.sms_login_alerts": "false",
  "notify.in_app.mentions": "true",
  "notify.in_app.system": "true",
  "notify.in_app.decision_updates": "true",
  "notify.in_app.executions": "true",
  "notify.in_app.signals": "true",
  "notify.in_app.digest": "false",
  "notify.email.decisions": "true",
  "notify.email.executions": "false",
  "notify.email.signals": "true",
  "notify.email.digest": "false",
  "notify.slack.decisions": "false",
  "notify.slack.alerts": "false",
  "notify.digest.frequency": "weekly",
};

export function mergeProfileSettings(raw: Record<string, string> | undefined) {
  return { ...PROFILE_SETTING_DEFAULTS, ...(raw || {}) };
}

export function parseBool(s: string | undefined, fallback = false): boolean {
  if (s === undefined) return fallback;
  return s === "true" || s === "1";
}

export function fmtBool(b: boolean): string {
  return b ? "true" : "false";
}
