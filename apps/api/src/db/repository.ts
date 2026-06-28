/**
 * Async repository foundation — SQLite adapter today; Postgres cutover in Phase 6.
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface Repository {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
  transaction<T>(fn: (repo: Repository) => Promise<T>): Promise<T>;
}

export type RepositoryDialect = "sqlite" | "postgres";

export interface RepositoryConfig {
  dialect: RepositoryDialect;
  /** When postgres cutover completes, connection string from DATABASE_URL. */
  connectionString?: string;
}
