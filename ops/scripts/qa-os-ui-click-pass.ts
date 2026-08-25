/**
 * Authenticated os-ui click pass. Inventories every visible control, then
 * exercises only **safe** product buttons (search, settings save, honest-disabled).
 * Does not click Commit / Execute / Complete / Reverse / Kill on the live ledger.
 *
 *   npm run qa:os-ui-click
 *
 * Prereq: `npm run dev` (UI :3000, API :3005)
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import puppeteer, { type Page } from "puppeteer";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "data", "os-ui-click-pass.json");
const MD = path.join(ROOT, "data", "os-ui-click-pass.md");

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const QA_USER = process.env.QA_USERNAME || "hustronix-qa-automation@example.test";
const QA_LOGIN = QA_USER.includes("@") ? QA_USER : `${QA_USER}@example.test`;
const QA_PASS = process.env.QA_PASSWORD || "DemoCheck2026!";

const ROUTES = [
  "/",
  "/chat",
  "/signals",
  "/brain",
  "/brain/projects",
  "/brain/people",
  "/brain/documents",
  "/decide",
  "/execute",
  "/team",
  "/analytics",
  "/alerts",
  "/settings",
  "/settings/profile",
  "/settings/general",
  "/settings/notifications",
  "/settings/security",
  "/help",
];

type Inventory = {
  route: string;
  url: string;
  title: string;
  loginRedirect: boolean;
  buttons: Array<{ label: string; disabled: boolean; title: string; href: string }>;
};

type Probe = { name: string; ok: boolean; detail: string };

const inventory: Inventory[] = [];
const probes: Probe[] = [];
const pageErrors: string[] = [];

function ensureQaUser() {
  const hash = hashPassword(QA_PASS);
  let userId = db.findUserIdByEmail(QA_LOGIN);
  if (userId) {
    db.updateUserPasswordHash(userId, hash);
  } else {
    userId = crypto.randomUUID();
    db.createUser(userId, QA_LOGIN, hash, QA_LOGIN);
    db.updateSetting(userId, "profile.email", QA_LOGIN);
  }
  db.updateSetting(userId, "org.owner_user_id", userId);
  db.updateSetting(userId, "org.role", "Owner");
  db.updateSetting(userId, "org.onboarding.completed", "1");
  return userId;
}

async function waitFor(url: string, label: string) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} not reachable: ${url}`);
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
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
      const j = JSON.parse(text) as { userId?: string };
      if (j.userId) localStorage.setItem("hustronix_userId", j.userId);
    } catch {
      /* ignore */
    }
    return null;
  }, [QA_LOGIN, QA_PASS]);
  if (loginErr) throw new Error(`Login API: ${loginErr}`);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (page.url().includes("/login")) {
    throw new Error("Session cookie not accepted — still on /login");
  }
  probes.push({ name: "login session", ok: true, detail: page.url() });
}

async function scanRoute(page: Page, route: string) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 500));
  const loginRedirect = page.url().includes("/login");
  const snap = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("button, a[href], [role='button']"));
    return {
      title: document.title,
      buttons: nodes.slice(0, 120).map((n) => {
        const el = n as HTMLElement;
        return {
          label: (
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            (el as HTMLElement).innerText ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
          disabled: Boolean((el as HTMLButtonElement).disabled) || el.getAttribute("aria-disabled") === "true",
          title: el.getAttribute("title") || "",
          href: el.getAttribute("href") || "",
        };
      }),
    };
  });
  inventory.push({
    route,
    url: page.url(),
    title: snap.title,
    loginRedirect,
    buttons: snap.buttons.filter((b) => b.label),
  });
}

async function probeSearch(page: Page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });
  const typed = await page.evaluate(() => {
    const input = document.querySelector("header input, form.search input, [class*='search'] input") as HTMLInputElement | null;
    if (!input) return false;
    input.focus();
    input.value = "capacity risk this week";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const form = input.closest("form");
    if (form) form.requestSubmit();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  });
  await new Promise((r) => setTimeout(r, 1200));
  const url = page.url();
  const ok = typed && /\/chat/.test(url) && /capacity/.test(decodeURIComponent(url));
  probes.push({
    name: "global search → Talk",
    ok,
    detail: typed ? url : "search input not found",
  });
}

async function probeSave(page: Page, route: string, name: string, expectText: RegExp) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 700));
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      /save changes|saving/i.test(b.textContent || ""),
    );
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 1500));
  const body = await page.evaluate(() => document.body.innerText);
  const fake = /saved locally/i.test(body);
  const ok = clicked && expectText.test(body) && !fake;
  probes.push({
    name,
    ok,
    detail: !clicked ? "Save button missing/disabled" : fake ? "still says Saved locally" : body.match(/Saved[^\n]{0,40}/)?.[0] || body.slice(0, 120),
  });
}

async function probeDisabled(page: Page, route: string, name: string, match: RegExp) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, route.includes("/chat") ? 1800 : 600));
  const hit = await page.evaluate((src) => {
    const re = new RegExp(src, "i");
    const nodes = Array.from(document.querySelectorAll("button"));
    const el = nodes.find((b) =>
      re.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`),
    );
    if (!el) return { found: false, disabled: false, title: "" };
    return {
      found: true,
      disabled: Boolean(el.disabled),
      title: el.getAttribute("title") || "",
    };
  }, match.source);
  probes.push({
    name,
    ok: hit.found && hit.disabled,
    detail: !hit.found ? "control not found" : hit.disabled ? hit.title || "disabled" : "ENABLED but should be disabled",
  });
}

async function probeProfileRoundTrip(page: Page) {
  const marker = `QA ${Date.now()}`;
  await page.goto(`${BASE}/settings/profile`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate((name) => {
    const input = document.getElementById("full-name") as HTMLInputElement | null;
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, marker);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /save changes/i.test(b.textContent || ""));
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 1600));
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 800));
  const value = await page.evaluate(() => (document.getElementById("full-name") as HTMLInputElement | null)?.value || "");
  probes.push({
    name: "profile save round-trip",
    ok: value === marker,
    detail: `reload value=${JSON.stringify(value)} expected=${JSON.stringify(marker)}`,
  });
}

async function main() {
  ensureQaUser();
  await waitFor("http://127.0.0.1:3005/api/health", "API");
  await waitFor(`${BASE}/login`, "UI");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (err) => pageErrors.push(`${err.message}`));

  await login(page);
  for (const route of ROUTES) {
    try {
      await scanRoute(page, route);
    } catch (e) {
      inventory.push({
        route,
        url: "",
        title: "",
        loginRedirect: false,
        buttons: [],
      });
      probes.push({
        name: `scan ${route}`,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await probeSearch(page);
  await probeSave(page, "/settings/general", "general settings save", /saved to your workspace/i);
  await probeSave(page, "/settings/notifications", "notifications save", /saved to your account/i);
  await probeProfileRoundTrip(page);
  await probeDisabled(page, "/chat?q=__qa_attach", "chat attach disabled", /attach file|add attachment/);
  await probeDisabled(page, "/settings/profile", "change photo disabled", /change photo/);

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    probes,
    pageErrors: pageErrors.slice(0, 40),
    inventory,
    buttonCounts: inventory.map((i) => ({
      route: i.route,
      loginRedirect: i.loginRedirect,
      buttons: i.buttons.length,
      disabled: i.buttons.filter((b) => b.disabled).length,
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const md = [
    `# os-ui click pass`,
    ``,
    `Generated: ${report.generatedAt}`,
    ``,
    `## Probes`,
    ``,
    ...probes.map((p) => `- ${p.ok ? "PASS" : "FAIL"} **${p.name}**: ${p.detail}`),
    ``,
    `## Routes`,
    ``,
    ...report.buttonCounts.map(
      (r) => `- \`${r.route}\` · ${r.buttons} controls · ${r.disabled} disabled${r.loginRedirect ? " · LOGIN REDIRECT" : ""}`,
    ),
    ``,
    `## Page errors`,
    ``,
    ...(pageErrors.length ? pageErrors.map((e) => `- ${e}`) : ["- none"]),
  ].join("\n");
  fs.writeFileSync(MD, md);
  console.log(md);
  const failed = probes.filter((p) => !p.ok);
  if (failed.length) {
    console.error(`\n${failed.length} probe(s) failed`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
