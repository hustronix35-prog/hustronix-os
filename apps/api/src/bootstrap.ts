import { setAgentMessageHandler } from "./server.js";
import { runAgent } from "./agent.js";
import { runAssistantAgent } from "./assistant-agent.js";
import { isAssistantSession } from "./assistant-guide.js";
import { db } from "./database.js";
import { config } from "./config.js";
import cron from "node-cron";
import { auditor } from "./auditor.js";
import { onLedgerEventForState, rebuildOrganizationState } from "./state/organization-state.js";
import { executionIntelligence } from "./execution-intelligence/index.js";
import { v4 as uuidv4 } from "uuid";
import { hashPassword } from "./auth/password.js";
import { reprocessUnenrichedSignals } from "./intelligence/index.js";
import { runCompressionForAllTenants } from "./state/memory-compression.js";

/** DB seed, agent WS handler, auditor cron, demo data — everything except HTTP listen. */
export function initializeCore() {
  console.log("🚀 Initializing Hustronix OS (10/10 Decision Core)...");
  if (config.server.isProduction && config.storage.databaseType === "postgres") {
    throw new Error(
      "DATABASE_TYPE=postgres is not supported in production until the async repository cutover completes (Phase 6). Use sqlite or finish the Postgres migration.",
    );
  }
  if (config.storage.databaseType === "postgres") {
    console.warn(
      "⚠️ DATABASE_TYPE=postgres schema support is installed, but the runtime still uses the synchronous SQLite adapter. Complete the async repository cutover before serving production traffic from Postgres.",
    );
  }

  db.setLedgerAuditorHook((ctx) => {
    auditor.onWrite(ctx);
    executionIntelligence.onLedgerEvent(ctx);
    onLedgerEventForState(ctx);
  });

  const orgBackfill = db.backfillOrgIds();
  if (orgBackfill.decisions + orgBackfill.executions + orgBackfill.signals > 0) {
    console.log(
      `🏢 [Tenant] Backfilled org_id on ${orgBackfill.decisions} decisions, ${orgBackfill.executions} executions, ${orgBackfill.signals} signals.`,
    );
  }

  if (!db.getUser("system")) {
    db.createUser("system", "system", hashPassword(uuidv4() + uuidv4()));
  }

  /**
   * Backfill FTS5 after listen. Skips when the mirror is already populated so
   * tsx watch restarts do not lock SQLite and block sign-in.
   */
  setImmediate(() => {
    try {
      const result = db.rebuildFtsFromLedger() as { skipped?: boolean } | void;
      if (result && result.skipped) {
        console.log("📚 [Intelligence] FTS5 mirror already populated; skipped full rebuild.");
      } else {
        console.log("📚 [Intelligence] FTS5 mirror backfilled from ledger.");
      }
    } catch (e) {
      console.warn("⚠️ [Intelligence] FTS backfill failed (search will be partial):", e);
    }
  });

  setAgentMessageHandler(async (userId, text, sessionId, reply, options) => {
    if (isAssistantSession(sessionId)) {
      await runAssistantAgent(userId, text, sessionId, reply, { authKind: options?.authKind });
      return;
    }
    await runAgent(userId, text, undefined, sessionId, reply, {
      planMode: options?.planMode,
      consoleMode: options?.consoleMode,
      authKind: options?.authKind,
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

  console.log("🗜️ Scheduling weekly memory compression (Sun 03:00)...");
  cron.schedule("0 3 * * 0", () => {
    console.log("🗜️ [Compression] Running weekly memory compression...");
    try {
      const stats = runCompressionForAllTenants();
      console.log(`🗜️ [Compression] Done: ${JSON.stringify(stats)}`);
    } catch (e) {
      console.error("🗜️ [Compression] Failed:", e);
    }
  });

  console.log("🔄 Scheduling nightly organization state reconcile (04:00)...");
  cron.schedule("0 4 * * *", () => {
    console.log("🔄 [State] Running nightly organization state rebuild...");
    try {
      const tenants = db.rawGet(
        `SELECT id, owner_user_id FROM organizations`,
      ) as { id: string; owner_user_id: string }[];
      let rebuilt = 0;
      for (const row of tenants) {
        if (!row.id || !row.owner_user_id) continue;
        try {
          rebuildOrganizationState(row.id, row.owner_user_id);
          rebuilt++;
        } catch (e) {
          console.warn(`🔄 [State] Rebuild failed for org=${row.id}:`, e);
        }
      }
      console.log(`🔄 [State] Nightly reconcile complete (${rebuilt} tenants).`);
    } catch (e) {
      console.error("🔄 [State] Nightly reconcile failed:", e);
    }
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
