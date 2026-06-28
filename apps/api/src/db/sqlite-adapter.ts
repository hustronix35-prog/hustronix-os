import { db } from "../database.js";
import type { QueryResult, Repository } from "./repository.js";

/**
 * Thin async wrapper over synchronous better-sqlite3 — enables gradual cutover.
 */
export class SqliteRepository implements Repository {
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const rows = db.rawGet(sql, params) as T[];
    return { rows, rowCount: rows.length };
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    const result = db.rawRun(sql, params) as { changes?: number; lastInsertRowid?: number | bigint };
    return {
      changes: result?.changes ?? 0,
      lastInsertRowid: result?.lastInsertRowid,
    };
  }

  async transaction<T>(fn: (repo: Repository) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

let defaultRepo: Repository | null = null;

export function getRepository(): Repository {
  if (!defaultRepo) defaultRepo = new SqliteRepository();
  return defaultRepo;
}

export function setRepository(repo: Repository): void {
  defaultRepo = repo;
}
