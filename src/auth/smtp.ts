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
  await transport.sendMail({
    from: e.fromAddress,
    to,
    subject,
    text: `${intro} ${code}\n\n${footer}`,
    html: `<p>${intro} <strong>${code}</strong></p><p>${footer}</p>`,
  });
}
