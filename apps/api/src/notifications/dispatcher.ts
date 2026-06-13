import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { sendNotificationEmail, smtpConfigured } from "../auth/smtp.js";
import { config } from "../config.js";
import { resolveNotifyPreferences } from "./preferences.js";
import { postSlackDirectMessage } from "./slackDelivery.js";

export async function notify(
  userId: string,
  event: {
    kind: string;
    title: string;
    body?: string;
    linkUrl?: string;
    payload?: Record<string, unknown>;
  },
): Promise<{
  id: string;
  channels: { inApp: boolean; email: boolean; slack: boolean; queuedForDigest: boolean };
}> {
  if (!userId || userId === "system") {
    return {
      id: "",
      channels: { inApp: false, email: false, slack: false, queuedForDigest: false },
    };
  }

  const id = uuidv4();
  const body = event.body ?? "";
  const linkUrl = event.linkUrl ?? null;
  const payloadJson = event.payload != null ? JSON.stringify(event.payload) : null;
  const prefs = resolveNotifyPreferences(db, userId, event.kind);

  const inAppDelivered: 0 | 1 = prefs.categoryOk && prefs.inAppChannel ? 1 : 0;

  const toEmail = db.getUserEmailForDelivery(userId);
  const slackInstall = db.getSlackBotInstallWithToken(userId);

  const wantsImmediateEmail =
    prefs.categoryOk && prefs.emailChannel && !prefs.digestMode && !prefs.inQuietHours;
  const wantsImmediateSlack =
    prefs.categoryOk && prefs.slackChannel && !prefs.digestMode && !prefs.inQuietHours;

  const queuedForDigest =
    prefs.digestMode &&
    prefs.categoryOk &&
    ((prefs.emailChannel && smtpConfigured() && !!toEmail) ||
      (prefs.slackChannel && !!slackInstall?.access_token));

  db.insertNotificationRow({
    id,
    userId,
    kind: event.kind,
    title: event.title,
    body,
    linkUrl,
    payloadJson,
    deliveredInApp: inAppDelivered,
    deliveredEmail: 0,
    deliveredSlack: 0,
  });

  let emailOk = false;
  let slackOk = false;

  if (wantsImmediateEmail && toEmail && smtpConfigured()) {
    try {
      emailOk = await sendNotificationEmail(toEmail, event.title, body);
      if (emailOk) db.updateNotificationDeliveryFlags(id, userId, { deliveredEmail: 1 });
    } catch (e) {
      console.error("[notifications] email delivery error:", e);
    }
  }

  if (wantsImmediateSlack && slackInstall) {
    try {
      const text = `*${event.title}*\n${body}${linkUrl ? `\n${linkUrl}` : ""}`.slice(0, 4000);
      slackOk = await postSlackDirectMessage(
        {
          access_token: slackInstall.access_token,
          bot_user_id: slackInstall.bot_user_id,
          raw_install_payload: slackInstall.raw_install_payload,
        },
        text,
      );
      if (slackOk) db.updateNotificationDeliveryFlags(id, userId, { deliveredSlack: 1 });
    } catch (e) {
      console.error("[notifications] slack delivery error:", e);
    }
  }

  return {
    id,
    channels: {
      inApp: inAppDelivered === 1,
      email: emailOk,
      slack: slackOk,
      queuedForDigest,
    },
  };
}

/** Default deep-link base for notification URLs when caller omits absolute link. */
export function defaultAppLink(path: string): string {
  const base = config.server.appOrigin.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
