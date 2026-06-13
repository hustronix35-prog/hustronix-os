#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

function rel(p) {
  return path.relative(root, p).replace(/\\/g, "/");
}

function read(p) {
  return readFileSync(path.join(root, p), "utf8");
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel(full);
    if (
      name === ".git" ||
      name === "node_modules" ||
      name === "dist" ||
      name === ".next" ||
      name === ".gstack" ||
      name === "scratch" ||
      name === "tmp" ||
      r.includes("/.next/") ||
      r.includes("/node_modules/") ||
      r.startsWith("ops/scripts/cache/")
    ) {
      continue;
    }
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function checkGitignore() {
  const gi = existsSync(path.join(root, ".gitignore")) ? read(".gitignore") : "";
  for (const pattern of [".env", ".env.*", "dist/", "node_modules/"]) {
    if (!gi.includes(pattern)) fail(`.gitignore is missing required pattern: ${pattern}`);
  }
  if (!gi.includes("!.env.example")) {
    warn(".gitignore does not explicitly allow .env.example as the only env template.");
  }
}

function checkApiRouteAuth() {
  const serverPath = "apps/api/src/server.ts";
  if (!existsSync(path.join(root, serverPath))) {
    fail("apps/api/src/server.ts not found; cannot verify API route protection.");
    return;
  }
  const lines = read(serverPath).split(/\r?\n/);
  const routeRe = /app\.(get|post|patch|delete|put)\(\s*["'`]([^"'`]+)["'`]/;
  const publicExact = new Set(["/api/health", "/api/auth/providers"]);
  const publicPrefixes = [
    "/api/auth/otp/request",
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/google/",
    "/api/auth/github/",
    "/api/oauth/slack/callback",
    "/api/integrations/slack/events",
    "/api/ingest/github",
    "/api/ingest/jira",
    "/api/ingest/crm",
  ];
  const protectedBySignature = ["/api/integrations/slack/events", "/api/ingest/github", "/api/ingest/jira", "/api/ingest/crm"];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(routeRe);
    if (!match) continue;
    const route = match[2];
    if (!route.startsWith("/api/")) continue;
    const chunk = lines.slice(i, Math.min(lines.length, i + 8)).join("\n");
    const isPublic =
      publicExact.has(route) || publicPrefixes.some((prefix) => route.startsWith(prefix));
    const hasAuth = chunk.includes("authMiddleware");
    const hasSignature = protectedBySignature.some((prefix) => route.startsWith(prefix));
    if (!isPublic && !hasAuth) {
      fail(`${serverPath}:${i + 1} ${route} is an API data route without authMiddleware.`);
    }
    if (hasSignature && hasAuth) {
      warn(`${serverPath}:${i + 1} ${route} has both webhook signature path and authMiddleware; verify provider can send auth.`);
    }
  }
}

function checkClientSecretExposure() {
  const uiSrc = path.join(root, "apps", "web", "src");
  if (!existsSync(uiSrc)) return;
  const files = walk(uiSrc).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
  const dangerousPublicEnv = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|TOKEN|PRIVATE|PASSWORD|ANTHROPIC|OPENAI|GEMINI|PINECONE)[A-Z0-9_]*/g;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const matches = [...text.matchAll(dangerousPublicEnv)].map((m) => m[0]);
    for (const envName of new Set(matches)) {
      fail(`${rel(file)} exposes secret-like env var to the browser: ${envName}`);
    }
  }
}

function checkCommittedSecretPatterns() {
  const files = walk(root).filter((file) => {
    const r = rel(file);
    if (r === "package-lock.json") return false;
    if (path.basename(r).startsWith(".env")) return false;
    if (r.endsWith(".db") || r.endsWith(".map") || r.endsWith(".png") || r.endsWith(".webp")) return false;
    if (r.endsWith(".env.example")) return false;
    return /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|toml|env|txt)$/.test(r);
  });
  const patterns = [
    { name: "OpenAI key", re: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
    { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{32,}/ },
    { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9_]{30,}/ },
    { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
    { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
    { name: "database URL with password", re: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/ },
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const { name, re } of patterns) {
      if (re.test(text)) fail(`${rel(file)} contains a likely ${name}. Rotate it if it was ever committed.`);
    }
  }
}

function checkServerOnlyKeyAccess() {
  const uiSrc = path.join(root, "apps", "web", "src");
  if (!existsSync(uiSrc)) return;
  const browserFiles = walk(uiSrc).filter((file) => {
    const r = rel(file);
    return /\.(ts|tsx|js|jsx)$/.test(r) && !r.includes("/app/api/");
  });
  const serverOnly = /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|PINECONE_API_KEY|MISSION_CONTROL_API_KEY|SLACK_CLIENT_SECRET|GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_SECRET)\b/;
  for (const file of browserFiles) {
    const text = readFileSync(file, "utf8");
    if (serverOnly.test(text)) fail(`${rel(file)} references a server-only secret name in browser-reachable code.`);
  }
}

checkGitignore();
checkApiRouteAuth();
checkClientSecretExposure();
checkCommittedSecretPatterns();
checkServerOnlyKeyAccess();

for (const message of warnings) console.warn(`WARN ${message}`);
if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  console.error(`\nSecurity launch check failed with ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("Security launch check passed.");
