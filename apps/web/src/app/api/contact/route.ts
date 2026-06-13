import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

/**
 * Contact mail uses SMTP_* from this app’s env (e.g. `.env.local`, gitignored).
 * In dev, the Express API also loads `apps/web/.env.local` so OTP mail uses the same values (`apps/api/src/config.ts`).
 * In production, set SMTP_* on both the Next host and the API host — do not rely on committed files.
 */

type ContactPayload = {
  name?: unknown;
  email?: unknown;
  company?: unknown;
  subject?: unknown;
  message?: unknown;
};

const DEFAULT_CONTACT_TO = "hello@hustronix.online";
const DEFAULT_CONTACT_FROM = "no-reply@hustronix.online";

function getContactTo(): string {
  const raw = process.env.CONTACT_TO?.trim();
  return raw || DEFAULT_CONTACT_TO;
}

function getContactFrom(): string {
  const raw = process.env.CONTACT_FROM?.trim();
  return raw || DEFAULT_CONTACT_FROM;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function asTrimmedString(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

function isValidEmail(email: string): boolean {
  // Intentionally conservative (no full RFC); good for contact forms.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim() || "";
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";

  const portRaw = process.env.SMTP_PORT?.trim();
  const secureRaw = process.env.SMTP_SECURE?.trim();
  const port = portRaw ? Number(portRaw) : 587;
  const secure = secureRaw ? secureRaw === "1" || secureRaw.toLowerCase() === "true" : false;

  if (!host || !user || !pass) return null;
  if (!Number.isFinite(port) || port <= 0) return null;

  return { host, port, secure, user, pass };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendContactEmail(args: {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  name: string;
  email: string;
  company?: string;
  message: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const smtp = getSmtpConfig();
  if (!smtp) {
    return { ok: false, error: "SMTP not configured." };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  const safeSubject = args.subject.replaceAll(/[\r\n]+/g, " ").slice(0, 180);
  const safeFromName = "Hustronix";
  const safeMessage = args.message.replaceAll("\r\n", "\n").trim();

  const text = [
    "New contact form submission",
    "",
    `Name: ${args.name}`,
    `Email: ${args.email}`,
    args.company ? `Company: ${args.company}` : null,
    `Subject: ${args.subject}`,
    "",
    "Message:",
    safeMessage,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height: 1.5;">
  <h2 style="margin:0 0 12px;">New contact form submission</h2>
  <table style="border-collapse: collapse; width: 100%; max-width: 720px;">
    <tbody>
      <tr><td style="padding:6px 10px; border:1px solid #e5e7eb; width: 140px;"><b>Name</b></td><td style="padding:6px 10px; border:1px solid #e5e7eb;">${escapeHtml(args.name)}</td></tr>
      <tr><td style="padding:6px 10px; border:1px solid #e5e7eb;"><b>Email</b></td><td style="padding:6px 10px; border:1px solid #e5e7eb;">${escapeHtml(args.email)}</td></tr>
      ${
        args.company
          ? `<tr><td style="padding:6px 10px; border:1px solid #e5e7eb;"><b>Company</b></td><td style="padding:6px 10px; border:1px solid #e5e7eb;">${escapeHtml(args.company)}</td></tr>`
          : ""
      }
      <tr><td style="padding:6px 10px; border:1px solid #e5e7eb;"><b>Subject</b></td><td style="padding:6px 10px; border:1px solid #e5e7eb;">${escapeHtml(args.subject)}</td></tr>
    </tbody>
  </table>
  <h3 style="margin:16px 0 8px;">Message</h3>
  <pre style="margin:0; padding:12px; background:#0b0b0b; color:#e5e7eb; border-radius:12px; white-space:pre-wrap;">${escapeHtml(
    safeMessage,
  )}</pre>
</div>`;

  try {
    await transporter.sendMail({
      to: args.to,
      from: `${safeFromName} <${args.from}>`,
      replyTo: args.replyTo,
      subject: `Contact: ${safeSubject}`,
      text,
      html,
    });
    return { ok: true };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to send email.",
    };
  }
}

export async function POST(req: Request) {
  let body: ContactPayload;
  try {
    body = (await req.json()) as ContactPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const name = asTrimmedString(body.name);
  const email = asTrimmedString(body.email);
  const company = asTrimmedString(body.company);
  const subject = asTrimmedString(body.subject);
  const message = asTrimmedString(body.message);

  if (!isNonEmptyString(name) || name.length > 100) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid name." },
      { status: 400 },
    );
  }
  if (!isNonEmptyString(email) || email.length > 254 || !isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid email." },
      { status: 400 },
    );
  }
  if (company.length > 120) {
    return NextResponse.json(
      { ok: false, error: "Company is too long." },
      { status: 400 },
    );
  }
  if (!isNonEmptyString(subject) || subject.length > 140) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid subject." },
      { status: 400 },
    );
  }
  if (!isNonEmptyString(message) || message.length > 4000) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid message." },
      { status: 400 },
    );
  }

  const contactTo = getContactTo();
  const contactFrom = getContactFrom();

  const sent = await sendContactEmail({
    to: contactTo,
    from: contactFrom,
    replyTo: email,
    subject,
    name,
    email,
    company: company || undefined,
    message,
  });

  if (sent.ok) {
    return NextResponse.json({ ok: true, to: contactTo } as const);
  }

  // Safe fallback: never drop the message on the floor.
  console.info("[contact] SMTP send failed; logging submission", {
    to: contactTo,
    from: contactFrom,
    error: sent.error,
    name,
    email,
    company: company || undefined,
    subject,
    message,
    receivedAt: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      ok: true,
      to: contactTo,
      note: "Email delivery not configured; stored in server logs.",
    } as const,
    { status: 202 },
  );
}

