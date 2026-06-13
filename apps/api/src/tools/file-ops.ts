import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

const WORKSPACE_DIR = config.paths.workspaceDir;

// Ensure it exists on startup
async function initWorkspace() {
  try {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });
  } catch (e) {
    // Ignore if it already exists
  }
}

export const definition = {
  name: "file_operations",
  description: "Securely read, write, or list files within the safe local workspace directory.",
  parameters: {
    type: "object" as const,
    properties: {
      action: { 
        type: "string", 
        enum: ["read", "write", "list"],
        description: "The file operation to perform."
      },
      filePath: { 
        type: "string", 
        description: "The relative path to the file or directory (e.g., 'notes.txt', 'logs/')."
      },
      content: { 
        type: "string", 
        description: "The content to write. Only required for the 'write' action."
      }
    },
    required: ["action", "filePath"]
  }
};

export async function handler(args: { action: string; filePath: string; content?: string }): Promise<string> {
  await initWorkspace();
  
  // Resolve against workspace and prevent directory traversal (e.g., ../../secrets.txt)
  const targetPath = path.resolve(WORKSPACE_DIR, args.filePath || "");
  if (!targetPath.startsWith(WORKSPACE_DIR)) {
    return "❌ Error: Access denied. Path resolves outside the secure workspace directory.";
  }

  try {
    switch (args.action) {
      case "read": {
        const data = await fs.readFile(targetPath, "utf-8");
        return `✅ File read successfully:\n\n${data}`;
      }
      
      case "write": {
        if (args.content === undefined) return "❌ Error: 'content' parameter is required for writing.";
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, args.content, "utf-8");
        return `✅ File written successfully to ${args.filePath}`;
      }

      case "list": {
        try {
          const files = await fs.readdir(targetPath, { withFileTypes: true });
          const list = files.map(f => `${f.isDirectory() ? '📂' : '📄'} ${f.name}`).join("\n");
          return `✅ Directory contents of ${args.filePath}:\n${list || "(empty)"}`;
        } catch (err: any) {
          if (err.code === "ENOTDIR") {
            return `❌ Error: ${args.filePath} is a file, not a directory. Use 'read' action instead.`;
          }
          throw err;
        }
      }

      default:
        return `❌ Error: Invalid action '${args.action}'. Must be read, write, or list.`;
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return `❌ Error: Path '${args.filePath}' does not exist.`;
    }
    return `❌ Operation failed: ${err.message}`;
  }
}
