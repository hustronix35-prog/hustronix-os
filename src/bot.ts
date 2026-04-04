import { Bot, InputFile, Context } from "grammy";
import { config } from "./config.js";
import { runAgentLoop, pruneWorkingMemoryIfNeeded, forceCompactMemory } from "./agent.js";

export const bot = new Bot(config.telegram.botToken);

// ── Security Middleware ──────────────────────────────────
// Silently ignore ALL messages from non-whitelisted users.
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !config.security.allowedUserIds.includes(userId)) {
    return; // silent ignore
  }
  await next();
});

import { transcribeAudio, generateSpeech } from "./audio.js";
import { saveMessage } from "./memory.js";
import { saveSemanticMemory } from "./semantic.js";

/**
 * Handles sending the agent's reply to Telegram.
 * If the reply contains <voice> tags, it generates speech and sends an audio message,
 * along with any remaining text.
 */
async function sendAgentReply(ctx: Context, reply: string) {
  if (reply.length === 0) {
    await ctx.reply("I processed your request but have nothing to say.");
    return;
  }

  // Parse <voice> tags
  const voiceRegex = /<voice>([\s\S]*?)<\/voice>/i;
  let textToSend = reply;
  let textToSpeak = "";

  const match = reply.match(voiceRegex);
  if (match) {
    textToSpeak = match[1].trim();
    // Remove the voice tag from the text response
    textToSend = reply.replace(voiceRegex, "").trim();
  }

  // 1. Send text chunks if there's any text left (or if there's no voice tag)
  if (textToSend.length > 0) {
    const chunks = splitMessage(textToSend, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(async () => {
        await ctx.reply(chunk);
      });
    }
  }

  // 2. Send voice message if requested
  if (textToSpeak.length > 0) {
    await ctx.replyWithChatAction("record_voice");
    try {
      const audioBuffer = await generateSpeech(textToSpeak);
      // Create a Node Buffer from the ArrayBuffer for grammY's InputFile
      const buffer = Buffer.from(audioBuffer);
      await ctx.replyWithVoice(new InputFile(buffer, "voice.mp3"));
    } catch (err: unknown) {
      console.error("❌ TTS error:", err);
      // Fallback: just send the text that was meant to be spoken
      await ctx.reply(`🎙️ *(Speech synthesis failed)*\n${textToSpeak}`, { parse_mode: "Markdown" });
    }
  }

  console.log(`🤖 Gravity Claw: ${reply.slice(0, 120)}${reply.length > 120 ? "..." : ""}`);
}

// ── Slash Commands ───────────────────────────────────────

import { clearWorkingMemory, getUsageStats } from "./memory.js";
import { setActiveModel, getActiveModelInfo } from "./llm.js";

bot.command(["start", "help"], async (ctx) => {
  await ctx.reply(
    "🦀 *Gravity Claw*\n\n" +
    "I am your personal AI companion. Send me text or voice messages.\n\n" +
    "*/new* - Start a fresh conversation\n" +
    "*/status* - Check agent status\n" +
    "*/usage* - View token usage\n" +
    "*/model* - Swap LLM provider\n" +
    "*/compact* - Compress working memory into a summary",
    { parse_mode: "Markdown" }
  );
});

bot.command("new", async (ctx) => {
  clearWorkingMemory();
  await ctx.reply("🧹 Working memory cleared. We are starting fresh.");
});

bot.command("status", async (ctx) => {
  const active = getActiveModelInfo();
  await ctx.reply(`🟢 *Status:* Online\n🧠 *Brain:* ${active.provider}^${active.modelId}`, { parse_mode: "Markdown" });
});

bot.command("model", async (ctx) => {
  const args = ctx.match.split(" ");
  if (args.length < 2 || !args[0] || !args[1]) {
    return ctx.reply("⚠️ Format: `/model <provider> <model_id>`\nExample: `/model groq llama3-8b-8192`", { parse_mode: "Markdown" });
  }

  const [provider, modelId] = args;
  
  try {
    setActiveModel(provider, modelId);
    await ctx.reply(`🧠 Brain hot-swapped!\n\nProvider: *${provider}*\nModel: *${modelId}*`, { parse_mode: "Markdown" });
  } catch (err: any) {
    await ctx.reply(`❌ Failed to swap model: ${err.message}`);
  }
});

bot.command("usage", async (ctx) => {
  const stats = getUsageStats();
  const totalTokens = stats.total_prompt + stats.total_completion;
  const avgLatency = stats.avg_latency > 0 ? `${Math.round(stats.avg_latency)}ms` : "N/A";
  
  await ctx.reply(
    `📊 *Usage Statistics*\n\n` +
    `*Calls:* ${stats.total_calls}\n` +
    `*Tokens:* ${totalTokens.toLocaleString()} (${stats.total_prompt.toLocaleString()} IN / ${stats.total_completion.toLocaleString()} OUT)\n` +
    `*Avg Latency:* ${avgLatency}`,
    { parse_mode: "Markdown" }
  );
});

bot.command("research", async (ctx) => {
  const niche = ctx.match.trim() || "early-stage AI startups";
  const userName = ctx.from?.first_name ?? "User";
  
  console.log(`\n🔍 ${userName} triggered autonomous research for: ${niche}`);
  await ctx.reply(`🔍 *Starting autonomous research for:* "${niche}"\n\nI will search, audit, and log new leads to the spreadsheet. This may take a few minutes...`, { parse_mode: "Markdown" });
  await ctx.replyWithChatAction("typing");

  const instruction = `RESEARCH TASK: Find 5 new early-stage (Seed/Series A) startups in the niche: "${niche}". 
  For each:
  - Find the Founder/CEO name and LinkedIn.
  - Audit their website for UI/UX and funnel problems.
  - Log the result to leads.csv.
  Once done, provide a summary of the new leads found.`;

  try {
    const reply = await runAgentLoop(instruction);
    await sendAgentReply(ctx, `✅ *Research Complete for "${niche}"*\n\n${reply}`);
  } catch (err: any) {
    console.error("❌ Research Command Error:", err);
    await ctx.reply(`❌ Research failed: ${err.message}`);
  }
});

bot.command("compact", async (ctx) => {
  const statusMsg = await ctx.reply("🧹 Compacting working memory...");
  try {
    const compacted = await forceCompactMemory();
    if (compacted > 0) {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `✅ Compacted ${compacted} messages into a dense summary!`);
    } else {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⚠️ Working memory is already empty.`);
    }
  } catch (err: any) {
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `❌ Compaction failed: ${err.message}`);
  }
});

// ── Message Handler ──────────────────────────────────────
bot.on("message:text", async (ctx) => {
  const userMessage = ctx.message.text;
  const userName = ctx.from.first_name ?? "User";

  console.log(`\n💬 ${userName}: ${userMessage}`);
  await ctx.replyWithChatAction("typing");

  saveMessage("user", userMessage);

  try {
    const reply = await runAgentLoop(userMessage);
    saveMessage("assistant", reply);
    
    // Fire-and-forget semantic memory saving and pruning
    Promise.all([
      saveSemanticMemory(`User: ${userMessage}\nGravity Claw: ${reply}`).catch(err => console.error("❌ Semantic DB:", err)),
      pruneWorkingMemoryIfNeeded().catch(err => console.error("❌ Pruning:", err))
    ]);

    await sendAgentReply(ctx, reply);
  } catch (err: unknown) {
    console.error("❌ Agent error:", err);
    
    // Check for rate-limit 429 errors
    const status = (err as any)?.status || (err as any)?.response?.status;
    if (status === 429) {
      await ctx.reply("⏳ I'm being rate-limited by the AI provider. Please wait a moment and try again.");
      return;
    }
    
    const errMsg = err instanceof Error ? err.message : String(err);
    const shortErr = errMsg.length > 300 ? errMsg.slice(0, 300) + "..." : errMsg;
    await ctx.reply(`⚠️ Error: ${shortErr}`);
  }
});

bot.on("message:voice", async (ctx) => {
  const userName = ctx.from.first_name ?? "User";
  console.log(`\n🎙️ ${userName} sent a voice message.`);

  const statusMsg = await ctx.reply("🎙️ _Listening..._", { parse_mode: "Markdown" });

  try {
    const fileId = ctx.message.voice.file_id;
    // 1. Get file download link
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

    // 2. Transcribe using Groq Whisper
    const transcript = await transcribeAudio(fileUrl, fileId);
    
    // Update the listening message with what we heard
    await ctx.api.editMessageText(
      ctx.chat.id, 
      statusMsg.message_id, 
      `🎙️ *I heard:* "${transcript}"`, 
      { parse_mode: "Markdown" }
    );

    console.log(`   📝 Transcript: ${transcript}`);

    // Show "typing..." while the agent thinks about the transcript
    await ctx.replyWithChatAction("typing");

    saveMessage("user", transcript);

    // 3. Feed the transcript to the agent loop
    const reply = await runAgentLoop(transcript);
    saveMessage("assistant", reply);
    
    Promise.all([
      saveSemanticMemory(`User: ${transcript}\nGravity Claw: ${reply}`).catch(err => console.error("❌ Semantic DB:", err)),
      pruneWorkingMemoryIfNeeded().catch(err => console.error("❌ Pruning:", err))
    ]);

    // Use Text-To-Speech to reply with audio
    await ctx.api.editMessageText(
      ctx.chat.id, 
      statusMsg.message_id, 
      `👄 _Synthesizing voice..._`,
      { parse_mode: "Markdown" }
    );
    const audioBuffer = await generateSpeech(reply);
    
    // Send voice reply
    await ctx.replyWithVoice(new InputFile(audioBuffer, "bot_response.mp3"));

    // Cleanup ephemeral status msg
    await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
  } catch (err: unknown) {
    console.error("❌ Voice agent error:", err);
    await ctx.api.editMessageText(
      ctx.chat.id, 
      statusMsg.message_id, 
      `⚠️ *Voice Error:* Could not process audio.`,
      { parse_mode: "Markdown" }
    );
  }
});

// ==== PHOTO MESSAGE HANDLER ====
bot.on("message:photo", async (ctx) => {
  const userId = ctx.from.id;
  if (!config.security.allowedUserIds.includes(userId)) {
    console.log(`[Auth] Blocked photo from user: ${userId}`);
    return;
  }

  try {
    const photoList = ctx.message.photo;
    if (!photoList || photoList.length === 0) return;

    // Grab the highest resolution photo (the last one in the array)
    const photo = photoList[photoList.length - 1];
    const file = await ctx.api.getFile(photo.file_id);

    if (!file.file_path) {
      await ctx.reply("❌ Sorry, I couldn't access that photo.");
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
    
    // Download binary and convert to base64
    const statusMsg = await ctx.reply("👁️ _Looking at the image..._", { parse_mode: "Markdown" });
    
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error("Failed to download image from Telegram");
    
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUri = `data:image/jpeg;base64,${base64}`;

    const caption = ctx.message.caption || "Describe this image.";
    console.log(`\n👁️ Received Photo. Caption: "${caption}"`);

    // Save prompt context to db (text only)
    saveMessage("user", caption);

    // Provide the ephemeral base64 array payload for this specific turn
    const reply = await runAgentLoop(caption, dataUri);

    saveMessage("assistant", reply);
    
    Promise.all([
      saveSemanticMemory(`User sent photo with caption: ${caption}\nGravity Claw: ${reply}`).catch(err => console.error("❌ Semantic DB:", err)),
      pruneWorkingMemoryIfNeeded().catch(err => console.error("❌ Pruning:", err))
    ]);

    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, reply);
  } catch (err) {
    console.error("Photo processing error:", err);
    await ctx.reply("❌ Failed to process that image.");
  }
});

/**
 * Split a long message into chunks that fit Telegram's limit.
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Fall back to splitting at a space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
