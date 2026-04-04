import cron from "node-cron";
import { runProactiveAgentLoop } from "./agent.js";
import { bot } from "./bot.js";
import { config } from "./config.js";
import { saveMessage } from "./memory.js";

export function startScheduler() {
  console.log("⏰ Starting background scheduler...");

  // Evening Recap (Every day at 8:00 PM Server Time)
  // "0 20 * * *"
  cron.schedule("0 20 * * *", async () => {
    console.log("⏰ Triggering Evening Recap...");

    const instruction = "It's 8:00 PM. Review today's memory (use your recall tools if you want), summarize what we've done today, and write a concise, friendly evening recap for the user.";
    
    // We only support pushing proactive messages to the primary configured user for safety.
    const primaryUser = config.security.allowedUserIds[0];
    if (!primaryUser) return;

    try {
      const reply = await runProactiveAgentLoop(instruction);
      saveMessage("assistant", reply);
      
      await bot.api.sendMessage(primaryUser, reply, { parse_mode: "Markdown" }).catch(async () => {
        // Fallback if markdown parsing fails
        await bot.api.sendMessage(primaryUser, reply);
      });
      console.log("✅ Evening Recap sent.");
    } catch (err) {
      console.error("❌ Scheduled task failed:", err);
    }
  });

  // Weekly Lead Discovery (Every Monday at 9:00 AM)
  cron.schedule("0 9 * * 1", async () => {
    console.log("⏰ Triggering Weekly Lead Discovery...");

    const instruction = "Proactive Task: Find 3 new early-stage AI startups that we haven't researched yet. Audit their websites, log them to the spreadsheet, and prepare a summary report.";
    
    const primaryUser = config.security.allowedUserIds[0];
    if (!primaryUser) return;

    try {
      const reply = await runProactiveAgentLoop(instruction);
      saveMessage("assistant", reply);
      
      await bot.api.sendMessage(primaryUser, `📢 *Weekly Prospecting Report*\n\n${reply}`, { parse_mode: "Markdown" }).catch(async () => {
        await bot.api.sendMessage(primaryUser, `📢 Weekly Prospecting Report\n\n${reply}`);
      });
      console.log("✅ Weekly Lead Discovery complete.");
    } catch (err) {
      console.error("❌ Scheduled lead discovery failed:", err);
    }
  });
}
