import { setAgentMessageHandler } from "./server.js";
import { runAgent } from "./agent.js";
import { db } from "./database.js";
import { config } from "./config.js";
import cron from "node-cron";
import { auditor } from "./auditor.js";
import { v4 as uuidv4 } from "uuid";
import { hashPassword } from "./auth/password.js";

/** DB seed, agent WS handler, auditor cron, demo data — everything except HTTP listen. */
export function initializeCore() {
  console.clear();
  console.log("🚀 Initializing Hustronix OS (10/10 Decision Core)...");

  db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

  if (!db.getUser("system")) {
    db.createUser("system", "system", hashPassword(uuidv4() + uuidv4()));
  }

  setAgentMessageHandler(async (userId, text, sessionId, reply) => {
    await runAgent(userId, text, undefined, sessionId, reply);
  });

  const activeModel =
    config.agent.activeProvider === "anthropic"
      ? config.anthropic.primaryModel
      : config.openai.llmModel;

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
