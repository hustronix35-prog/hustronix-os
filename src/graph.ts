import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = path.resolve(process.cwd(), 'graph_memory.db');

// Ensure parent dir exists (it's cwd anyway, but good practice)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const graphDb = new Database(DB_PATH);

// Enable WAL mode for performance
graphDb.pragma('journal_mode = WAL');

// Initialize schema
graphDb.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    attributes TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    target_name TEXT NOT NULL,
    relation TEXT NOT NULL,
    metadata TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(source_name) REFERENCES nodes(name) ON DELETE CASCADE,
    FOREIGN KEY(target_name) REFERENCES nodes(name) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_name);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_name);
`);

/**
 * Upsert a node in the graph.
 */
export function upsertNode(name: string, label: string, attributes: Record<string, any>): string {
  const stmt = graphDb.prepare(`
    INSERT INTO nodes (id, name, label, attributes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      label = excluded.label,
      attributes = excluded.attributes
  `);
  stmt.run(uuidv4(), name.toLowerCase(), label, JSON.stringify(attributes));
  return `Node '${name}' (Label: ${label}) created/updated successfully.`;
}

/**
 * Create a directed edge between two existing nodes.
 */
export function createEdge(sourceName: string, targetName: string, relation: string, metadata: Record<string, any>): string {
  // Verify both exist
  const nodeExists = graphDb.prepare(`SELECT 1 FROM nodes WHERE name = ?`);
  if (!nodeExists.get(sourceName.toLowerCase())) return `Error: Source node '${sourceName}' does not exist. Add it first.`;
  if (!nodeExists.get(targetName.toLowerCase())) return `Error: Target node '${targetName}' does not exist. Add it first.`;

  const stmt = graphDb.prepare(`
    INSERT INTO edges (id, source_name, target_name, relation, metadata)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(uuidv4(), sourceName.toLowerCase(), targetName.toLowerCase(), relation.toUpperCase(), JSON.stringify(metadata));
  return `Edge '${relation}' created from '${sourceName}' to '${targetName}'.`;
}

/**
 * Get a specific node and its immediate relationships (1-degree traversal).
 */
export function searchNode(name: string): string {
  const nodeRow = graphDb.prepare(`SELECT * FROM nodes WHERE name = ?`).get(name.toLowerCase()) as any;
  if (!nodeRow) return `No node found in Knowledge Graph matching '${name}'.`;

  const outEdges = graphDb.prepare(`SELECT relation, target_name, metadata FROM edges WHERE source_name = ?`).all(name.toLowerCase()) as any[];
  const inEdges = graphDb.prepare(`SELECT relation, source_name, metadata FROM edges WHERE target_name = ?`).all(name.toLowerCase()) as any[];

  let res = `[NODE MAP: ${nodeRow.name.toUpperCase()}]\n`;
  res += `Label: ${nodeRow.label}\n`;
  res += `Attributes: ${nodeRow.attributes}\n\n`;

  res += `[OUTBOUND RELATIONS]\n`;
  if (outEdges.length === 0) res += "None.\n";
  for (const e of outEdges) {
    res += `- ${e.relation} -> [${e.target_name}] (Meta: ${e.metadata})\n`;
  }

  res += `\n[INBOUND RELATIONS]\n`;
  if (inEdges.length === 0) res += "None.\n";
  for (const e of inEdges) {
    res += `- [${e.source_name}] -> ${e.relation} -> (this node) (Meta: ${e.metadata})\n`;
  }

  return res;
}
