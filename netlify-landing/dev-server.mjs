/**
 * Local server for netlify-landing (static + early-access API).
 * Use when Netlify CLI / Blobs are not available: node dev-server.mjs
 * Loads .env.leads (then .env) for EARLY_ACCESS_ADMIN_PASSWORD.
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendLead, readLeads } from "./lib/leads-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8888;
const ROOT = __dirname;

process.env.LEADS_USE_FILE = "1";

async function loadEnvFile(filename) {
  try {
    const raw = await fs.readFile(path.join(ROOT, filename), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
    return true;
  } catch {
    return false;
  }
}

async function loadEnv() {
  await loadEnvFile(".env.leads");
  await loadEnvFile(".env");
}

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function trim(v) {
  return typeof v === "string" ? v.trim() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

async function handleSubmit(body) {
  const name = trim(body.name);
  const email = trim(body.email).toLowerCase();
  const company = trim(body.company);
  const role = trim(body.role);
  const source = trim(body.source) || "landing-static";

  if (!name || name.length > 100) {
    return { status: 400, data: { ok: false, error: "Please enter your name." } };
  }
  if (!email || !isValidEmail(email)) {
    return {
      status: 400,
      data: { ok: false, error: "Please enter a valid work email." },
    };
  }

  await appendLead({
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    name,
    email,
    company: company || "",
    role: role || "",
    source,
    userAgent: "",
  });

  return {
    status: 201,
    data: {
      ok: true,
      message:
        "You're on the list. We'll reach out when early access opens.",
    },
  };
}

async function handleList(body) {
  const adminPassword = process.env.EARLY_ACCESS_ADMIN_PASSWORD?.trim();
  if (!adminPassword) {
    return {
      status: 503,
      data: {
        ok: false,
        error:
          "Set EARLY_ACCESS_ADMIN_PASSWORD in .env.leads then restart dev-server.",
      },
    };
  }

  const password = trim(body.password);
  if (!password) {
    return { status: 400, data: { ok: false, error: "Password required." } };
  }
  if (password !== adminPassword) {
    return { status: 401, data: { ok: false, error: "Incorrect password." } };
  }

  const entries = await readLeads();
  return {
    status: 200,
    data: { ok: true, count: entries.length, entries },
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

async function serveStatic(urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  rel = rel.split("?")[0];
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) return null;
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return { buf, type: MIME[ext] || "application/octet-stream" };
  } catch {
    return null;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(data));
}

await loadEnv();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "POST" && pathname === "/.netlify/functions/submit-early-access") {
    const body = await readBody(req);
    if (!body) return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
    const out = await handleSubmit(body);
    return sendJson(res, out.status, out.data);
  }

  if (req.method === "POST" && pathname === "/.netlify/functions/list-early-access") {
    const body = await readBody(req);
    if (!body) return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
    const out = await handleList(body);
    return sendJson(res, out.status, out.data);
  }

  const file = await serveStatic(pathname);
  if (file) {
    res.writeHead(200, { "Content-Type": file.type });
    res.end(file.buf);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Netlify landing dev server: http://127.0.0.1:${PORT}`);
  console.log(`Leads viewer: http://127.0.0.1:${PORT}/leads.html`);
  console.log(
    process.env.EARLY_ACCESS_ADMIN_PASSWORD
      ? "EARLY_ACCESS_ADMIN_PASSWORD loaded (.env.leads or .env)"
      : "WARNING: copy .env.leads.example to .env.leads and set EARLY_ACCESS_ADMIN_PASSWORD",
  );
});
