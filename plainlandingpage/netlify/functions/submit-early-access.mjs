/**
 * Save early-access form submissions (Netlify Blobs — no database, no Google).
 * Set EARLY_ACCESS_ADMIN_PASSWORD in Netlify for leads.html viewer.
 */

import { appendLead } from "./lib/leads-store.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function trim(v) {
  return typeof v === "string" ? v.trim() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  const body = parseBody(event);
  if (!body) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Invalid JSON body." }),
    };
  }

  const name = trim(body.name);
  const email = trim(body.email).toLowerCase();
  const company = trim(body.company);
  const role = trim(body.role);
  const source = trim(body.source) || "landing-static";

  if (!name || name.length > 100) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Please enter your name." }),
    };
  }
  if (!email || email.length > 254 || !isValidEmail(email)) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Please enter a valid work email." }),
    };
  }
  if (company.length > 120 || role.length > 80 || source.length > 64) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "One or more fields are too long." }),
    };
  }

  const entry = {
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    name,
    email,
    company: company || "",
    role: role || "",
    source,
    userAgent: String(event.headers["user-agent"] || "").slice(0, 512),
  };

  try {
    await appendLead(entry, event);
  } catch (err) {
    console.error("appendLead failed", err);
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error:
          "Storage is not available. Deploy on Netlify with Blobs enabled, or use netlify dev locally.",
      }),
    };
  }

  return {
    statusCode: 201,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      message:
        "You're on the list. We'll reach out when early access opens.",
    }),
  };
}

export default handler;
