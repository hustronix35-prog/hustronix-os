/**
 * Dump live SQLite OS state (counts + redacted samples).
 * Does not print passwords, session tokens, or API keys.
 *
 *   npm run dump:os-state
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { repoRoot } from "../../apps/api/src/config.js";

const SECRETISH =
  /password|secret|token|totp|api[_-]?key|session|credential|hash|salt/i;
const CONTENT_COLS = /content|body|text|vow|reason|notes|payload|json|description/i;

function clip(v: unknown, n = 160): unknown {
  if (typeof v !== "string") return v;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRETISH.test(k)) {
      out[k] = v == null || v === "" ? v : "[redacted]";
      continue;
    }
    out[k] = CONTENT_COLS.test(k) ? clip(v) : v;
  }
  return out;
}

const tables = db.rawGet(
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
) as { name: string }[];

const counts: Record<string, number> = {};
const samples: Record<string, Record<string, unknown>[]> = {};
const groupBy: Record<string, Record<string, number>> = {};

for (const { name } of tables) {
  const c = (db.rawGet(`SELECT COUNT(*) as c FROM "${name}"`) as { c: number }[])[0]?.c ?? 0;
  counts[name] = Number(c);
  if (c > 0) {
    samples[name] = (
      db.rawGet(`SELECT * FROM "${name}" LIMIT 5`) as Record<string, unknown>[]
    ).map(redactRow);
  }
}

function grouped(sql: string): Record<string, number> {
  const rows = db.rawGet(sql) as { k: string; c: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.k ?? "(null)")] = Number(r.c);
  return out;
}

function tryGrouped(label: string, sql: string) {
  try {
    groupBy[label] = grouped(sql);
  } catch (e) {
    console.warn(`skip ${label}:`, e instanceof Error ? e.message : e);
  }
}

tryGrouped(
  "situations_by_stage",
  `SELECT COALESCE(stage, '(null)') as k, COUNT(*) as c FROM situations GROUP BY stage`,
);
tryGrouped(
  "decisions_by_status",
  `SELECT COALESCE(status, '(null)') as k, COUNT(*) as c FROM decision_ledger GROUP BY status`,
);
tryGrouped(
  "executions_by_status",
  `SELECT COALESCE(status, '(null)') as k, COUNT(*) as c FROM execution_ledger GROUP BY status`,
);
tryGrouped(
  "signals_by_state",
  `SELECT COALESCE(state, '(null)') as k, COUNT(*) as c FROM external_signals GROUP BY state`,
);
tryGrouped(
  "outcomes_by_result",
  `SELECT COALESCE(result, '(null)') as k, COUNT(*) as c FROM decision_outcomes GROUP BY result`,
);
tryGrouped(
  "notifications_unread",
  `SELECT CASE WHEN read_at IS NULL THEN 'unread' ELSE 'read' END as k, COUNT(*) as c FROM notifications GROUP BY 1`,
);

const dump = {
  generatedAt: new Date().toISOString(),
  tableCount: tables.length,
  counts,
  groupBy,
  samples,
};

const outDir = resolve(repoRoot, "data");
mkdirSync(outDir, { recursive: true });
const jsonPath = resolve(outDir, "os-state-dump.json");
writeFileSync(jsonPath, JSON.stringify(dump, null, 2));

const lines = [
  `# Hustronix OS state dump`,
  ``,
  `Generated: ${dump.generatedAt}`,
  `Tables: ${dump.tableCount}`,
  ``,
  `## Counts`,
  ``,
  ...Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `- **${k}**: ${v}`),
  ``,
  `## Grouped`,
  ``,
  ...Object.entries(groupBy).map(
    ([k, v]) => `- **${k}**: ${Object.entries(v).map(([kk, vv]) => `${kk}=${vv}`).join(", ")}`,
  ),
  ``,
];
const mdPath = resolve(outDir, "os-state-dump.md");
writeFileSync(mdPath, lines.join("\n"));

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
console.log("\nTop tables:");
for (const [k, v] of Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}
console.log("\nGrouped:");
console.log(JSON.stringify(groupBy, null, 2));
