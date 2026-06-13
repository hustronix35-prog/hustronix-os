import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "./database.js";
import { sendNotificationEmail } from "./auth/smtp.js";
import { recordSecurityEvent } from "./security/audit.js";
import { clientIp } from "./security/requestContext.js";

type EarlyAccessBody = {
  email?: unknown;
  name?: unknown;
  company?: unknown;
  role?: unknown;
  source?: unknown;
};

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function notifyInbox(args: {
  email: string;
  name: string;
  company?: string;
  role?: string;
  source: string;
  duplicate: boolean;
}): void {
  const to =
    process.env.EARLY_ACCESS_TO?.trim() ||
    process.env.CONTACT_TO?.trim() ||
    "hello@hustronix.online";

  const lines = [
    args.duplicate ? "Duplicate early access request (email already on file)" : "New early access request",
    "",
    `Name: ${args.name}`,
    `Email: ${args.email}`,
    args.company ? `Company: ${args.company}` : null,
    args.role ? `Role: ${args.role}` : null,
    `Source: ${args.source}`,
  ].filter(Boolean);

  void sendNotificationEmail(
    to,
    args.duplicate ? "Early access (duplicate)" : "Early access request",
    lines.join("\n"),
  );
}

export function handleEarlyAccessRequest(req: Request, res: Response): void {
  const body = (req.body ?? {}) as EarlyAccessBody;
  const email = trim(body.email).toLowerCase();
  const name = trim(body.name);
  const company = trim(body.company);
  const role = trim(body.role);
  const source = trim(body.source) || "landing";

  if (!name || name.length > 100) {
    res.status(400).json({ ok: false, error: "Please enter your name." });
    return;
  }
  if (!email || email.length > 254 || !isValidEmail(email)) {
    res.status(400).json({ ok: false, error: "Please enter a valid work email." });
    return;
  }
  if (company.length > 120) {
    res.status(400).json({ ok: false, error: "Company name is too long." });
    return;
  }
  if (role.length > 80) {
    res.status(400).json({ ok: false, error: "Role is too long." });
    return;
  }
  if (source.length > 64) {
    res.status(400).json({ ok: false, error: "Invalid source." });
    return;
  }

  const ip = clientIp(req);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 512);

  const inserted = db.insertEarlyAccessLead({
    id: uuidv4(),
    email,
    name,
    company: company || undefined,
    role: role || undefined,
    source,
    ip,
    userAgent,
  });

  recordSecurityEvent(req, "early_access.submit", "info", {
    email,
    duplicate: !inserted.created,
    source,
  });

  notifyInbox({
    email,
    name,
    company: company || undefined,
    role: role || undefined,
    source,
    duplicate: !inserted.created,
  });

  res.status(inserted.created ? 201 : 200).json({
    ok: true,
    created: inserted.created,
    message: inserted.created
      ? "You're on the list. We'll reach out when early access opens."
      : "You're already on the list — we'll be in touch.",
  });
}
