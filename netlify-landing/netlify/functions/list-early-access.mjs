/**
 * Password-protected list of early-access leads (Netlify Blobs).
 * Set EARLY_ACCESS_ADMIN_PASSWORD in Netlify site environment variables.
 */

import { readLeads } from "./lib/leads-store.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

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
  try {
    return await handleRequest(event);
  } catch (err) {
    console.error("list-early-access unhandled", err);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Leads function failed. Check Netlify function logs.",
      }),
    };
  }
}

async function handleRequest(event) {
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

  const adminPassword = process.env.EARLY_ACCESS_ADMIN_PASSWORD?.trim();
  if (!adminPassword) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error:
          "Viewer password not configured. Set EARLY_ACCESS_ADMIN_PASSWORD in Netlify.",
      }),
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

  const password =
    typeof body.password === "string" ? body.password.trim() : "";
  if (!password) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Password required." }),
    };
  }

  if (password !== adminPassword) {
    return {
      statusCode: 401,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Incorrect password." }),
    };
  }

  const entries = await readLeads(event);
  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      count: entries.length,
      entries,
    }),
  };
}

export default handler;
