import { config } from "./config.js";
import { bot } from "./bot.js";
import { initMcpServers, shutdownMcpServers } from "./mcp.js";
import { startScheduler } from "./schedule.js";
import { startWebServer } from "./webserver.js";
import "./memory.js";
import "./semantic.js";

console.log("┌─────────────────────────────────────────┐");
console.log("│        🦀 Gravity Claw v1.0.0           │");
console.log("│   Lean • Secure • Fully Understood      │");
console.log("├─────────────────────────────────────────┤");
console.log(`│  Allowed users: ${config.security.allowedUserIds.join(", ").padEnd(23)}│`);
console.log(`│  Max iterations: ${String(config.agent.maxIterations).padEnd(22)}│`);
console.log(`│  Model: ${config.gemini.model.padEnd(31)}│`);
console.log(`│  Via: Google AI Studio                  │`);
console.log("└─────────────────────────────────────────┘");

// ── Graceful Shutdown ────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Shutting down...`);
  await shutdownMcpServers();
  bot.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Start Polling ────────────────────────────────────────
try {
  await initMcpServers();

  await bot.api.setMyCommands([
    { command: "new", description: "Start a fresh conversation" },
    { command: "status", description: "Check agent status" },
    { command: "usage", description: "View token usage" },
    { command: "model", description: "Swap LLM provider" },
    { command: "compact", description: "Compress working memory into a summary" },
    { command: "research", description: "Trigger autonomous lead research" },
  ]);

  // Start background cron jobs
  console.log("⏰ Booting internal cron scheduler...");
  startScheduler();

  // Start Express/WebSocket GUI
  console.log("🌎 Booting Express WebServer...");
  startWebServer();

  await Promise.all([
    bot.start({
      onStart: (botInfo) => {
        console.log(`🤖 Gravity Claw OS Boot Sequence Complete.`);
        console.log(`🦅 Telegram Uplink established: @${botInfo.username}`);
      },
      drop_pending_updates: true,
      allowed_updates: ["message", "callback_query"],
    }),
  ]);
} catch (err) {
  console.error("Failed to start bot:", err);
}
