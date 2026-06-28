import { db } from "../database.js";
import { resolveTenantContext } from "../security/tenant-context.js";

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

function escapeLikeQuery(q: string): string {
  return q.replace(/[%_\\]/g, "\\$&");
}

export async function handler(input: Record<string, unknown>): Promise<string> {
  const { query, userId } = input as { query: string; userId: string };

  if (!query || !userId) {
    return "Error: Missing required parameters.";
  }

  if (query.length > 200) {
    return "Error: Query too long.";
  }

  try {
    const ctx = resolveTenantContext(userId);
    const safeQuery = escapeLikeQuery(query.trim());
    const results = db.rawGet(
      `
      SELECT role, content, timestamp 
      FROM messages 
      WHERE user_id = ? AND content LIKE ? ESCAPE '\\'
      ORDER BY timestamp DESC 
      LIMIT 10
    `,
      [ctx.userId, `%${safeQuery}%`],
    );

    if (results.length === 0) {
      return "No matching memories found in the archive.";
    }

    const formatted = results
      .map((r: { timestamp: string; role: string; content: string }) =>
        `[${r.timestamp}] ${r.role.toUpperCase()}: ${r.content}`,
      )
      .join("\n---\n");
    return `Retrieved from archival memory:\n\n${formatted}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Failed to search memory: ${msg}`;
  }
}
