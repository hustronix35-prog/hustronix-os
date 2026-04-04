import { chat, type Message, summarizeContext } from "./llm.js";
import { executeTool } from "./tools/index.js";
import { config } from "./config.js";
import { 
  getWorkingMemory, 
  getWorkingMessageCount, 
  getOldestWorkingMessages, 
  deleteMessagesById, 
  getCoreMemoryBlock, 
  updateCoreMemoryBlock,
  saveMessage
} from "./memory.js";

/**
 * Run the agentic tool loop
 */
export async function runAgentLoop(userMessage: string, base64Image?: string): Promise<string> {
  const history = getWorkingMemory(config.agent.maxIterations * 2 + 10);
  const messages: Message[] = history.map(msg => ({ 
    role: msg.role as any, 
    content: msg.content || "", // Ensure content is NEVER null
    ...(msg.role === "assistant" && msg.tool_calls ? { tool_calls: JSON.parse(msg.tool_calls) } : {}),
    ...(msg.role === "tool" ? { tool_call_id: msg.tool_call_id } : {}),
  }));

  // Ephemeral Multimodal Injection
  if (base64Image) {
    const lastUserIndex = messages.map(m => m.role).lastIndexOf("user");
    if (lastUserIndex !== -1) {
      messages[lastUserIndex].content = [
        { type: "text", text: messages[lastUserIndex].content as string },
        { type: "image_url", image_url: { url: base64Image } }
      ] as any;
    }
  }

  try {
    for (let i = 0; i < config.agent.maxIterations; i++) {
      const response = await chat(messages);
      const choice = response.choices[0];

      if (!choice) {
        return "No response from the model.";
      }

      const { message, finish_reason } = choice;

      if (finish_reason === "stop" || !message.tool_calls?.length) {
        return message.content?.trim() ?? "I processed your request but have nothing to say.";
      }

      messages.push({
        role: "assistant",
        content: message.content || "",
        tool_calls: message.tool_calls,
      });
      saveMessage("assistant", message.content || "", message.tool_calls);

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        const rawArgs = toolCall.function.arguments || "{}";

        console.log(`  🔧 Tool call: ${toolName}(${rawArgs})`);
        const result = await executeTool(toolName, rawArgs);
        console.log(`  ✅ Result: ${result}`);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
        saveMessage("tool", result, null, toolCall.id);
      }
    }

    const finalResponse = await chat(messages);
    const finalChoice = finalResponse.choices[0];
    return finalChoice?.message?.content?.trim() ?? "Max iterations reached.";
  } catch (err: any) {
    console.error("❌ Agent Loop Error:", err);
    return `⚠️ Error: The agent loop encountered a problem processing your request. Details: ${err.message || String(err)}`;
  }
}

/**
 * Run the loop initiated by the system, not the user.
 * We manually inject a prompt instruction at the end of the SQLite working memory.
 */
export async function runProactiveAgentLoop(instruction: string): Promise<string> {
  const history = getWorkingMemory(config.agent.maxIterations * 2 + 10);
  const messages: Message[] = history.map(msg => ({ 
    role: msg.role as any, 
    content: msg.content,
    ...(msg.role === "assistant" && msg.tool_calls ? { tool_calls: JSON.parse(msg.tool_calls) } : {}),
    ...(msg.role === "tool" ? { tool_call_id: msg.tool_call_id } : {}),
  }));

  // Append silent instruction
  messages.push({
    role: "system",
    content: `[SYSTEM TRIGGER]: ${instruction}`
  });

  for (let i = 0; i < config.agent.maxIterations; i++) {
    const response = await chat(messages);
    const choice = response.choices[0];

    if (!choice) return "No response from the model.";

    const { message, finish_reason } = choice;

    if (finish_reason === "stop" || !message.tool_calls?.length) {
      return message.content?.trim() ?? "Nothing to report.";
    }

    messages.push({
      role: "assistant",
      content: message.content,
      tool_calls: message.tool_calls,
    });
    saveMessage("assistant", message.content, message.tool_calls);

    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      const rawArgs = toolCall.function.arguments || "{}";

      console.log(`  🔧 Tool call: ${toolName}(${rawArgs})`);
      const result = await executeTool(toolName, rawArgs);
      console.log(`  ✅ Result: ${result}`);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
      saveMessage("tool", result, null, toolCall.id);
    }
  }

  const finalResponse = await chat(messages);
  const finalChoice = finalResponse.choices[0];
  return finalChoice?.message?.content?.trim() ?? "Max iterations reached.";
}

export async function pruneWorkingMemoryIfNeeded() {
  const count = getWorkingMessageCount();
  if (count <= config.memory.maxWorkingMessages) return;

  const messagesToPrune = getOldestWorkingMessages(config.memory.pruneThreshold);
  if (messagesToPrune.length === 0) return;

  const existingSummary = getCoreMemoryBlock("conversation_summary");
  const formattedMessages = messagesToPrune.map(m => {
    let text = `[${m.role.toUpperCase()}]: ${m.content || ""}`;
    const anyM = m as any;
    if (anyM.tool_calls) text += ` (Called tools: ${anyM.tool_calls})`;
    return text;
  }).join("\n");

  const newSummary = await summarizeContext(existingSummary, formattedMessages);
  
  if (newSummary) {
    updateCoreMemoryBlock("conversation_summary", newSummary);
    deleteMessagesById(messagesToPrune.map(m => m.id));
    console.log(`🧹 Pruned ${messagesToPrune.length} messages from working memory.`);
  }
}

export async function forceCompactMemory() {
  const count = getWorkingMessageCount();
  if (count === 0) return 0;

  const messagesToPrune = getOldestWorkingMessages(count);
  const existingSummary = getCoreMemoryBlock("conversation_summary");
  const formattedMessages = messagesToPrune.map(m => {
    let text = `[${m.role.toUpperCase()}]: ${m.content || ""}`;
    const anyM = m as any;
    if (anyM.tool_calls) text += ` (Called tools: ${anyM.tool_calls})`;
    return text;
  }).join("\n");

  const newSummary = await summarizeContext(existingSummary, formattedMessages);
  
  if (newSummary) {
    updateCoreMemoryBlock("conversation_summary", newSummary);
    deleteMessagesById(messagesToPrune.map(m => m.id));
    return count;
  }
  return 0;
}
