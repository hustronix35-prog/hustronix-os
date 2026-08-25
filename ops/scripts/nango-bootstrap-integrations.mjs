#!/usr/bin/env node
/**
 * Bootstrap Nango OAuth integrations from the Hustronix catalog.
 *
 * Usage:
 *   node ops/scripts/nango-bootstrap-integrations.mjs           # featured only
 *   node ops/scripts/nango-bootstrap-integrations.mjs --all     # all OAuth providers
 *
 * Requires NANGO_SECRET_KEY or NANGO_API_KEY in the environment (or repo .env).
 *
 * Nango's create-integration API requires OAuth client_id/secret. We:
 *   1. Prefer real credentials from .env when mapped for a provider
 *   2. Otherwise use placeholders so the integration exists; turn on
 *      "Nango credentials" (shared app) in the Nango dashboard for that
 *      integration before end-users authorize (or paste your own OAuth app).
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function loadEnv() {
  const envPath = resolve(repoRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnv();

const secret =
  process.env.NANGO_SECRET_KEY?.trim() || process.env.NANGO_API_KEY?.trim();
if (!secret) {
  console.error(
    "Missing NANGO_SECRET_KEY. Sign up at https://app.nango.dev/signup and paste the API key into .env",
  );
  process.exit(1);
}

const require = createRequire(resolve(repoRoot, "package.json"));
const { Nango } = require("@nangohq/node");

const all = process.argv.includes("--all");
const catalogPath = resolve(
  repoRoot,
  "apps/api/src/integrations/nango",
  all ? "oauth-providers.catalog.json" : "oauth-providers.featured.json",
);
const catalog = JSON.parse(
  readFileSync(catalogPath, "utf8").replace(/^\uFEFF/, ""),
);
const host = process.env.NANGO_HOST?.trim() || undefined;
const nango = new Nango(host ? { secretKey: secret, host } : { secretKey: secret });

/** Map Nango provider slug → env vars for a real OAuth app when available. */
function credentialsFor(slug) {
  const pairs = [
    {
      match: /^(google|google-mail|google-drive|google-calendar|gmail|outlook)$/,
      id:
        process.env.GOOGLE_OAUTH_CLIENT_ID ||
        process.env.GOOGLE_CLIENT_ID,
      secret:
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
        process.env.GOOGLE_CLIENT_SECRET,
      scopes: "openid,email,profile",
    },
    {
      match: /^slack$/,
      id: process.env.SLACK_CLIENT_ID || process.env.SLACK_OAUTH_CLIENT_ID,
      secret:
        process.env.SLACK_CLIENT_SECRET || process.env.SLACK_OAUTH_CLIENT_SECRET,
    },
    {
      match: /^github$/,
      id:
        process.env.GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID,
      secret:
        process.env.GITHUB_OAUTH_CLIENT_SECRET ||
        process.env.GITHUB_CLIENT_SECRET,
    },
    {
      match: /^(microsoft|microsoft-teams)$/,
      id: process.env.MICROSOFT_OAUTH_CLIENT_ID,
      secret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
    },
    {
      match: /^notion$/,
      id: process.env.NOTION_OAUTH_CLIENT_ID,
      secret: process.env.NOTION_OAUTH_CLIENT_SECRET,
    },
    {
      match: /^(jira|atlassian|confluence)$/,
      id: process.env.JIRA_OAUTH_CLIENT_ID || process.env.ATLASSIAN_CLIENT_ID,
      secret:
        process.env.JIRA_OAUTH_CLIENT_SECRET ||
        process.env.ATLASSIAN_CLIENT_SECRET,
    },
    {
      match: /^linear$/,
      id: process.env.LINEAR_OAUTH_CLIENT_ID,
      secret: process.env.LINEAR_OAUTH_CLIENT_SECRET,
    },
  ];

  for (const p of pairs) {
    if (p.match.test(slug) && p.id?.trim() && p.secret?.trim()) {
      const creds = {
        type: "OAUTH2",
        client_id: p.id.trim(),
        client_secret: p.secret.trim(),
      };
      if (p.scopes) creds.scopes = p.scopes;
      return { credentials: creds, source: "env" };
    }
  }

  // Placeholder so the integration row exists. Activate Nango shared credentials
  // (or paste a real OAuth app) in the dashboard before users connect.
  return {
    credentials: {
      type: "OAUTH2",
      client_id: "nango",
      client_secret: "nango",
    },
    source: "placeholder",
  };
}

let created = 0;
let exists = 0;
let failed = 0;
let placeholder = 0;
let fromEnv = 0;

console.log(
  `Bootstrapping ${catalog.length} Nango integration(s) (${all ? "all OAuth" : "featured"})…`,
);

for (const entry of catalog) {
  const uniqueKey = String(entry.slug).toLowerCase();
  try {
    try {
      await nango.getIntegration({ uniqueKey });
      exists += 1;
      console.log(`  exists  ${uniqueKey}`);
      continue;
    } catch {
      /* create */
    }

    // Prefer existing quickstart GitHub integration id when bootstrapping github
    if (uniqueKey === "github") {
      try {
        await nango.getIntegration({ uniqueKey: "github-getting-started" });
        exists += 1;
        console.log(`  exists  github-getting-started (use as github)`);
        continue;
      } catch {
        /* fall through and create github */
      }
    }

    const { credentials, source } = credentialsFor(uniqueKey);
    await nango.createIntegration({
      provider: entry.slug,
      unique_key: uniqueKey,
      display_name: entry.name,
      credentials,
    });
    created += 1;
    if (source === "placeholder") placeholder += 1;
    else fromEnv += 1;
    console.log(`  created ${uniqueKey} (${source})`);
  } catch (e) {
    failed += 1;
    console.error(`  error   ${uniqueKey}: ${e?.message || e}`);
  }
}

console.log(
  `Done. created=${created} (env=${fromEnv}, placeholder=${placeholder}) exists=${exists} failed=${failed}`,
);
if (placeholder) {
  console.log(
    `Note: ${placeholder} integration(s) used placeholder OAuth credentials.`,
  );
  console.log(
    `In https://app.nango.dev → Integrations, open each and enable Nango's shared developer app (or paste your own Client ID/Secret).`,
  );
  console.log(
    `Callback URL for your own apps: https://api.nango.dev/oauth/callback`,
  );
}
console.log(
  `Webhook (dashboard → Environment Settings): http://127.0.0.1:3005/api/nango/webhook`,
);
process.exit(failed ? 1 : 0);
