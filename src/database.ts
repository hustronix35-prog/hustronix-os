import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import type { AuditorWriteContext } from "./auditor-context.js";
import { attachEpistemicDerivation, type EpistemicOrgContext } from "./epistemic-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class HustronixDB {
  private db: any;
  private ledgerAuditorHook: ((ctx: AuditorWriteContext) => void) | null = null;

  constructor() {
    const dbPath = path.join(__dirname, "..", "hustronix.db");
    console.log(`[DB] Connected to: ${dbPath}`);
    this.db = new Database(dbPath);
    this.initSchema();
  }

  rawGet(sql: string, params: any[] = []) {
    return this.db.prepare(sql).all(...params);
  }

  rawRun(sql: string, params: any[] = []) {
    return this.db.prepare(sql).run(...params);
  }

  /** Registers event-driven auditor runs after ledger/signal mutations (set from bootstrap). */
  setLedgerAuditorHook(handler: ((ctx: AuditorWriteContext) => void) | null) {
    this.ledgerAuditorHook = handler;
  }

  /**
   * Used when enforcement code updates rows via raw SQL (e.g. structural collapse) so downstream hooks stay consistent.
   */
  notifyLedgerAuditor(ctx: AuditorWriteContext) {
    this.invokeLedgerAuditor(ctx);
  }

  private invokeLedgerAuditor(ctx: AuditorWriteContext) {
    if (!this.ledgerAuditorHook) return;
    try {
      this.ledgerAuditorHook(ctx);
    } catch (e) {
      console.error("[DB] Ledger auditor hook failed:", e);
    }
  }

  private initSchema() {
    // HARD RESET: For V1.0 hardened build, we force-clear the legacy schema to prevent drift.
    try {
      const check = this.db.prepare("PRAGMA table_info(decision_ledger)").all();
      if (check.length > 0 && !check.find((c: any) => c.name === 'fingerprint')) {
          console.log("[DB] V1.0 Hardened Schema detected. Performing structural reset...");
          this.db.exec("PRAGMA foreign_keys = OFF;");
          ["decision_outcomes", "decision_audit_log", "decision_ledger", "execution_ledger", "external_signals", "audit_log", "performance_stats", "business_constraints"].forEach(t => {
            this.db.exec(`DROP TABLE IF EXISTS ${t};`);
          });
          this.db.exec("PRAGMA foreign_keys = ON;");
      }
    } catch(e) {}

    this.db.exec(`
      -- Core Identity & Auth
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        key_val TEXT NOT NULL,
        PRIMARY KEY(user_id, provider)
      );

      -- Behavioral Reputation System
      CREATE TABLE IF NOT EXISTS owner_reputation (
        owner TEXT PRIMARY KEY,
        failed_executions INTEGER DEFAULT 0,
        successful_executions INTEGER DEFAULT 0,
        reputation_modifier REAL DEFAULT 1.0,
        is_locked BOOLEAN DEFAULT 0
      );

      -- System Configuration
      CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY(user_id, key)
      );

      -- THE DECISION LEDGER (Strategic Commitments)
      CREATE TABLE IF NOT EXISTS decision_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT 'system',
        fingerprint TEXT UNIQUE, -- Semantic Signature for Deduplication
        vow TEXT NOT NULL, -- The "Vow" (Decision Statement)
        expected_outcomes TEXT, -- JSON Object: Metrics/Targets
        constraints TEXT, -- JSON Array: The "NO List"
        reversal_conditions TEXT, -- Textual criteria for abandonment
        confidence REAL DEFAULT 0.8,
        status TEXT DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'COMPLETED', 'REVERSED')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_update DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- THE EXECUTION LEDGER (The Enforcement Graph)
      CREATE TABLE IF NOT EXISTS execution_ledger (
        task_id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        parent_task_id TEXT,
        owner TEXT DEFAULT 'system',
        type TEXT DEFAULT 'ACTION' CHECK(type IN ('ACTION', 'KILL', 'VERIFY', 'BLOCK')),
        priority INTEGER DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
        weight REAL DEFAULT 1.0,
        status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ACTIVE', 'DONE', 'KILLED', 'BLOCKED')),
        blocked_reasons TEXT, -- JSON Array of reason strings
        dependencies TEXT, -- JSON Array of task_ids
        success_condition TEXT,
        failure_condition TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(decision_id) REFERENCES decision_ledger(id)
      );

      -- REAL-WORLD SIGNALS (Shadow Work Detection)
      CREATE TABLE IF NOT EXISTS external_signals (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT 'system',
        source TEXT CHECK(source IN ('GITHUB', 'SLACK', 'JIRA', 'MANUAL')),
        content TEXT,
        owner TEXT,
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        grace_expires_at DATETIME, -- Deterministic countdown
        linked_execution_id TEXT,
        state TEXT DEFAULT 'UNVERIFIED' CHECK(state IN ('UNVERIFIED', 'GRACE', 'LINKED', 'KILLED')),
        FOREIGN KEY(linked_execution_id) REFERENCES execution_ledger(task_id)
      );

      -- SOVEREIGN AUDIT LOG (Traceability)
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        affected_entity_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Interaction Persistence
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT DEFAULT 'default',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS learning_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'system',
        decision_id TEXT,
        mistake_analysis TEXT,
        weight_shifts TEXT,
        surfaced_insight TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_agent TEXT,
        ip TEXT,
        revoked_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS api_access_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME,
        revoked_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    this.ensureDecisionLedgerColumns();
    this.ensureDecisionReasoningColumn();
    this.ensureTenantColumns();
    this.ensureOwnerReputationColumns();
    this.ensureOAuthTables();
    this.ensureSocialAuthTables();
    this.ensureEmailOtpTables();
    this.ensureIntelligenceSchema();
  }

  /**
   * Schema for the intelligence layer (signal-detector + auto-linker + hybrid retrieval).
   * Additive: enrichment columns on `external_signals`, three FTS5 virtual tables,
   * an embeddings BLOB store. SQLite-only — no pgvector. See `src/intelligence/`.
   */
  private ensureIntelligenceSchema() {
    try {
      const sigCols = this.db.prepare("PRAGMA table_info(external_signals)").all() as { name: string }[];
      const haveCol = (n: string) => sigCols.some((c) => c.name === n);
      if (!haveCol("intent")) this.db.exec("ALTER TABLE external_signals ADD COLUMN intent TEXT");
      if (!haveCol("risk")) this.db.exec("ALTER TABLE external_signals ADD COLUMN risk TEXT");
      if (!haveCol("intent_confidence"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN intent_confidence REAL");
      if (!haveCol("related_decision_id"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN related_decision_id TEXT");
      if (!haveCol("intent_extracted_at"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN intent_extracted_at DATETIME");
      if (!haveCol("intelligence_error"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN intelligence_error TEXT");
      if (!haveCol("urgency"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN urgency TEXT");
      if (!haveCol("affected_systems"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN affected_systems TEXT");
      if (!haveCol("op_classification"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN op_classification TEXT");
      if (!haveCol("source_subtype"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN source_subtype TEXT");
      if (!haveCol("external_id"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN external_id TEXT");
      if (!haveCol("ingest_meta"))
        this.db.exec("ALTER TABLE external_signals ADD COLUMN ingest_meta TEXT");
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_signals_external_id ON external_signals(source, external_id)`,
      );
    } catch (e) {
      console.warn("[DB] ensureIntelligenceSchema columns:", e);
    }

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS signals_fts USING fts5(
          signal_id UNINDEXED,
          content,
          owner,
          source UNINDEXED,
          user_id UNINDEXED,
          tokenize = 'porter unicode61'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS executions_fts USING fts5(
          task_id UNINDEXED,
          success_condition,
          failure_condition,
          decision_id UNINDEXED,
          user_id UNINDEXED,
          tokenize = 'porter unicode61'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
          decision_id UNINDEXED,
          vow,
          expected_outcomes,
          constraints,
          user_id UNINDEXED,
          tokenize = 'porter unicode61'
        );
        CREATE TABLE IF NOT EXISTS entity_embeddings (
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          vector BLOB NOT NULL,
          dim INTEGER NOT NULL,
          text_hash TEXT NOT NULL,
          embedded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (entity_type, entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_emb_user_type ON entity_embeddings(user_id, entity_type);

        /** Generalises slack_event_receipts for GitHub/Jira/CRM/Meeting webhooks. */
        CREATE TABLE IF NOT EXISTS external_event_dedup (
          source TEXT NOT NULL,
          external_id TEXT NOT NULL,
          tenant_key TEXT NOT NULL DEFAULT '',
          received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (source, external_id, tenant_key)
        );

        /** One row per ingested meeting; child signals carry meeting_ingestion_id in ingest_meta. */
        CREATE TABLE IF NOT EXISTS meeting_ingestions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source_subtype TEXT,
          title TEXT,
          attendees TEXT,
          occurred_at DATETIME,
          transcript_hash TEXT,
          extraction_method TEXT,
          decisions_count INTEGER DEFAULT 0,
          commitments_count INTEGER DEFAULT 0,
          constraints_count INTEGER DEFAULT 0,
          blockers_count INTEGER DEFAULT 0,
          disagreements_count INTEGER DEFAULT 0,
          signal_ids TEXT,
          error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_meeting_user_time ON meeting_ingestions(user_id, occurred_at);
      `);
    } catch (e) {
      console.warn("[DB] ensureIntelligenceSchema FTS/embeddings:", e);
    }
  }

  // --- Intelligence: signal enrichment ---

  /**
   * Persist signal-detector + enricher output. Idempotent — overwrites previous extraction.
   * `urgency`, `affected_systems` (JSON-stringified array), `op_classification` are written
   * from the same LLM round-trip as detector fields (see `intelligence/enrich.ts`).
   * Pass `undefined` to leave a column unchanged; pass `null` to clear it.
   */
  enrichSignal(
    signalId: string,
    fields: {
      intent?: string | null;
      risk?: "low" | "medium" | "high" | null;
      confidence?: number | null;
      relatedDecisionId?: string | null;
      error?: string | null;
      urgency?: "immediate" | "soon" | "scheduled" | "informational" | null;
      affectedSystems?: string[] | null;
      opClassification?:
        | "incident"
        | "change"
        | "inquiry"
        | "status"
        | "ambient"
        | "commitment"
        | "blocker"
        | "constraint"
        | "decision_signal"
        | "disagreement"
        | null;
    },
  ) {
    const sets: string[] = ["intent_extracted_at = CURRENT_TIMESTAMP"];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col} = ?`);
      params.push(val);
    };
    if (fields.intent !== undefined) push("intent", fields.intent);
    if (fields.risk !== undefined) push("risk", fields.risk);
    if (fields.confidence !== undefined) push("intent_confidence", fields.confidence);
    if (fields.relatedDecisionId !== undefined) push("related_decision_id", fields.relatedDecisionId);
    if (fields.error !== undefined) push("intelligence_error", fields.error);
    if (fields.urgency !== undefined) push("urgency", fields.urgency);
    if (fields.affectedSystems !== undefined) {
      push("affected_systems", fields.affectedSystems == null ? null : JSON.stringify(fields.affectedSystems));
    }
    if (fields.opClassification !== undefined) push("op_classification", fields.opClassification);

    params.push(signalId);
    this.db.prepare(`UPDATE external_signals SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  /**
   * Generic webhook idempotency. Returns true if this is a new event (inserted),
   * false if it was already processed. Use for GitHub/Jira/CRM/Meeting webhooks.
   * `tenantKey` partitions namespaces (e.g. team_id, repo) so two tenants can
   * legitimately deliver the same external_id without colliding.
   */
  tryInsertExternalEventId(source: string, externalId: string, tenantKey = ""): boolean {
    try {
      this.db
        .prepare(
          `INSERT INTO external_event_dedup (source, external_id, tenant_key) VALUES (?, ?, ?)`,
        )
        .run(source.toUpperCase(), String(externalId), tenantKey);
      return true;
    } catch {
      return false;
    }
  }

  getSignalById(signalId: string) {
    return this.db
      .prepare(`SELECT * FROM external_signals WHERE id = ?`)
      .get(signalId) as
      | {
          id: string;
          user_id: string;
          source: string;
          content: string;
          owner: string;
          detected_at: string;
          state: string;
          linked_execution_id: string | null;
          intent: string | null;
          risk: string | null;
          intent_confidence: number | null;
          related_decision_id: string | null;
          urgency: string | null;
          affected_systems: string | null;
          op_classification: string | null;
          source_subtype: string | null;
          external_id: string | null;
          ingest_meta: string | null;
        }
      | undefined;
  }

  /** Persist a meeting ingestion audit row. */
  recordMeetingIngestion(row: {
    id: string;
    userId: string;
    sourceSubtype: string;
    title: string | null;
    attendees: string[] | null;
    occurredAt: string | null;
    transcriptHash: string;
    extractionMethod: "llm" | "heuristic";
    counts: {
      decisions: number;
      commitments: number;
      constraints: number;
      blockers: number;
      disagreements: number;
    };
    signalIds: string[];
    error?: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO meeting_ingestions
           (id, user_id, source_subtype, title, attendees, occurred_at,
            transcript_hash, extraction_method,
            decisions_count, commitments_count, constraints_count,
            blockers_count, disagreements_count, signal_ids, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.userId,
        row.sourceSubtype,
        row.title,
        row.attendees == null ? null : JSON.stringify(row.attendees),
        row.occurredAt,
        row.transcriptHash,
        row.extractionMethod,
        row.counts.decisions,
        row.counts.commitments,
        row.counts.constraints,
        row.counts.blockers,
        row.counts.disagreements,
        JSON.stringify(row.signalIds),
        row.error ?? null,
      );
  }

  /** Idempotency check for meetings — same transcript should not double-fan-out. */
  meetingAlreadyIngested(userId: string, transcriptHash: string): boolean {
    const r = this.db
      .prepare(`SELECT 1 FROM meeting_ingestions WHERE user_id = ? AND transcript_hash = ? LIMIT 1`)
      .get(userId, transcriptHash);
    return !!r;
  }

  // --- Intelligence: context engine reads ---

  /** Single ACTIVE decision per user (deterministic conflict rule). null if none. */
  getActiveDecision(userId: string) {
    return this.db
      .prepare(
        `SELECT id, vow, expected_outcomes, constraints, reversal_conditions, confidence, status, created_at
           FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1`,
      )
      .get(userId) as
      | {
          id: string;
          vow: string;
          expected_outcomes: string;
          constraints: string;
          reversal_conditions: string | null;
          confidence: number;
          status: string;
          created_at: string;
        }
      | undefined;
  }

  getActiveExecutions(userId: string, limit = 50) {
    return this.db
      .prepare(
        `SELECT e.task_id, e.decision_id, e.owner, e.type, e.weight, e.status,
                e.success_condition, e.failure_condition, e.last_update,
                d.vow as decision_vow
           FROM execution_ledger e
           INNER JOIN decision_ledger d ON e.decision_id = d.id
           WHERE d.user_id = ? AND e.status IN ('PENDING', 'ACTIVE', 'BLOCKED')
           ORDER BY CASE e.status WHEN 'ACTIVE' THEN 0 WHEN 'BLOCKED' THEN 1 ELSE 2 END,
                    e.last_update DESC
           LIMIT ?`,
      )
      .all(userId, limit) as {
      task_id: string;
      decision_id: string;
      owner: string;
      type: string;
      weight: number;
      status: string;
      success_condition: string | null;
      failure_condition: string | null;
      last_update: string;
      decision_vow: string;
    }[];
  }

  /** Includes enrichment columns. Tenant-scoped (system sees all). */
  getRecentSignals(userId: string, limit = 20) {
    const cols = `id, user_id, source, source_subtype, content, owner, detected_at, state,
                  intent, risk, intent_confidence, related_decision_id, linked_execution_id,
                  urgency, affected_systems, op_classification`;
    if (userId === "system") {
      return this.db
        .prepare(`SELECT ${cols} FROM external_signals ORDER BY detected_at DESC LIMIT ?`)
        .all(limit) as Record<string, unknown>[];
    }
    return this.db
      .prepare(
        `SELECT ${cols} FROM external_signals WHERE user_id = ? ORDER BY detected_at DESC LIMIT ?`,
      )
      .all(userId, limit) as Record<string, unknown>[];
  }

  // --- Intelligence: FTS5 mirror writes ---

  upsertSignalFts(row: {
    signalId: string;
    content: string;
    owner: string;
    source: string;
    userId: string;
  }) {
    try {
      this.db.prepare(`DELETE FROM signals_fts WHERE signal_id = ?`).run(row.signalId);
      this.db
        .prepare(
          `INSERT INTO signals_fts (signal_id, content, owner, source, user_id) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(row.signalId, row.content, row.owner, row.source, row.userId);
    } catch (e) {
      console.warn("[DB] upsertSignalFts:", e);
    }
  }

  upsertExecutionFts(row: {
    taskId: string;
    successCondition: string | null;
    failureCondition: string | null;
    decisionId: string;
    userId: string;
  }) {
    try {
      this.db.prepare(`DELETE FROM executions_fts WHERE task_id = ?`).run(row.taskId);
      this.db
        .prepare(
          `INSERT INTO executions_fts (task_id, success_condition, failure_condition, decision_id, user_id)
             VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          row.taskId,
          row.successCondition || "",
          row.failureCondition || "",
          row.decisionId,
          row.userId,
        );
    } catch (e) {
      console.warn("[DB] upsertExecutionFts:", e);
    }
  }

  upsertDecisionFts(row: {
    decisionId: string;
    vow: string;
    expectedOutcomes: string;
    constraints: string;
    userId: string;
  }) {
    try {
      this.db.prepare(`DELETE FROM decisions_fts WHERE decision_id = ?`).run(row.decisionId);
      this.db
        .prepare(
          `INSERT INTO decisions_fts (decision_id, vow, expected_outcomes, constraints, user_id)
             VALUES (?, ?, ?, ?, ?)`,
        )
        .run(row.decisionId, row.vow, row.expectedOutcomes, row.constraints, row.userId);
    } catch (e) {
      console.warn("[DB] upsertDecisionFts:", e);
    }
  }

  /** One-shot backfill — safe to call on startup. */
  rebuildFtsFromLedger() {
    try {
      this.db.exec("DELETE FROM signals_fts; DELETE FROM executions_fts; DELETE FROM decisions_fts;");
      const sigs = this.db
        .prepare(
          `SELECT id, user_id, source, content, owner FROM external_signals WHERE content IS NOT NULL`,
        )
        .all() as { id: string; user_id: string; source: string; content: string; owner: string }[];
      for (const s of sigs) {
        this.upsertSignalFts({
          signalId: s.id,
          content: s.content || "",
          owner: s.owner || "",
          source: s.source || "",
          userId: s.user_id || "system",
        });
      }
      const execs = this.db
        .prepare(
          `SELECT e.task_id, e.success_condition, e.failure_condition, e.decision_id, d.user_id
             FROM execution_ledger e INNER JOIN decision_ledger d ON e.decision_id = d.id`,
        )
        .all() as {
        task_id: string;
        success_condition: string | null;
        failure_condition: string | null;
        decision_id: string;
        user_id: string;
      }[];
      for (const e of execs) {
        this.upsertExecutionFts({
          taskId: e.task_id,
          successCondition: e.success_condition,
          failureCondition: e.failure_condition,
          decisionId: e.decision_id,
          userId: e.user_id || "system",
        });
      }
      const decs = this.db
        .prepare(
          `SELECT id, user_id, vow, expected_outcomes, constraints FROM decision_ledger`,
        )
        .all() as {
        id: string;
        user_id: string;
        vow: string;
        expected_outcomes: string;
        constraints: string;
      }[];
      for (const d of decs) {
        this.upsertDecisionFts({
          decisionId: d.id,
          vow: d.vow || "",
          expectedOutcomes: d.expected_outcomes || "",
          constraints: d.constraints || "",
          userId: d.user_id || "system",
        });
      }
    } catch (e) {
      console.warn("[DB] rebuildFtsFromLedger:", e);
    }
  }

  // --- Intelligence: hybrid retrieval reads ---

  /**
   * BM25-ranked FTS5 query against signals. Returns row + bm25 score (lower = more relevant in FTS5).
   * Tenant-scoped. The caller may flip the score sign before fusion.
   */
  searchSignalsFts(userId: string, query: string, limit = 20) {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];
    const params: unknown[] = [sanitized];
    let sql = `SELECT signal_id, content, owner, source, user_id, bm25(signals_fts) as score
                 FROM signals_fts WHERE signals_fts MATCH ?`;
    if (userId !== "system") {
      sql += ` AND user_id = ?`;
      params.push(userId);
    }
    sql += ` ORDER BY score ASC LIMIT ?`;
    params.push(limit);
    return this.db.prepare(sql).all(...params) as {
      signal_id: string;
      content: string;
      owner: string;
      source: string;
      user_id: string;
      score: number;
    }[];
  }

  searchExecutionsFts(userId: string, query: string, limit = 20) {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];
    const params: unknown[] = [sanitized];
    let sql = `SELECT task_id, success_condition, failure_condition, decision_id, user_id, bm25(executions_fts) as score
                 FROM executions_fts WHERE executions_fts MATCH ?`;
    if (userId !== "system") {
      sql += ` AND user_id = ?`;
      params.push(userId);
    }
    sql += ` ORDER BY score ASC LIMIT ?`;
    params.push(limit);
    return this.db.prepare(sql).all(...params) as {
      task_id: string;
      success_condition: string;
      failure_condition: string;
      decision_id: string;
      user_id: string;
      score: number;
    }[];
  }

  searchDecisionsFts(userId: string, query: string, limit = 20) {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];
    const params: unknown[] = [sanitized];
    let sql = `SELECT decision_id, vow, expected_outcomes, constraints, user_id, bm25(decisions_fts) as score
                 FROM decisions_fts WHERE decisions_fts MATCH ?`;
    if (userId !== "system") {
      sql += ` AND user_id = ?`;
      params.push(userId);
    }
    sql += ` ORDER BY score ASC LIMIT ?`;
    params.push(limit);
    return this.db.prepare(sql).all(...params) as {
      decision_id: string;
      vow: string;
      expected_outcomes: string;
      constraints: string;
      user_id: string;
      score: number;
    }[];
  }

  // --- Intelligence: embeddings ---

  upsertEmbedding(row: {
    entityType: "signal" | "execution" | "decision";
    entityId: string;
    userId: string;
    vector: Float32Array;
    textHash: string;
  }) {
    const buf = Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
    this.db
      .prepare(
        `INSERT INTO entity_embeddings (entity_type, entity_id, user_id, vector, dim, text_hash, embedded_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             user_id = excluded.user_id,
             vector = excluded.vector,
             dim = excluded.dim,
             text_hash = excluded.text_hash,
             embedded_at = CURRENT_TIMESTAMP`,
      )
      .run(row.entityType, row.entityId, row.userId, buf, row.vector.length, row.textHash);
  }

  getEmbeddingTextHash(entityType: string, entityId: string): string | null {
    const row = this.db
      .prepare(`SELECT text_hash FROM entity_embeddings WHERE entity_type = ? AND entity_id = ?`)
      .get(entityType, entityId) as { text_hash: string } | undefined;
    return row?.text_hash ?? null;
  }

  /**
   * Caller does cosine in JS — N stays in the thousands. Tenant-scoped.
   * Returns vector buffers as Float32Array for direct math.
   */
  listEmbeddingsForUser(
    userId: string,
    entityType?: "signal" | "execution" | "decision",
  ): { entityType: string; entityId: string; vector: Float32Array }[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (userId !== "system") {
      where.push("user_id = ?");
      params.push(userId);
    }
    if (entityType) {
      where.push("entity_type = ?");
      params.push(entityType);
    }
    const sql = `SELECT entity_type, entity_id, vector, dim FROM entity_embeddings ${
      where.length ? `WHERE ${where.join(" AND ")}` : ""
    }`;
    const rows = this.db.prepare(sql).all(...params) as {
      entity_type: string;
      entity_id: string;
      vector: Buffer;
      dim: number;
    }[];
    return rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      vector: new Float32Array(r.vector.buffer, r.vector.byteOffset, r.dim),
    }));
  }

  /** Older DBs may have owner_reputation without behavioral columns (CREATE TABLE IF NOT EXISTS skips upgrades). */
  private ensureOwnerReputationColumns() {
    try {
      const cols = this.db.prepare("PRAGMA table_info(owner_reputation)").all() as { name: string }[];
      if (cols.length === 0) return;
      if (!cols.some((c) => c.name === "reputation_modifier")) {
        this.db.exec("ALTER TABLE owner_reputation ADD COLUMN reputation_modifier REAL DEFAULT 1.0");
        this.db.exec(
          "UPDATE owner_reputation SET reputation_modifier = 1.0 WHERE reputation_modifier IS NULL",
        );
      }
      if (!cols.some((c) => c.name === "is_locked")) {
        this.db.exec("ALTER TABLE owner_reputation ADD COLUMN is_locked INTEGER DEFAULT 0");
        this.db.exec("UPDATE owner_reputation SET is_locked = 0 WHERE is_locked IS NULL");
      }
    } catch (e) {
      console.warn("[DB] ensureOwnerReputationColumns:", e);
    }
  }

  private ensureSocialAuthTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_login_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_identities (
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, provider_user_id)
      );
    `);
  }

  private ensureEmailOtpTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_otp_challenges (
        challenge_token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('signup','login')),
        user_id TEXT,
        code_hash TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_email_otp_user_login ON email_otp_challenges(user_id, purpose);
    `);
  }

  deleteExpiredEmailOtpChallenges() {
    this.db.prepare(`DELETE FROM email_otp_challenges WHERE expires_at < datetime('now')`).run();
  }

  deleteOpenLoginOtpForUser(userId: string) {
    this.db
      .prepare(
        `DELETE FROM email_otp_challenges WHERE user_id = ? AND purpose = 'login' AND consumed_at IS NULL`,
      )
      .run(userId);
  }

  insertEmailOtpChallenge(params: {
    challengeToken: string;
    username: string;
    purpose: "signup" | "login";
    userId: string | null;
    codeHash: string;
    expiresAtIso: string;
  }) {
    this.db
      .prepare(
        `INSERT INTO email_otp_challenges (challenge_token, username, purpose, user_id, code_hash, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.challengeToken,
        params.username,
        params.purpose,
        params.userId,
        params.codeHash,
        params.expiresAtIso,
      );
  }

  getEmailOtpChallenge(challengeToken: string) {
    return this.db
      .prepare(
        `SELECT challenge_token, username, purpose, user_id, code_hash, expires_at, attempts, consumed_at
         FROM email_otp_challenges WHERE challenge_token = ?`,
      )
      .get(challengeToken) as
      | {
          challenge_token: string;
          username: string;
          purpose: string;
          user_id: string | null;
          code_hash: string;
          expires_at: string;
          attempts: number;
          consumed_at: string | null;
        }
      | undefined;
  }

  incrementEmailOtpAttempts(challengeToken: string) {
    this.db
      .prepare(`UPDATE email_otp_challenges SET attempts = attempts + 1 WHERE challenge_token = ?`)
      .run(challengeToken);
  }

  consumeEmailOtpChallenge(challengeToken: string) {
    this.db
      .prepare(
        `UPDATE email_otp_challenges SET consumed_at = datetime('now') WHERE challenge_token = ? AND consumed_at IS NULL`,
      )
      .run(challengeToken);
  }

  createOAuthLoginState(state: string, provider: string, ttlMinutes: number) {
    const expiresAt = new Date(
      Date.now() + ttlMinutes * 60 * 1000,
    ).toISOString();
    this.db
      .prepare(
        `INSERT INTO oauth_login_states (state, provider, expires_at) VALUES (?, ?, ?)`,
      )
      .run(state, provider, expiresAt);
  }

  consumeOAuthLoginState(state: string): string | null {
    const row = this.db
      .prepare(
        `SELECT provider FROM oauth_login_states WHERE state = ? AND expires_at > datetime('now')`,
      )
      .get(state) as { provider: string } | undefined;
    if (!row) return null;
    this.db.prepare(`DELETE FROM oauth_login_states WHERE state = ?`).run(state);
    return row.provider;
  }

  findOAuthUserId(provider: string, providerUserId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?`,
      )
      .get(provider, providerUserId) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  insertOAuthIdentity(
    provider: string,
    providerUserId: string,
    userId: string,
    email: string | null,
  ) {
    this.db
      .prepare(
        `INSERT INTO oauth_identities (provider, provider_user_id, user_id, email)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider, provider_user_id) DO UPDATE SET
           user_id = excluded.user_id,
           email = excluded.email`,
      )
      .run(provider, providerUserId, userId, email);
  }

  findUserIdByUsername(username: string): string | null {
    const row = this.db
      .prepare(`SELECT id FROM users WHERE username = ?`)
      .get(username) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** Username safe for `users.username` (unique). */
  allocateUniqueUsername(base: string): string {
    let u = base
      .trim()
      .slice(0, 56)
      .replace(/[^a-zA-Z0-9._@-]/g, "_")
      .replace(/_+/g, "_");
    if (!u) u = "user";
    let candidate = u;
    let n = 0;
    while (
      this.db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(candidate)
    ) {
      n += 1;
      candidate = `${u}_${n}`;
    }
    return candidate;
  }

  private ensureOAuthTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_pending_states (
        state TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_connections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_team_id TEXT NOT NULL DEFAULT '',
        external_team_name TEXT,
        bot_user_id TEXT,
        access_token TEXT NOT NULL,
        scope TEXT,
        token_type TEXT,
        raw_install_payload TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider, external_team_id)
      );

      CREATE TABLE IF NOT EXISTS slack_event_receipts (
        event_id TEXT PRIMARY KEY,
        team_id TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  createOAuthPendingState(
    state: string,
    userId: string,
    provider: string,
    ttlMinutes: number,
  ) {
    const expiresAt = new Date(
      Date.now() + ttlMinutes * 60 * 1000,
    ).toISOString();
    this.db
      .prepare(
        `INSERT INTO oauth_pending_states (state, user_id, provider, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .run(state, userId, provider, expiresAt);
  }

  /** Validates CSRF state; deletes row so it cannot be reused. */
  consumeOAuthPendingState(state: string): { user_id: string } | null {
    const row = this.db
      .prepare(
        `SELECT user_id FROM oauth_pending_states WHERE state = ? AND expires_at > datetime('now')`,
      )
      .get(state) as { user_id: string } | undefined;
    if (!row) return null;
    this.db.prepare(`DELETE FROM oauth_pending_states WHERE state = ?`).run(state);
    return { user_id: row.user_id };
  }

  upsertSlackBotInstallation(data: {
    userId: string;
    teamId: string;
    teamName: string | null;
    botUserId: string | null;
    accessToken: string;
    scope: string | null;
    tokenType: string | null;
    rawJson: string;
  }) {
    this.db
      .prepare(
        `DELETE FROM oauth_connections WHERE user_id = ? AND provider = 'slack' AND external_team_id = ?`,
      )
      .run(data.userId, data.teamId);
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO oauth_connections (
          id, user_id, provider, external_team_id, external_team_name, bot_user_id,
          access_token, scope, token_type, raw_install_payload, updated_at
        ) VALUES (?, ?, 'slack', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        id,
        data.userId,
        data.teamId,
        data.teamName,
        data.botUserId,
        data.accessToken,
        data.scope,
        data.tokenType,
        data.rawJson,
      );
    return id;
  }

  getSlackConnectionsForUser(userId: string) {
    return this.db
      .prepare(
        `SELECT id, external_team_id, external_team_name, scope, created_at, updated_at
         FROM oauth_connections WHERE user_id = ? AND provider = 'slack' ORDER BY updated_at DESC`,
      )
      .all(userId) as {
      id: string;
      external_team_id: string;
      external_team_name: string | null;
      scope: string | null;
      created_at: string;
      updated_at: string;
    }[];
  }

  /**
   * Resolve which Hustronix user “owns” events for a Slack team (bot install).
   * If several rows exist, the most recently updated install wins.
   */
  getSlackTenantForTeam(teamId: string): { user_id: string } | null {
    const row = this.db
      .prepare(
        `SELECT user_id FROM oauth_connections
         WHERE provider = 'slack' AND external_team_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(teamId) as { user_id: string } | undefined;
    return row ?? null;
  }

  /** @returns true if this is a new event_id (inserted), false if duplicate. */
  tryInsertSlackEventId(eventId: string, teamId: string): boolean {
    try {
      this.db
        .prepare(`INSERT INTO slack_event_receipts (event_id, team_id) VALUES (?, ?)`)
        .run(eventId, teamId);
      return true;
    } catch {
      return false;
    }
  }

  insertExternalSignal(row: {
    id: string;
    userId: string;
    source: "SLACK" | "GITHUB" | "JIRA" | "MANUAL";
    content: string;
    owner: string;
    /** Optional ISO or SQLite datetime; default `CURRENT_TIMESTAMP`. */
    detectedAt?: string;
    /** Provider-specific subtype: meeting / crm.hubspot / github.issues / etc. */
    sourceSubtype?: string;
    /** Idempotency key from the upstream provider (e.g. github delivery id). */
    externalId?: string;
    /** Free-form JSON-stringified context (channel, repo, attendees…). */
    ingestMeta?: string;
  }) {
    const detectedAt = row.detectedAt ?? null;
    this.db
      .prepare(
        `INSERT INTO external_signals
            (id, user_id, source, content, owner, detected_at, state,
             source_subtype, external_id, ingest_meta)
         VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), 'UNVERIFIED', ?, ?, ?)`,
      )
      .run(
        row.id,
        row.userId,
        row.source,
        row.content,
        row.owner,
        detectedAt,
        row.sourceSubtype ?? null,
        row.externalId ?? null,
        row.ingestMeta ?? null,
      );
    this.upsertSignalFts({
      signalId: row.id,
      content: row.content,
      owner: row.owner,
      source: row.source,
      userId: row.userId,
    });
    this.invokeLedgerAuditor({ type: "signal", signalId: row.id });
  }

  /** Link a signal to an execution (tenant checks done by caller). */
  linkExternalSignalToTask(signalId: string, taskId: string) {
    this.db
      .prepare(`UPDATE external_signals SET state = 'LINKED', linked_execution_id = ? WHERE id = ?`)
      .run(taskId, signalId);
    this.invokeLedgerAuditor({ type: "signal_link", signalId, taskId });
  }

  /** Mark a signal KILLED (tenant checks done by caller). */
  killExternalSignal(signalId: string) {
    this.db.prepare(`UPDATE external_signals SET state = 'KILLED' WHERE id = ?`).run(signalId);
    this.invokeLedgerAuditor({ type: "signal", signalId });
  }

  /** Migrates older DBs where decision_ledger predates last_update (transitionDecisionState updates it). */
  private ensureDecisionLedgerColumns() {
    const cols = this.db.prepare("PRAGMA table_info(decision_ledger)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "last_update")) {
      // SQLite rejects non-constant DEFAULT on ADD COLUMN in many builds.
      this.db.exec("ALTER TABLE decision_ledger ADD COLUMN last_update DATETIME");
      this.db.exec(
        "UPDATE decision_ledger SET last_update = CURRENT_TIMESTAMP WHERE last_update IS NULL",
      );
    }
  }

  /** JSON blob: epistemic memo, causal validation gate, second-order effects, decision economics (see institutional-reasoning.ts). */
  private ensureDecisionReasoningColumn() {
    try {
      const cols = this.db.prepare("PRAGMA table_info(decision_ledger)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "decision_reasoning")) {
        this.db.exec("ALTER TABLE decision_ledger ADD COLUMN decision_reasoning TEXT");
      }
    } catch (e) {
      console.warn("[DB] ensureDecisionReasoningColumn:", e);
    }
  }

  /** Full decision row (includes decision_reasoning when migrated). */
  getDecisionLedgerRow(decisionId: string) {
    return this.db.prepare(`SELECT * FROM decision_ledger WHERE id = ?`).get(decisionId) as
      | Record<string, unknown>
      | undefined;
  }

  /** SQLite migrations for multi-tenant signals + SaaS tables on older files. */
  private ensureTenantColumns() {
    const sigCols = this.db.prepare("PRAGMA table_info(external_signals)").all() as { name: string }[];
    if (!sigCols.some((c) => c.name === "user_id")) {
      try {
        this.db.exec("ALTER TABLE external_signals ADD COLUMN user_id TEXT");
        this.db.exec("UPDATE external_signals SET user_id = 'system' WHERE user_id IS NULL");
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Deterministic ACTIVE conflict rule: at most one ACTIVE decision per user_id.
   * Contradiction is approximated by parallel ACTIVE commitments; new activations must wait.
   */
  private findOtherActiveDecision(userId: string, excludeDecisionId: string) {
    return this.db
      .prepare(
        `SELECT id, vow FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE' AND id != ?`
      )
      .get(userId, excludeDecisionId) as { id: string; vow: string } | undefined;
  }

  /** Non-terminal decisions for supervisor context (DRAFT / ACTIVE / UNDER_REVIEW). */
  getPendingDecisions(userId: string, limit: number = 20) {
    return this.db
      .prepare(
        `SELECT id, vow, status, created_at, confidence
         FROM decision_ledger
         WHERE user_id = ? AND status IN ('DRAFT', 'ACTIVE', 'UNDER_REVIEW')
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, limit);
  }

  /** Recent audit rows scoped to this user's decisions or their execution tasks. */
  getRecentOutcomes(userId: string, limit: number = 5) {
    return this.db
      .prepare(
        `SELECT a.action, a.reason, a.timestamp, a.affected_entity_id
         FROM audit_log a
         LEFT JOIN decision_ledger d ON a.affected_entity_id = d.id
         LEFT JOIN execution_ledger e ON a.affected_entity_id = e.task_id
         LEFT JOIN decision_ledger d2 ON e.decision_id = d2.id
         WHERE d.user_id = ? OR d2.user_id = ?
         ORDER BY a.timestamp DESC
         LIMIT ?`
      )
      .all(userId, userId, limit);
  }

  // --- Auth & Keys ---
  getUser(username: string) {
    return this.db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  }

  getUserById(id: string) {
    return this.db.prepare("SELECT id, username, created_at FROM users WHERE id = ?").get(id);
  }

  createUser(id: string, username: string, hash: string) {
    this.db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(id, username, hash);
  }

  getUserKey(userId: string, provider: string) {
    const row = this.db.prepare("SELECT key_val FROM api_keys WHERE user_id = ? AND provider = ?").get(userId, provider);
    return row ? row.key_val : null;
  }

  getSetting(userId: string, key: string) {
    const row = this.db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?").get(userId, key);
    return row ? row.value : null;
  }

  updateSetting(userId: string, key: string, value: string) {
    this.db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)").run(userId, key, value);
  }

  /** Persistent agent memory (`settings` keys `core_memory.<block>`). */
  getCoreMemory(userId: string, block: string): string | null {
    return this.getSetting(userId, `core_memory.${block}`);
  }

  updateCoreMemory(userId: string, block: string, content: string) {
    this.updateSetting(userId, `core_memory.${block}`, content);
  }

  // --- Audit & Locking ---
  // --- Audit & Traceability ---
  private logAudit(action: string, reason: string, entityId: string | null = null) {
    this.db.prepare(`
      INSERT INTO audit_log (action, reason, affected_entity_id)
      VALUES (?, ?, ?)
    `).run(action, reason, entityId);
  }

  /** Organizational memory hook for derived confidence (completed decisions + learning_log). */
  getEpistemicOrgContext(userId: string): EpistemicOrgContext {
    const uid = userId || "system";
    const completedRow = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status IN ('COMPLETED', 'REVERSED')`,
      )
      .get(uid) as { c: number };
    const learningRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM learning_log WHERE user_id = ?`)
      .get(uid) as { c: number };
    const completed_decisions = completedRow?.c ?? 0;
    const learning_log_entries = learningRow?.c ?? 0;
    const memory_confidence_boost_0_1 = Math.min(
      0.04,
      0.005 * Math.min(completed_decisions, 8) + 0.002 * Math.min(learning_log_entries, 10),
    );
    const memory_note =
      completed_decisions === 0 && learning_log_entries === 0
        ? "No prior completed decisions or learning_log rows for this principal."
        : `${completed_decisions} completed/reversed decisions; ${learning_log_entries} learning_log entr${learning_log_entries === 1 ? "y" : "ies"} — bounded memory uplift applied to structural confidence.`;
    return {
      completed_decisions,
      learning_log_entries,
      memory_confidence_boost_0_1,
      memory_note,
    };
  }

  // --- Decision Management ---
  saveDecisionEvent(userId: string, data: any) {
    const id = uuidv4();
    const ir = data.institutional_reasoning;
    // Semantic Fingerprint: Vow + Expected Outcomes + reasoning payload (before server-only epistemic_derivation).
    const fingerprintStr =
      (data.vow || "") +
      JSON.stringify(data.expected_outcomes || {}) +
      (ir ? JSON.stringify(ir) : "");
    const fingerprint = crypto.createHash('sha256').update(fingerprintStr).digest('hex');

    // DEDUPLICATION Check
    const existing = this.db.prepare("SELECT id FROM decision_ledger WHERE fingerprint = ?").get(fingerprint);
    if (existing) {
        this.log(userId, "Database", `Deduplicated decision attempt for fingerprint ${fingerprint.slice(0,8)}`);
        return existing.id;
    }

    if (ir && typeof ir === "object" && Number(ir.institutional_version) >= 3) {
      attachEpistemicDerivation(ir, this.getEpistemicOrgContext(userId));
    }

    const reasoningJson = ir != null ? JSON.stringify(ir) : null;

    let confidence = 0.8;
    if (ir && typeof ir === "object" && Number(ir.institutional_version) >= 3) {
      const computed = ir.epistemic_derivation?.computed_confidence_0_1;
      if (typeof computed === "number") confidence = computed;
      else if (typeof ir.confidence_0_1 === "number") confidence = ir.confidence_0_1;
    } else if (typeof data.confidence === "number") {
      confidence = data.confidence;
    } else if (ir && typeof ir.confidence_0_1 === "number") {
      confidence = ir.confidence_0_1;
    }

    this.db.prepare(`
      INSERT INTO decision_ledger (
        id, user_id, fingerprint, vow, expected_outcomes, constraints, reversal_conditions, confidence, status, decision_reasoning
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)
    `).run(
      id, userId, fingerprint, data.vow || "Unspecified Vow",
      JSON.stringify(data.expected_outcomes || []),
      JSON.stringify(data.constraints || []),
      data.reversal_conditions || null,
      confidence,
      reasoningJson,
    );

    this.logAudit('DECISION_CREATED', 'Initial decision capture', id);
    this.upsertDecisionFts({
      decisionId: id,
      vow: data.vow || "Unspecified Vow",
      expectedOutcomes: JSON.stringify(data.expected_outcomes || []),
      constraints: JSON.stringify(data.constraints || []),
      userId,
    });

    // EXECUTION OBJECT CREATION
    if (data.tasks && Array.isArray(data.tasks)) {
      for (const t of data.tasks) {
        this.saveExecutionTask({
           decision_id: id,
           ...t
        }, true);
      }
    }

    this.invokeLedgerAuditor({ type: "decision", decisionId: id });
    return id;
  }

  transitionDecisionState(id: string, newState: string, reason: string = 'System state change') {
    const current = this.db.prepare("SELECT * FROM decision_ledger WHERE id = ?").get(id) as
      | { user_id: string; status: string }
      | undefined;
    if (!current) throw new Error("Decision not found.");

    if (newState === "ACTIVE") {
      const other = this.findOtherActiveDecision(current.user_id || "system", id);
      if (other) {
        this.logAudit(
          "DECISION_CONFLICT_BLOCKED",
          `Another ACTIVE decision exists (${other.id}); at most one ACTIVE decision per user.`,
          id
        );
        throw new Error(
          `CONFLICT: Cannot activate while decision ${other.id} is ACTIVE for this user.`
        );
      }
    }

    this.db.prepare(`
      UPDATE decision_ledger SET status = ?, last_update = CURRENT_TIMESTAMP WHERE id = ?
    `).run(newState, id);

    this.logAudit('DECISION_TRANSITION', `New State: ${newState} | ${reason}`, id);

    // If decision is KILLED, kill all pending tasks
    if (newState === 'KILLED') {
        this.db.prepare("UPDATE execution_ledger SET status = 'KILLED' WHERE decision_id = ? AND status IN ('PENDING', 'ACTIVE', 'BLOCKED')").run(id);
    }

    this.invokeLedgerAuditor({ type: "decision", decisionId: id });
  }

  saveExecutionTask(data: any, skipAuditorHook = false) {
    const taskId = data.task_id || uuidv4();
    this.db.prepare(`
      INSERT INTO execution_ledger (
        task_id, decision_id, parent_task_id, owner, type, priority, weight, status,
        dependencies, success_condition, failure_condition
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `).run(
      taskId, data.decision_id, data.parent_task_id || null, data.owner || 'system',
      data.type || 'ACTION', data.priority || 3, data.weight || 1.0,
      JSON.stringify(data.dependencies || []),
      data.success_condition || null, data.failure_condition || null
    );
    this.logAudit('TASK_SPAWNED', `Type: ${data.type || 'ACTION'}`, taskId);
    {
      const tenantRow = this.db
        .prepare(`SELECT user_id FROM decision_ledger WHERE id = ?`)
        .get(data.decision_id) as { user_id: string } | undefined;
      this.upsertExecutionFts({
        taskId,
        successCondition: data.success_condition || null,
        failureCondition: data.failure_condition || null,
        decisionId: data.decision_id,
        userId: tenantRow?.user_id || "system",
      });
    }
    if (!skipAuditorHook) {
      this.invokeLedgerAuditor({ type: "execution", taskId });
    }
    return taskId;
  }

  // --- Reputation & Capacity ---
  getOwnerCapacity(owner: string) {
    const rep = this.db.prepare("SELECT * FROM owner_reputation WHERE owner = ?").get(owner);
    if (!rep) return { capacity: 3.0, reputation_modifier: 1.0, is_locked: false };

    return {
       capacity: 3.0 * rep.reputation_modifier,
       reputation_modifier: rep.reputation_modifier,
       is_locked: rep.is_locked === 1,
       failed: rep.failed_executions,
       success: rep.successful_executions
    };
  }

  // --- The Enforcement Gate (Auditor Logic) ---
  transitionExecutionState(
    taskId: string,
    newState: string,
    reason: string = "State update",
    skipAuditorHook = false,
  ) {
    const task = this.db.prepare("SELECT * FROM execution_ledger WHERE task_id = ?").get(taskId);
    if (!task) throw new Error("Task not found.");

    if (newState === 'ACTIVE') {
        const { capacity, is_locked } = this.getOwnerCapacity(task.owner);
        const reasons = [];

        if (is_locked) reasons.push("owner_locked");

        // 1. Dependency Check
        const deps = JSON.parse(task.dependencies || '[]');
        for (const depId of deps) {
            const depTask = this.db.prepare("SELECT status FROM execution_ledger WHERE task_id = ?").get(depId);
            if (!depTask || depTask.status !== 'DONE') {
                reasons.push(`dependency_incomplete:${depId}`);
            }
        }

        // 2. Capacity Check (All ACTIVE tasks overlap)
        const activeTasks = this.db.prepare("SELECT sum(weight) as total_weight FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'").get(task.owner);
        const currentLoad = activeTasks?.total_weight || 0;
        
        if (task.type !== 'KILL' && (currentLoad + task.weight) > capacity) {
            reasons.push("capacity_exceeded");
        }

        if (reasons.length > 0) {
            this.db.prepare("UPDATE execution_ledger SET status = 'BLOCKED', blocked_reasons = ? WHERE task_id = ?").run(JSON.stringify(reasons), taskId);
            this.logAudit('TASK_BLOCKED', reasons.join(', '), taskId);
            if (!skipAuditorHook) {
              this.invokeLedgerAuditor({ type: "execution", taskId });
            }
            return { status: 'BLOCKED', reasons };
        }

        // Pass: Move to ACTIVE
        this.db.prepare("UPDATE execution_ledger SET status = 'ACTIVE', started_at = CURRENT_TIMESTAMP WHERE task_id = ?").run(taskId);
    } else {
        this.db.prepare("UPDATE execution_ledger SET status = ?, last_update = CURRENT_TIMESTAMP WHERE task_id = ?").run(newState, taskId);
        if (newState === 'DONE') {
            this.db.prepare("UPDATE execution_ledger SET completed_at = CURRENT_TIMESTAMP WHERE task_id = ?").run(taskId);
        }
    }

    this.logAudit('TASK_TRANSITION', `New State: ${newState} | ${reason}`, taskId);

    // --- Reward/Penalty & Recovery Loop ---
    if (newState === 'DONE') {
        this.db.prepare("INSERT OR IGNORE INTO owner_reputation (owner) VALUES (?)").run(task.owner);
        this.db.prepare("UPDATE owner_reputation SET successful_executions = successful_executions + 1 WHERE owner = ?").run(task.owner);
        
        // Recovery: 3 successes -> reputation +0.1
        const rep = this.db.prepare("SELECT successful_executions, reputation_modifier FROM owner_reputation WHERE owner = ?").get(task.owner);
        if (rep && rep.successful_executions >= 3) {
            this.db.prepare("UPDATE owner_reputation SET successful_executions = 0, reputation_modifier = MIN(1.0, reputation_modifier + 0.1), is_locked = 0 WHERE owner = ?").run(task.owner);
            this.logAudit('REPUTATION_RECOVERED', '3 consecutive successes', task.owner);
        }
    } else if (newState === 'KILLED' && task.status === 'ACTIVE') {
        // Only ACTIVE tasks can be killed per rule 2.1
        this.db.prepare("INSERT OR IGNORE INTO owner_reputation (owner) VALUES (?)").run(task.owner);
        this.db.prepare("UPDATE owner_reputation SET failed_executions = failed_executions + 1, reputation_modifier = MAX(0.2, reputation_modifier - 0.1) WHERE owner = ?").run(task.owner);
        this.logAudit('REPUTATION_PENALIZED', 'Task killed', task.owner);
    }

    if (!skipAuditorHook) {
      this.invokeLedgerAuditor({ type: "execution", taskId });
    }
    return { status: newState };
  }

  // --- Interaction Persistence ---
  saveMessage(userId: string, role: string, content: string, msgId: string | null = null, sessionId: string = 'default') {
    const id = msgId || uuidv4();
    this.db.prepare(`
      INSERT INTO messages (id, user_id, session_id, role, content)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, sessionId, role, content);
  }

  getRecentMessages(userId: string, sessionId: string = 'default', limit: number = 10) {
    return this.db.prepare(`
      SELECT * FROM messages WHERE user_id = ? AND session_id = ? 
      ORDER BY timestamp DESC LIMIT ?
    `).all(userId, sessionId, limit).reverse();
  }

  // --- System Logs ---
  log(userId: string, source: string, message: string) {
    console.log(`[DB LOG: ${source}] ${message}`);
  }

  getUsageStats(userId: string) {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM decision_ledger WHERE user_id = ?").get(userId);
    const activeTasks = this.db.prepare("SELECT COUNT(*) as count FROM execution_ledger WHERE status = 'ACTIVE'").get().count;
    
    return {
      decisionsCount: row.count,
      activeTasks: activeTasks,
      systemStatus: activeTasks > 0 ? 'ENFORCING' : 'IDLE'
    };
  }

  // --- Sessions (opaque cookie tokens) ---
  createUserSession(params: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAtIso: string;
    userAgent: string | null;
    ip: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, user_agent, ip)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.id,
        params.userId,
        params.tokenHash,
        params.expiresAtIso,
        params.userAgent,
        params.ip
      );
  }

  getSessionByTokenHash(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT id, user_id, expires_at, revoked_at FROM user_sessions WHERE token_hash = ?`
      )
      .get(tokenHash) as
      | { id: string; user_id: string; expires_at: string; revoked_at: string | null }
      | undefined;
  }

  touchSession(sessionId: string) {
    this.db
      .prepare(`UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(sessionId);
  }

  revokeSession(sessionId: string, userId: string) {
    const r = this.db
      .prepare(
        `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
      )
      .run(sessionId, userId);
    return r.changes > 0;
  }

  revokeAllUserSessions(userId: string, exceptSessionId?: string) {
    if (exceptSessionId) {
      this.db
        .prepare(
          `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND revoked_at IS NULL AND id != ?`
        )
        .run(userId, exceptSessionId);
    } else {
      this.db
        .prepare(
          `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`
        )
        .run(userId);
    }
  }

  listUserSessions(userId: string) {
    return this.db
      .prepare(
        `SELECT id, created_at, expires_at, last_seen_at, user_agent, ip, revoked_at
         FROM user_sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 50`
      )
      .all(userId) as {
      id: string;
      created_at: string;
      expires_at: string;
      last_seen_at: string;
      user_agent: string | null;
      ip: string | null;
      revoked_at: string | null;
    }[];
  }

  // --- User API tokens (Bearer hx_live_...) ---
  createApiAccessToken(userId: string, name: string, tokenPrefix: string, tokenHash: string) {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO api_access_tokens (id, user_id, name, token_prefix, token_hash)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, userId, name, tokenPrefix, tokenHash);
    return id;
  }

  listApiAccessTokens(userId: string) {
    return this.db
      .prepare(
        `SELECT id, name, token_prefix, created_at, last_used_at, revoked_at
         FROM api_access_tokens WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(userId) as {
      id: string;
      name: string;
      token_prefix: string;
      created_at: string;
      last_used_at: string | null;
      revoked_at: string | null;
    }[];
  }

  revokeApiAccessToken(tokenId: string, userId: string) {
    const r = this.db
      .prepare(
        `UPDATE api_access_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
      )
      .run(tokenId, userId);
    return r.changes > 0;
  }

  getApiAccessTokenByHash(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT id, user_id, revoked_at FROM api_access_tokens WHERE token_hash = ?`
      )
      .get(tokenHash) as { id: string; user_id: string; revoked_at: string | null } | undefined;
  }

  touchApiAccessToken(tokenId: string) {
    this.db
      .prepare(`UPDATE api_access_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(tokenId);
  }

  updateUserPasswordHash(userId: string, passwordHash: string) {
    const r = this.db
      .prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
      .run(passwordHash, userId);
    return r.changes > 0;
  }

  getUserPasswordHash(userId: string) {
    const row = this.db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId) as
      | { password_hash: string }
      | undefined;
    return row?.password_hash ?? null;
  }

  /** Decision owner user_id or undefined if missing. */
  getDecisionTenant(decisionId: string) {
    const row = this.db
      .prepare(`SELECT user_id FROM decision_ledger WHERE id = ?`)
      .get(decisionId) as { user_id: string } | undefined;
    return row?.user_id;
  }

  getExecutionTenantForTask(taskId: string) {
    const row = this.db
      .prepare(
        `SELECT d.user_id FROM execution_ledger e INNER JOIN decision_ledger d ON e.decision_id = d.id WHERE e.task_id = ?`
      )
      .get(taskId) as { user_id: string } | undefined;
    return row?.user_id;
  }

  getSignalTenant(signalId: string) {
    const row = this.db.prepare(`SELECT user_id FROM external_signals WHERE id = ?`).get(signalId) as
      | { user_id: string }
      | undefined;
    return row?.user_id;
  }
}

/**
 * FTS5 query strings must avoid bare unsafe punctuation. We tokenize on whitespace,
 * strip non-word chars, and quote every term so reserved words (AND/OR/NEAR/...) cannot
 * blow up the parser. Empty result means "do not run this query".
 */
function sanitizeFtsQuery(raw: string): string {
  const cleaned = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 64);
  if (cleaned.length === 0) return "";
  return cleaned.map((t) => `"${t}"`).join(" OR ");
}

export const db = new HustronixDB();
