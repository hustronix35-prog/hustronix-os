#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const root = process.cwd();
const migrationsDir = path.join(root, "infra", "db", "postgres");
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

function usage() {
  console.log(`Usage:
  DATABASE_URL=postgres://user@host:5432/db npm run db:pg:migrate
  npm run db:pg:migrate -- --dry-run

Runs all SQL files in infra/db/postgres in lexical order.
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

if (!databaseUrl) {
  console.error("DATABASE_URL or POSTGRES_URL is required.");
  usage();
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const files = readdirSync(migrationsDir)
  .filter((name) => /^\d+.*\.sql$/i.test(name))
  .sort();

if (files.length === 0) {
  console.error(`No migration files found in ${path.relative(root, migrationsDir)}.`);
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedRows = await client.query("SELECT name FROM schema_migrations");
  const applied = new Set(appliedRows.rows.map((row) => row.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip ${file}`);
      continue;
    }
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    if (dryRun) {
      console.log(`dry-run ${file} (${sql.length} bytes)`);
      continue;
    }
    console.log(`apply ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  console.log(dryRun ? "PostgreSQL migration dry-run complete." : "PostgreSQL migrations applied.");
} finally {
  await client.end().catch(() => undefined);
}
