import { setAgentMessageHandler } from "./server.js";
import { runAgent } from "./agent.js";
import { runAssistantAgent } from "./assistant-agent.js";
import { isAssistantSession } from "./assistant-guide.js";
import { db } from "./database.js";
import { config } from "./config.js";
import cron from "node-cron";
import { auditor } from "./auditor.js";
import { v4 as uuidv4 } from "uuid";
import { hashPassword } from "./auth/password.js";
import { reprocessUnenrichedSignals } from "./intelligence/index.js";

/** DB seed, agent WS handler, auditor cron, demo data — everything except HTTP listen. */
export function initializeCore() {
  console.clear();
  console.log("🚀 Initializing Hustronix OS (10/10 Decision Core)...");
  if (config.storage.databaseType === "postgres") {
    console.warn(
      "⚠️ DATABASE_TYPE=postgres schema support is installed, but the runtime still uses the synchronous SQLite adapter. Complete the async repository cutover before serving production traffic from Postgres.",
    );
  }

  db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

  if (!db.getUser("system")) {
    db.createUser("system", "system", hashPassword(uuidv4() + uuidv4()));
  }

  /**
   * Backfill FTS5 mirror tables once on startup. Cheap (a few thousand rows for
   * a typical tenant) and safe to re-run — `rebuildFtsFromLedger` truncates
   * before re-populating. Required so hybrid retrieval works against historical
   * rows that pre-date the intelligence schema migration.
   */
  try {
    db.rebuildFtsFromLedger();
    console.log("📚 [Intelligence] FTS5 mirror backfilled from ledger.");
  } catch (e) {
    console.warn("⚠️ [Intelligence] FTS backfill failed (search will be partial):", e);
  }

  setAgentMessageHandler(async (userId, text, sessionId, reply, options) => {
    if (isAssistantSession(sessionId)) {
      await runAssistantAgent(userId, text, sessionId, reply);
      return;
    }
    await runAgent(userId, text, undefined, sessionId, reply, {
      planMode: options?.planMode,
    });
  });

  const activeModel =
    config.agent.activeProvider === "anthropic"
      ? `${config.anthropic.premiumModel} (batch: ${config.anthropic.fastModel})`
      : config.openai.llmModel;

  if (config.agent.costSaverEnabled) {
    console.log("💰 LLM cost-saver defaults active (set LLM_COST_SAVER=0 for legacy caps).");
  }

  console.log(`
┌───────────────────────────────────────────┐
│        🛡️ Hustronix Decision OS Core      │
│   10/10 Investable Infrastructure Layer   │
├───────────────────────────────────────────┤
│  DB: Active (Decision Ledger 10/10)       │
│  LLM: ${activeModel.length > 44 ? `${activeModel.slice(0, 44)}…` : activeModel}
│  Slack: Events API → signals (optional OAuth) │
└───────────────────────────────────────────┘
  `);

  console.log("🛡️ Initializing Auditor Engine (Cron: Every 5m)...");
  cron.schedule("*/5 * * * *", () => {
    console.log("🕵️ [Auditor] Running reality evaluation sweep...");
    auditor.evaluateAll();
    /**
     * Drift sweep — picks up signals that bypassed the event-driven path (e.g.
     * the LLM was unreachable when they came in) and re-runs the deterministic
     * detector. Heuristic-only: cron is for reconciliation, not primary
     * enforcement, so we never spend LLM tokens here.
     */
    void reprocessUnenrichedSignals("system", 100).then((n) => {
      if (n > 0) console.log(`🧠 [Intelligence] Drift sweep enriched ${n} stale signals.`);
    });
  });

  const existingExecs = db.rawGet("SELECT count(*) as count FROM execution_ledger");
  if (existingExecs[0].count === 0) {
    console.log("🌱 Seeding initial operational data...");
    db.saveDecisionEvent("system", {
      vow: "Optimize Conversion for Series B Landing Page",
      expected_outcomes: [
        { metric: "CVR", target: "+5%" },
        { metric: "Friction Score", target: "-10%" },
      ],
      constraints: [
        "Do not change pricing structure",
        "No modifications to the core logo",
      ],
      confidence: 0.85,
      tasks: [
        { type: "ACTION", weight: 1.5, owner: "system" },
        { type: "ACTION", weight: 1.0, owner: "system" },
      ],
    });

    const s1 = uuidv4();
    const s2 = uuidv4();
    const ago30m = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const ago2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    db.insertExternalSignal({
      id: s1,
      userId: "system",
      source: "SLACK",
      content: "Mentioned a new pricing experiment in #growth",
      owner: "system",
      detectedAt: ago30m,
    });
    db.insertExternalSignal({
      id: s2,
      userId: "system",
      source: "GITHUB",
      content: "PR-12: Added experimental checkout flow",
      owner: "system",
      detectedAt: ago2h,
    });
  }

  auditor.evaluateAll();
}

export function logHttpListening(port: number, label: string) {
  console.log(`🌐 [${label}] http://127.0.0.1:${port}`);
}
