import { db } from "../database.js";
import { sendNotificationEmail, smtpConfigured } from "../auth/smtp.js";
import { NOTIFY_KEYS, parseBoolSetting } from "./preferences.js";
import { postSlackDirectMessage } from "./slackDelivery.js";

function parseBoolFromDb(userId: string, key: string, defaultVal: boolean): boolean {
  return parseBoolSetting(db.getSetting(userId, key), defaultVal);
}

/** Exported for tests; safe to call concurrently at low volume (single Node interval). */
export async function runDigestSweep(now = new Date()): Promise<{ usersProcessed: number; batches: number }> {
  const iso = now.toISOString();
  const digestUsers = db.listUsersWithSettingKey(NOTIFY_KEYS.digestMode, "true");
  let batches = 0;

  for (const userId of digestUsers) {
    if (userId === "system") continue;

    const ids = db.listPendingDigestNotificationIds(userId, iso, 400);
    if (!ids.length) continue;

    const rows = db.getNotificationsByIds(userId, ids);
    if (!rows.length) continue;

    const emailOn =
      parseBoolFromDb(userId, NOTIFY_KEYS.channelEmail, false) ||
      parseBoolFromDb(userId, NOTIFY_KEYS.weeklySummaryEmail, false);
    const slackOn = parseBoolFromDb(userId, NOTIFY_KEYS.channelSlack, false);
    const to = db.getUserEmailForDelivery(userId);
    const install = db.getSlackBotInstallWithToken(userId);

    const lines: string[] = [];
    let approx = 0;
    const maxBody = 8000;
    for (const r of rows) {
      const line = `• [${r.kind}] ${r.title}${r.body ? ` — ${r.body}` : ""}${r.link_url ? ` (${r.link_url})` : ""}`;
      if (approx + line.length > maxBody) break;
      lines.push(line);
      approx += line.length + 1;
    }
    const digestText =
      lines.length === 0
        ? "No new items."
        : `Hustronix digest (${rows.length} notification${rows.length === 1 ? "" : "s"})\n\n${lines.join("\n")}`;

    let emailSent = false;
    let slackSent = false;

    if (emailOn && smtpConfigured() && to) {
      try {
        emailSent = await sendNotificationEmail(
          to,
          `Hustronix notification digest (${rows.length})`,
          digestText,
        );
      } catch (e) {
        console.error("[notifications][digest] email error:", e);
      }
    }

    if (slackOn && install?.access_token) {
      try {
        slackSent = await postSlackDirectMessage(
          {
            access_token: install.access_token,
            bot_user_id: install.bot_user_id,
            raw_install_payload: install.raw_install_payload,
          },
          digestText.slice(0, 4000),
        );
      } catch (e) {
        console.error("[notifications][digest] slack error:", e);
      }
    }

    const cannotEverEmail = emailOn && !to;
    const cannotEverSlack = slackOn && !install?.access_token;
    const drainedNoChannels = !emailOn && !slackOn;
    const shouldMark =
      emailSent ||
      slackSent ||
      drainedNoChannels ||
      cannotEverEmail ||
      cannotEverSlack;

    if (shouldMark) {
      db.markNotificationsDigestSent(ids, iso);
      batches += 1;
    }
  }

  return { usersProcessed: digestUsers.length, batches };
}

let digestTimer: ReturnType<typeof setInterval> | null = null;

export function startNotificationDigestScheduler(): void {
  if (digestTimer) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.NOTIFICATION_DIGEST_DISABLED === "1") {
    console.info("[notifications] digest scheduler disabled (NOTIFICATION_DIGEST_DISABLED=1)");
    return;
  }
  const raw = process.env.NOTIFICATION_DIGEST_INTERVAL_MINUTES?.trim();
  const minutes = Math.min(24 * 60, Math.max(1, parseInt(raw || "60", 10) || 60));
  const ms = minutes * 60 * 1000;
  digestTimer = setInterval(() => {
    void runDigestSweep().catch((e) => console.error("[notifications] digest sweep failed:", e));
  }, ms);
  console.info(`[notifications] digest scheduler every ${minutes} min`);
}
