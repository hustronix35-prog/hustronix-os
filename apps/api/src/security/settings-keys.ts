/** Keys clients may write via `/api/settings` and `/api/settings/bulk`. */

const SERVER_ONLY_KEYS = new Set([
  "security.password_credential_set",
  "security.totp_enabled",
  "org.owner_user_id",
  "org.role",
]);

const ALLOWED_EXACT = new Set([
  "prefs.language",
  "prefs.theme",
  "prefs.default_dashboard",
  "prefs.items_per_page",
  "prefs.compact_mode",
  "prefs.enable_animations",
  "prefs.auto_save",
  "security.email_login_alerts",
  "security.sms_login_alerts",
  "security.email_otp_login",
  "notify.in_app.mentions",
  "notify.in_app.system",
  "notify.in_app.decision_updates",
  "notify.in_app.executions",
  "notify.in_app.signals",
  "notify.in_app.digest",
  "notify.email.decisions",
  "notify.email.executions",
  "notify.email.signals",
  "notify.email.digest",
  "notify.slack.decisions",
  "notify.slack.alerts",
  "notify.digest.frequency",
  "notify.quiet_start",
  "notify.quiet_end",
  "org.name",
  "org.timezone",
  "org.date_format",
  "org.currency",
  "org.fiscal_year_start",
  "org.week_start",
  "org.onboarding.completed",
  "org.value_prop_one_liner",
  "org.icp_summary",
  "org.north_star_90d",
  "org.decision_style",
  "org.decision_style_notes",
  "org.team_size_band",
  "org.company_stage",
  "org.top_operational_pain",
  "org.competitive_landscape",
  "org.stack_snapshot",
  "org.constraints_notes",
  "org.agent_context_digest",
  "grace.slack_hours",
  "grace.github_hours",
  "grace.manual_hours",
  "rules.min_confidence_pct",
  "capacity.system_total",
  "capacity.team_leadership",
  "capacity.team_growth",
  "capacity.team_product",
  "capacity.team_operations",
  "ui.auto_kill_unverified",
  "ui.auto_assign_executions",
  "ui.smart_notifications",
  "ui.ai_insights_reports",
  "ui.autonomy_level",
  "ui.notify_decision_updates",
  "ui.notify_execution_milestones",
  "ui.notify_signal_digest",
  "ui.notify_weekly_summary",
  "product.tour.completed",
  "product.tour.skipped",
  "product.tour.last_step",
  "product.tour.completed_at",
  "product.tour.dismissed_at",
  "data.train_on_customer_data",
  "data.retention_days",
]);

const ALLOWED_PREFIXES = ["profile."] as const;

export class InvalidSettingKeyError extends Error {
  constructor(key: string) {
    super(`Setting key is not allowed: ${key}`);
    this.name = "InvalidSettingKeyError";
  }
}

export function assertWritableSettingKey(key: string): void {
  const k = String(key || "").trim();
  if (!k || k.length > 120) throw new InvalidSettingKeyError(k || "(empty)");
  if (SERVER_ONLY_KEYS.has(k)) throw new InvalidSettingKeyError(k);
  if (k.startsWith("core_memory.")) throw new InvalidSettingKeyError(k);
  if (ALLOWED_EXACT.has(k)) return;
  for (const prefix of ALLOWED_PREFIXES) {
    if (k.startsWith(prefix)) return;
  }
  throw new InvalidSettingKeyError(k);
}

export function filterWritableSettings(
  settings: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    assertWritableSettingKey(k);
    out[k] = String(v);
  }
  return out;
}
