/**
 * UI QA pass (Puppeteer). Ensures a demo user exists, logs in, then screenshots routes.
 *
 * Env:
 *   QA_BASE_URL       — UI origin (default http://localhost:3000)
 *   QA_API_ORIGIN     — API for register ping (default http://127.0.0.1:3005)
 *   QA_USERNAME       — default hustronix-qa-automation@example.test (created directly in local SQLite)
 *   QA_PASSWORD       — default DemoCheck2026! (matches create-login-account.ts)
 *   QA_SKIP_AUTH      — if "1", skip login (anonymous-only pass)
 *   QA_SKIP_AXE       — if "1", skip @axe-core/puppeteer scans
 *   QA_AXE_FAIL_ON    — critical | serious | any | none (default: critical — exit 1 if violations at or above this impact)
 *
 * Prereq: API + Next dev servers, or run: npm run dev:stack
 * Create user once: npx tsx ops/scripts/create-login-account.ts
 */
import puppeteer from "puppeteer";
import { AxePuppeteer } from "@axe-core/puppeteer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Pre-loaded bundle: @axe-core/puppeteer's default resolver breaks when cwd/repo paths contain spaces (Windows URL-encoding). */
const requireAxe = createRequire(fileURLToPath(import.meta.url));
const AXE_INJECT_SOURCE = fs.readFileSync(
  requireAxe.resolve("axe-core/axe.min.js"),
  "utf8",
);
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, ".gstack", "qa-reports", "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const API_ORIGIN = process.env.QA_API_ORIGIN || "http://127.0.0.1:3005";
const QA_USER = process.env.QA_USERNAME || "hustronix-qa-automation@example.test";
const QA_LOGIN = QA_USER.includes("@") ? QA_USER : `${QA_USER}@example.test`;
const QA_PASS = process.env.QA_PASSWORD || "DemoCheck2026!";
const SKIP_AUTH = process.env.QA_SKIP_AUTH === "1";
const SKIP_AXE = process.env.QA_SKIP_AXE === "1";
const AXE_FAIL_ON = (process.env.QA_AXE_FAIL_ON || "critical").toLowerCase();

/** Fail if violation impact is at or above threshold (serious includes serious+critical). */
const IMPACT_ORDER = { minor: 0, moderate: 1, serious: 2, critical: 3 };

function axeImpactMeetsThreshold(impact, threshold) {
  if (threshold === "none") return false;
  if (threshold === "any") return true;
  const ti = IMPACT_ORDER[impact] ?? 0;
  const tt = IMPACT_ORDER[threshold];
  if (tt === undefined) return false;
  return ti >= tt;
}

const PUBLIC_PATHS = ["/", "/contact", "/privacy", "/terms"];
const AUTH_PATHS_ANON = ["/login", "/signup"];
const PROTECTED_PATHS = [
  "/mission-control",
  "/execute",
  "/signals",
  "/chat",
  "/reports",
  "/teams",
  "/profile",
  "/settings",
];

const results = [];
const assertions = {
  registerOrExistsOk: false,
  loginSucceeded: false,
  missionControlShowsDashboard: false,
};

const axeRuns = [];

async function ensureLocalUser() {
  const [{ db }, { hashPassword }] = await Promise.all([
    import("../../apps/api/dist/database.js"),
    import("../../apps/api/dist/auth/password.js"),
  ]);
  const existingId = db.findUserIdByEmail(QA_LOGIN);
  const hash = hashPassword(QA_PASS);
  if (existingId) {
    db.updateUserPasswordHash(existingId, hash);
  } else {
    const id = crypto.randomUUID();
    db.createUser(id, QA_LOGIN, hash, QA_LOGIN);
    db.updateSetting(id, "profile.email", QA_LOGIN);
  }
  assertions.registerOrExistsOk = true;
}

async function screenshot(page, slug, p) {
  const shot = path.join(OUT, `puppet-${slug}.png`);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: shot, fullPage: false });
  results.push({ kind: "nav", path: p, url: page.url(), screenshot: shot });
}

async function runAxeScan(page, label, pathLabel) {
  if (SKIP_AXE) {
    const s = { skipped: true, label, path: pathLabel };
    axeRuns.push(s);
    return s;
  }
  try {
    const raw = await new AxePuppeteer(page, AXE_INJECT_SOURCE)
      .disableRules(["color-contrast"])
      .analyze();
    const violations = raw.violations || [];
    let failing = 0;
    const breakdown = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const v of violations) {
      const imp = v.impact || "minor";
      if (breakdown[imp] !== undefined) breakdown[imp]++;
      else breakdown.minor++;
      if (axeImpactMeetsThreshold(imp, AXE_FAIL_ON)) failing++;
    }
    const entry = {
      label,
      path: pathLabel,
      url: page.url(),
      violations: violations.length,
      failingUnderThreshold: failing,
      breakdown,
      ids: violations.map((v) => v.id),
    };
    axeRuns.push(entry);
    results.push({ kind: "axe", ...entry });
    return entry;
  } catch (e) {
    const err = { label, path: pathLabel, error: String(e?.message || e) };
    axeRuns.push(err);
    results.push({ kind: "axe_error", ...err });
    return err;
  }
}

async function visit(page, p) {
  const url = `${BASE}${p}`;
  const slug = p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "_");
  try {
    const resp = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    const status = resp?.status() ?? 0;
    await screenshot(page, slug, p);
    return { ok: true, httpStatus: status };
  } catch (e) {
    results.push({
      kind: "nav_fail",
      path: p,
      url,
      error: String(e?.message || e),
    });
    return { ok: false };
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("#login-user", { timeout: 15000 });
  /** Same-origin fetch sets `hustronix_session` without fighting React controlled inputs. */
  const loginErr = await page.evaluate(async ([u, pw]) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: pw }),
    });
    const text = await res.text();
    if (!res.ok) return text || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text);
      if (j.userId && typeof localStorage !== "undefined") {
        localStorage.setItem("hustronix_userId", j.userId);
      }
    } catch {
      /* ignore */
    }
    const bulk = await fetch("/api/settings/bulk", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { "org.onboarding.completed": "1" },
      }),
    });
    const bulkText = await bulk.text();
    if (!bulk.ok) return `settings/bulk: ${bulkText || bulk.status}`;
    return null;
  }, [QA_LOGIN, QA_PASS]);
  if (loginErr) throw new Error(`Login API: ${loginErr}`);
  await page.goto(`${BASE}/mission-control`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  if (page.url().includes("/login")) {
    throw new Error("Session cookie not accepted — still redirected to /login");
  }
  assertions.loginSucceeded = true;
}

async function assertMissionDashboard(page) {
  await page.goto(`${BASE}/mission-control`, { waitUntil: "networkidle2", timeout: 60000 });
  const text = await page.evaluate(() => document.body.innerText);
  const hasCard = await page.$("#login-user");
  assertions.missionControlShowsDashboard =
    !hasCard && /\bMISSION CONTROL\b/i.test(text);
  if (!assertions.missionControlShowsDashboard) {
    results.push({
      kind: "assert_fail",
      message: "Expected authenticated Mission Control (MISSION CONTROL, no #login-user)",
    });
  }
  await screenshot(page, "mission-control", "/mission-control");
}

async function main() {
  if (!SKIP_AUTH) {
    try {
      await ensureLocalUser();
    } catch (e) {
      results.push({
        kind: "ensure_user_fail",
        error: String(e?.message || e),
      });
      console.error(e);
      process.exit(1);
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      results.push({
        kind: "console",
        level: "error",
        url: page.url(),
        text: msg.text(),
      });
    }
  });
  page.on("pageerror", (err) => {
    results.push({
      kind: "pageerror",
      url: page.url(),
      text: String(err?.message || err),
    });
  });

  for (const p of PUBLIC_PATHS) {
    await visit(page, p);
  }

  await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });
  await runAxeScan(page, "home-public", "/");

  if (!SKIP_AUTH) {
    for (const p of AUTH_PATHS_ANON) {
      await visit(page, p);
    }
    await login(page);
    await assertMissionDashboard(page);

    await runAxeScan(page, "mission-control-authed", "/mission-control");

    for (const p of PROTECTED_PATHS.filter((x) => x !== "/mission-control")) {
      await visit(page, p);
    }
  } else {
    for (const p of [...AUTH_PATHS_ANON, ...PROTECTED_PATHS]) {
      await visit(page, p);
    }
  }

  await browser.close();

  const axeFailing = axeRuns.filter(
    (r) => r.failingUnderThreshold > 0 && !r.skipped && !r.error,
  );
  const axeErrored = axeRuns.some((r) => r.error);

  const summary = {
    base: BASE,
    apiOrigin: API_ORIGIN,
    skipAuth: SKIP_AUTH,
    skipAxe: SKIP_AXE,
    axeFailOn: AXE_FAIL_ON,
    assertions,
    axe: {
      runs: axeRuns,
      failingPagesUnderThreshold: axeFailing.length,
    },
    visited: results.filter((r) => r.kind === "nav").length,
    consoleErrors: results.filter((r) => r.kind === "console").length,
    pageErrors: results.filter((r) => r.kind === "pageerror").length,
    navFails: results.filter((r) => r.kind === "nav_fail").length,
    rows: results,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!SKIP_AUTH && !assertions.missionControlShowsDashboard) {
    process.exit(1);
  }
  if (!SKIP_AXE && axeErrored) {
    process.exit(1);
  }
  if (!SKIP_AXE && axeFailing.length > 0) {
    console.error(
      `QA axe: ${axeFailing.length} scan(s) have violations at or above "${AXE_FAIL_ON}" (set QA_AXE_FAIL_ON=none to only report).`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
