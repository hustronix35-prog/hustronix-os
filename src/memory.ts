import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const db = new Database(path.join(dataDir, "gravity.db"));

// Initialize Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT,
    tool_calls TEXT,
    tool_call_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS core_memory (
    block TEXT PRIMARY KEY,
    content TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    latency_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Initialize default core memory if empty
const checkCore = db.prepare("SELECT COUNT(*) as count FROM core_memory").get() as { count: number };
if (checkCore.count === 0) {
  const insertCore = db.prepare("INSERT INTO core_memory (block, content) VALUES (?, ?)");
  insertCore.run("persona", "I am Gravity Claw. A lean, secure, and helpful AI companion. I speak concisely and directly.");
  insertCore.run("user_profile", "The user is my primary creator and companion.");
}

// ── Tier 2: Working Memory (Conversation Buffer) ──────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls?: string;   // JSON stringified tool calls
  tool_call_id?: string;
}

export function saveMessage(role: string, content: string | null, tool_calls?: any, tool_call_id?: string) {
  const stmt = db.prepare("INSERT INTO messages (role, content, tool_calls, tool_call_id) VALUES (?, ?, ?, ?)");
  const toolCallsJson = tool_calls ? JSON.stringify(tool_calls) : null;
  stmt.run(role, content, toolCallsJson, tool_call_id);
}

export function getWorkingMemory(limit = 20): ChatMessage[] {
  const stmt = db.prepare("SELECT role, content, tool_calls, tool_call_id FROM messages ORDER BY id DESC LIMIT ?");
  const rows = stmt.all(limit) as ChatMessage[];
  return rows.reverse(); // Return in chronological order
}

export function getWorkingMessageCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number };
  return row.count;
}

export function getOldestWorkingMessages(limit: number): { id: number; role: string; content: string }[] {
  // We need to fetch the oldest records. "ORDER BY id ASC LIMIT ?"
  const stmt = db.prepare("SELECT id, role, content FROM messages ORDER BY id ASC LIMIT ?");
  return stmt.all(limit) as { id: number; role: string; content: string }[];
}

export function deleteMessagesById(ids: number[]) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  const stmt = db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`);
  stmt.run(...ids);
}

export function clearWorkingMemory() {
  db.prepare("DELETE FROM messages").run();
}

// ── Tier 1: Core Memory ───────────────────────────────────────────────────

export function getCoreMemoryBlock(block: string): string {
  const stmt = db.prepare("SELECT content FROM core_memory WHERE block = ?");
  const row = stmt.get(block) as { content: string } | undefined;
  return row?.content ?? "";
}

export function updateCoreMemoryBlock(block: string, content: string) {
  const stmt = db.prepare(`
    INSERT INTO core_memory (block, content) 
    VALUES (?, ?) 
    ON CONFLICT(block) DO UPDATE SET content=excluded.content
  `);
  stmt.run(block, content);
}

export function getFullCoreMemory(): string {
  const persona = getCoreMemoryBlock("persona");
  const userProfile = getCoreMemoryBlock("user_profile");
  const summary = getCoreMemoryBlock("conversation_summary");
  
  let core = `
[CORE MEMORY: PERSONA]
${persona}

[CORE MEMORY: USER PROFILE]
${userProfile}
`.trim();

  if (summary) {
    core += `\n\n[CONVERSATION SUMMARY]\n${summary}`;
  }

  return core;
}

// ── Tier 4: Usage Tracking ───────────────────────────────────────────────

export function logUsage(model: string, promptTokens: number, completionTokens: number, latencyMs: number) {
  const stmt = db.prepare(`
    INSERT INTO usage_logs (model, prompt_tokens, completion_tokens, latency_ms)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(model, promptTokens, completionTokens, latencyMs);
}

export function getUsageStats() {
  const row = db.prepare(`
    SELECT 
      COUNT(*) as total_calls, 
      SUM(prompt_tokens) as total_prompt, 
      SUM(completion_tokens) as total_completion,
      AVG(latency_ms) as avg_latency
    FROM usage_logs
  `).get() as { total_calls: number; total_prompt: number; total_completion: number; avg_latency: number } | undefined;

  return {
    total_calls: row?.total_calls || 0,
    total_prompt: row?.total_prompt || 0,
    total_completion: row?.total_completion || 0,
    avg_latency: row?.avg_latency || 0,
  };
}
