import { db } from "../database.js";

export const definition = {
  name: "remember_fact",
  description: "Store an important core fact about the user or your persona permanently. Use this when the user reveals something important about themselves (name, location, preferences) or explicitly asks you to remember something forever.",
  parameters: {
    type: "object",
    properties: {
      fact: {
        type: "string",
        description: "The piece of information to remember (e.g. 'User has a dog named Max')",
      },
      block: {
        type: "string",
        enum: ["user_profile", "persona"],
        description: "Which memory block to update. Usually 'user_profile'.",
      }
    },
    required: ["fact", "block"],
  },
};

export async function handler(input: Record<string, unknown>): Promise<string> {
  const { fact, block, userId } = input as { fact: string; block: string; userId: string };
  
  if (!fact || !block || !userId) {
    return "Error: Missing required parameters.";
  }

  const currentContent = db.getCoreMemory(userId, block);
  
  // Append as a new bullet point
  const newContent = currentContent 
    ? `${currentContent}\n- ${fact}`
    : `- ${fact}`;

  db.updateCoreMemory(userId, block, newContent);

  return `Core memory updated. Stored fact in [${block}]: "${fact}"`;
}
