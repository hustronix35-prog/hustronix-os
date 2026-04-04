import { searchSemanticMemory } from "../semantic.js";

export const definition = {
  name: "recall_memory",
  description: "Search your deep archival memory for past conversations or historical context. Use this if the user refers to past events that are not in your immediate context window.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to find relevant past conversations (e.g. 'project notes', 'user preferences')",
      },
    },
    required: ["query"],
  },
};

export async function handler(input: Record<string, unknown>): Promise<string> {
  const { query } = input as { query: string };
  
  if (!query) {
    return "Error: Missing required parameter 'query'.";
  }

  try {
    const results = await searchSemanticMemory(query, 5);
    
    if (results.length === 0) {
      return "No matching memories found in the archive.";
    }

    return `Retrieved from archival memory:\n\n${results.join("\n\n---\n\n")}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Failed to search memory: ${msg}`;
  }
}
