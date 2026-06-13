"use strict";
const path = require("path");
const Database = require("better-sqlite3");
const root = path.resolve(__dirname, "..", "..");
require("dotenv").config({ path: path.join(root, ".env") });

const dbPath = process.env.SQLITE_PATH
  ? path.resolve(root, process.env.SQLITE_PATH)
  : path.join(root, "data", "hustronix.db");
const db = new Database(dbPath, { readonly: true });

const out = {
  env: {
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET ? "SET" : "unset",
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID ? "SET" : "unset",
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET ? "SET" : "unset",
    SLACK_REDIRECT_URI: process.env.SLACK_REDIRECT_URI || "(unset)",
    SLACK_BOT_SCOPES: process.env.SLACK_BOT_SCOPES || "(unset)",
    SLACK_INGEST_CHANNEL_ALLOWLIST: process.env.SLACK_INGEST_CHANNEL_ALLOWLIST || "(unset)",
    SLACK_INGEST_CHANNEL_DENYLIST: process.env.SLACK_INGEST_CHANNEL_DENYLIST || "(unset)",
  },
};

try {
  out.totalSignals = db.prepare("SELECT COUNT(*) AS n FROM external_signals").get().n;
} catch (e) { out.totalSignals = `err: ${e.message}`; }

try {
  out.signalsBySourceState = db
    .prepare("SELECT source, state, COUNT(*) AS n FROM external_signals GROUP BY source, state ORDER BY source, state")
    .all();
} catch (e) { out.signalsBySourceState = `err: ${e.message}`; }

try {
  out.slackInstalls = db
    .prepare(
      "SELECT id, user_id, external_team_id, external_team_name, scope, updated_at FROM oauth_connections WHERE provider='slack' ORDER BY updated_at DESC"
    )
    .all();
} catch (e) { out.slackInstalls = `err: ${e.message}`; }

try {
  out.slackEventReceipts = db.prepare("SELECT COUNT(*) AS n FROM slack_event_receipts").get().n;
} catch (e) { out.slackEventReceipts = `err: ${e.message}`; }

try {
  out.slackSignalLast5 = db
    .prepare(
      "SELECT id, user_id, state, owner, source_subtype, detected_at, substr(content,1,80) AS preview FROM external_signals WHERE source='SLACK' ORDER BY detected_at DESC LIMIT 5"
    )
    .all();
} catch (e) { out.slackSignalLast5 = `err: ${e.message}`; }

console.log(JSON.stringify(out, null, 2));
db.close();
