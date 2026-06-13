import nodemailer from "nodemailer";
import { config } from "../config.js";

export function smtpConfigured(): boolean {
  const e = config.email;
  return !!(e.smtpHost && e.smtpUser && e.smtpPass && e.fromAddress);
}

function buildTransport() {
  const e = config.email;
  return nodemailer.createTransport({
    host: e.smtpHost,
    port: e.smtpPort,
    secure: e.smtpSecure,
    auth: { user: e.smtpUser, pass: e.smtpPass },
    ...(!e.smtpSecure ? { requireTLS: true } : {}),
  });
}

/**
 * Sends a 6-digit OTP. Recipient address is the same identifier as `users.username`
 * (often an email when SMTP verification is enabled).
 */
export async function sendOtpEmail(to: string, code: string, purpose: "signup" | "login"): Promise<void> {
  const e = config.email;
  const ttl = e.otpTtlMinutes;
  const subject = purpose === "signup" ? "Verify your Hustronix account" : "Your Hustronix sign-in code";
  const intro =
    purpose === "signup"
      ? "Your verification code is:"
      : "Your sign-in code is:";
  const footer = `This code expires in ${ttl} minutes. If you did not request this, you can ignore this email.`;

  const transport = buildTransport();
  const fromHeader = `${e.fromDisplayName} <${e.fromAddress}>`;
  await transport.sendMail({
    from: fromHeader,
    to,
    subject,
    text: `${intro} ${code}\n\n${footer}`,
    html: `<p>${intro} <strong>${code}</strong></p><p>${footer}</p>`,
  });
}

/**
 * Transactional notification email. No-op with console log when SMTP is not configured (never throws).
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  bodyText: string,
  bodyHtml?: string,
): Promise<boolean> {
  if (!smtpConfigured()) {
    console.info("[smtp] sendNotificationEmail skipped: SMTP not configured");
    return false;
  }
  try {
    const e = config.email;
    const transport = buildTransport();
    const fromHeader = `${e.fromDisplayName} <${e.fromAddress}>`;
    const text = bodyText.slice(0, 12000);
    const html =
      bodyHtml !== undefined
        ? bodyHtml.slice(0, 50000)
        : `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
    await transport.sendMail({
      from: fromHeader,
      to,
      subject: subject.slice(0, 200),
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error("[smtp] sendNotificationEmail failed:", err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type SignupOtpDeliveryMode = "smtp" | "dev_console";

/**
 * Signup verification delivery: sends real mail when SMTP is configured.
 * When SMTP is not configured and NODE_ENV !== "production", logs the OTP to the
 * server console so local signup stays completable without a mail server.
 * In production without SMTP, throws — password signup must not skip verification.
 */
export async function deliverSignupOtp(to: string, code: string): Promise<SignupOtpDeliveryMode> {
  if (smtpConfigured()) {
    await sendOtpEmail(to, code, "signup");
    return "smtp";
  }
  if (process.env.NODE_ENV !== "production") {
    const ttl = config.email.otpTtlMinutes;
    // Intentional dev-only path; never use in production.
    console.info(
      `[auth][dev-only] Signup verification code for ${to}: ${code} (expires in ${ttl} min; configure SMTP_* to send email instead)`,
    );
    return "dev_console";
  }
  const err = new Error("Email verification is not configured on this server") as Error & { code: string };
  err.code = "EMAIL_UNCONFIGURED";
  throw err;
}
