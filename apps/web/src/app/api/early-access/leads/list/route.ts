import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { readEarlyAccessLeads } from "@/lib/early-access-leads-store";

function securePasswordMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const adminPassword = process.env.EARLY_ACCESS_ADMIN_PASSWORD?.trim();
  if (!adminPassword) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Set EARLY_ACCESS_ADMIN_PASSWORD in apps/web/.env.local (same value as netlify-landing/.env).",
      },
      { status: 503 },
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const password = typeof body.password === "string" ? body.password.trim() : "";
  if (!password) {
    return NextResponse.json(
      { ok: false, error: "Password required." },
      { status: 400 },
    );
  }

  if (!securePasswordMatch(password, adminPassword)) {
    return NextResponse.json(
      { ok: false, error: "Incorrect password." },
      { status: 401 },
    );
  }

  try {
    const entries = await readEarlyAccessLeads();
    return NextResponse.json({
      ok: true,
      count: entries.length,
      entries,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not read leads file." },
      { status: 502 },
    );
  }
}
