import { NextResponse } from "next/server";
import {
  appendEarlyAccessLead,
  type EarlyAccessLead,
} from "@/lib/early-access-leads-store";

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const name = trim(body.name);
  const email = trim(body.email).toLowerCase();
  const company = trim(body.company);
  const role = trim(body.role);
  const source = trim(body.source) || "landing";

  if (!name || name.length > 100) {
    return NextResponse.json(
      { ok: false, error: "Please enter your name." },
      { status: 400 },
    );
  }
  if (!email || email.length > 254 || !isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid work email." },
      { status: 400 },
    );
  }
  if (company.length > 120 || role.length > 80 || source.length > 64) {
    return NextResponse.json(
      { ok: false, error: "One or more fields are too long." },
      { status: 400 },
    );
  }

  const entry: EarlyAccessLead = {
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    name,
    email,
    company: company || "",
    role: role || "",
    source,
    userAgent: String(req.headers.get("user-agent") || "").slice(0, 512),
  };

  try {
    await appendEarlyAccessLead(entry);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not save submission." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message:
        "You're on the list. We'll reach out when early access opens.",
    },
    { status: 201 },
  );
}
