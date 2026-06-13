import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "./database.js";
import { sendNotificationEmail } from "./auth/smtp.js";
import { recordSecurityEvent } from "./security/audit.js";
import { clientIp } from "./security/requestContext.js";

type ContactBody = {
  name?: unknown;
  email?: unknown;
  company?: unknown;
  subject?: unknown;
  message?: unknown;
  source?: unknown;
};

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function notifyInbox(args: {
  name: string;
  email: string;
  company?: string;
  subject: string;
  message: string;
  source: string;
}): void {
  const to =
    process.env.CONTACT_TO?.trim() ||
    process.env.EARLY_ACCESS_TO?.trim() ||
    "hello@hustronix.online";

  const lines = [
    "New contact form submission",
    "",
    `Name: ${args.name}`,
    `Email: ${args.email}`,
    args.company ? `Company: ${args.company}` : null,
    `Subject: ${args.subject}`,
    `Source: ${args.source}`,
    "",
    "Message:",
    args.message,
  ].filter(Boolean);

  void sendNotificationEmail(to, `Contact: ${args.subject}`, lines.join("\n"));
}

export function handleMarketingContactRequest(req: Request, res: Response): void {
  const body = (req.body ?? {}) as ContactBody;
  const name = trim(body.name);
  const email = trim(body.email).toLowerCase();
  const company = trim(body.company);
  const subject = trim(body.subject);
  const message = trim(body.message);
  const source = trim(body.source) || "landing";

  if (!name || name.length > 100) {
    res.status(400).json({ ok: false, error: "Please enter your name." });
    return;
  }
  if (!email || email.length > 254 || !isValidEmail(email)) {
    res.status(400).json({ ok: false, error: "Please enter a valid email." });
    return;
  }
  if (company.length > 120) {
    res.status(400).json({ ok: false, error: "Company name is too long." });
    return;
  }
  if (!subject || subject.length > 140) {
    res.status(400).json({ ok: false, error: "Please enter a subject." });
    return;
  }
  if (!message || message.length > 4000) {
    res.status(400).json({ ok: false, error: "Please enter a message." });
    return;
  }
  if (source.length > 64) {
    res.status(400).json({ ok: false, error: "Invalid source." });
    return;
  }

  const ip = clientIp(req);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 512);

  db.insertMarketingContactMessage({
    id: uuidv4(),
    name,
    email,
    company: company || undefined,
    subject,
    message,
    source,
    ip,
    userAgent,
  });

  recordSecurityEvent(req, "marketing_contact.submit", "info", { email, source });

  notifyInbox({ name, email, company: company || undefined, subject, message, source });

  res.status(201).json({
    ok: true,
    message: "Thanks — we received your message and will reply soon.",
  });
}
