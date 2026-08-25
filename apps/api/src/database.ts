import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import type { AuditorWriteContext } from "./auditor-context.js";
import { attachEpistemicDerivation, type EpistemicOrgContext } from "./epistemic-engine.js";
import { config } from "./config.js";
import { ensureSecuritySchema } from "./security/security-schema.js";
import { ensureV8EnterpriseSchema } from "./security/v8-schema.js";
import { ensureV9TrustSchema } from "./security/v9-schema.js";
import { ensureEntitySchema } from "./entities/schema.js";
import { ensureStateSchema } from "./state/schema.js";
import { ensureBeliefSchema } from "./beliefs/schema.js";
import { ensureSimulationSchema } from "./simulation/schema.js";
import { onDecisionTerminalState } from "./evaluation/outcome-evaluation.js";
import { ensureReconciliationSchema } from "./reconciliation/schema.js";
import { seedGlobalAuthorityRules } from "./reconciliation/authority.js";
import { ensureClarificationSchema } from "./clarification/schema.js";
import { ensureActionLedgerSchema } from "./execution/orchestrator/schema.js";
import { ensureOrgIntelligenceSchema } from "./org/schema.js";
import { ensureSituationSchema, migrateSituationIdentity, migrateSituationFingerprint } from "./intelligence/situation-schema.js";
import { ensureSituationGraphSchema } from "./intelligence/situation-graph.js";
import { ensureSignalProcessingSchema } from "./intelligence/signal-processing.js";
import { ensureOsEngineRunsSchema } from "./intelligence/os-observability.js";
import { ensureTalkObservabilitySchema } from "./intelligence/talk/talk-observability.js";
import { availableHours, evaluateHoursActivation, hoursUntilDue, taskEffortHours } from "./execution/capacity-hours.js";

function resolveSqlitePath(): string {
  const configured = config.storage.dbPath.trim();
  const dbPath = path.isAbsolute(configured)
    ? configured
    : path.resolve(config.paths.repoRoot, configured);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  return dbPath;
}

export class HustronixDB {
  private db: any;
  private ledgerAuditorHook: ((ctx: AuditorWriteContext) => void) | null = null;

  constructor() {
    const dbPath = resolveSqlitePath();
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
      -- source enum is intentionally broad so every connector can store
      -- with high-fidelity provenance. source_subtype (added by migration)
      -- carries the granular event name (e.g. microsoft.outlook.mail.created).
      CREATE TABLE IF NOT EXISTS external_signals (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT 'system',
        source TEXT CHECK(source IN ('GITHUB', 'SLACK', 'JIRA', 'MICROSOFT', 'GOOGLE', 'GMAIL', 'NOTION', 'LINEAR', 'MANUAL', 'CRM', 'MEETING', 'INCIDENT', 'HRIS', 'FINANCE')),
        content TEXT,
        owner TEXT,
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        grace_expires_at DATETIME, -- Deterministic countdown from received_at
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
        device_fingerprint TEXT,
        suspicious_reason TEXT,
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

      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
        user_id TEXT,
        auth_kind TEXT,
        ip TEXT,
        user_agent TEXT,
        request_id TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_security_events_user_time
        ON security_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_security_events_type_time
        ON security_events(event_type, created_at);

      CREATE TABLE IF NOT EXISTS ledger_events (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL CHECK(aggregate_type IN ('decision', 'execution', 'signal', 'capability')),
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'agent', 'service', 'system')),
        actor_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        capability_id TEXT,
        causation_event_id TEXT,
        correlation_id TEXT NOT NULL,
        previous_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE,
        signature TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_events_aggregate
        ON ledger_events(org_id, aggregate_type, aggregate_id, created_at);
    `);
    this.ensureDecisionLedgerColumns();
    this.ensureDecisionReasoningColumn();
    this.ensureTenantColumns();
    this.ensureOrgIdColumns();
    this.ensureOwnerReputationColumns();
    this.ensureExecutionLedgerIntelligenceColumns();
    this.ensureLearningLogColumns();
    this.ensureExecutionIntelligenceSchema();
    this.ensureOAuthTables();
    this.ensureSocialAuthTables();
    this.ensureEmailOtpTables();
    this.ensureTotpAuthSchema();
    this.ensureUsersEmailSchema();
    this.ensureSessionSecurityColumns();
    this.ensureIntelligenceSchema();
    this.ensureTeamRosterSchema();
    ensureOrgIntelligenceSchema((sql) => this.db.exec(sql));
    ensureSituationSchema((sql) => this.db.exec(sql));
    ensureSituationGraphSchema((sql) => this.db.exec(sql));
    ensureSignalProcessingSchema((sql) => this.db.exec(sql));
    ensureOsEngineRunsSchema((sql) => this.db.exec(sql));
    ensureTalkObservabilitySchema((sql) => this.db.exec(sql));
    migrateSituationIdentity(this.db);
    migrateSituationFingerprint(this.db);
    this.ensureHardeningIndexes();
    this.ensureNotificationsSchema();
    ensureClarificationSchema((sql) => this.db.exec(sql));
    ensureActionLedgerSchema((sql) => this.db.exec(sql));
    this.ensureEarlyAccessSchema();
    this.ensureMarketingContactSchema();
    this.ensureSecuritySchemaV7();
  }

  private ensureHardeningIndexes() {
    const stmts = [
      `CREATE INDEX IF NOT EXISTS idx_signals_user_received ON external_signals(user_id, received_at)`,
      `CREATE INDEX IF NOT EXISTS idx_signals_user_detected ON external_signals(user_id, detected_at)`,
      `CREATE INDEX IF NOT EXISTS idx_situation_evidence_sit_sig ON situation_evidence(situation_id, signal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_situations_user_pattern_entity ON situations(user_id, pattern_id, primary_entity_key)`,
      `CREATE INDEX IF NOT EXISTS idx_org_deps_user_teams ON org_dependencies(user_id, from_team, to_team)`,
    ];
    for (const sql of stmts) {
      try {
        this.db.exec(sql);
      } catch {
        /* table may not exist yet */
      }
    }
  }

  private ensureSecuritySchemaV7() {
    const ensureColumn = (table: string, name: string, ddl: string) => {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
      } catch {
        /* already exists */
      }
    };
    ensureSecuritySchema((sql) => this.db.exec(sql), ensureColumn);
    ensureV8EnterpriseSchema((sql) => this.db.exec(sql), ensureColumn);
    ensureV9TrustSchema((sql) => this.db.exec(sql), ensureColumn);
    ensureEntitySchema((sql) => this.db.exec(sql));
    ensureStateSchema((sql) => this.db.exec(sql));
    ensureBeliefSchema((sql) => this.db.exec(sql));
    ensureSimulationSchema((sql) => this.db.exec(sql));
    ensureEntitySchema((sql) => this.db.exec(sql));
    ensureStateSchema((sql) => this.db.exec(sql));
    ensureReconciliationSchema((sql) => this.db.exec(sql));
    try {
      seedGlobalAuthorityRules();
    } catch {
      /* seed best-effort on boot */
    }

    /** Backfill lifecycle_state from legacy status. */
    try {
      this.db.exec(`
        UPDATE decision_ledger SET lifecycle_state = CASE status
          WHEN 'DRAFT' THEN 'PROPOSED'
          WHEN 'REVERSED' THEN 'REVOKED'
          ELSE status
        END
        WHERE lifecycle_state IS NULL OR lifecycle_state = ''
      `);
    } catch {
      /* ignore */
    }
  }

  private ensureMarketingContactSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketing_contact_messages (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        company TEXT,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'landing',
        ip TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_marketing_contact_created
        ON marketing_contact_messages (created_at DESC);
    `);
  }

  private ensureEarlyAccessSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS early_access_leads (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        company TEXT,
        role TEXT,
        source TEXT NOT NULL DEFAULT 'landing',
        ip TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_early_access_email_lower
        ON early_access_leads (LOWER(email));
    `);
  }

  /** In-app + digest notification rows (per-user). */
  private ensureNotificationsSchema() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          link_url TEXT,
          payload_json TEXT,
          delivered_in_app INTEGER NOT NULL DEFAULT 0,
          delivered_email INTEGER NOT NULL DEFAULT 0,
          delivered_slack INTEGER NOT NULL DEFAULT 0,
          read_at TEXT,
          digest_sent_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
      `);
    } catch (e) {
      console.warn("[DB] ensureNotificationsSchema:", e);
    }
  }

  /** Optional roster rows for /teams — scoped by `user_id` (creator), like `external_signals`. */
  private ensureTeamRosterSchema() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS team_roster (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'Member',
          team TEXT NOT NULL DEFAULT 'General',
          capacity TEXT NOT NULL DEFAULT '40h / week',
          slack_id TEXT,
          talent_tier TEXT,
          reports_to TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, email)
        );
        CREATE INDEX IF NOT EXISTS idx_team_roster_user ON team_roster(user_id);
      `);
    } catch (e) {
      console.warn("[DB] ensureTeamRosterSchema:", e);
    }
  }

  private ensureSessionSecurityColumns() {
    try {
      const cols = this.db.prepare("PRAGMA table_info(user_sessions)").all() as { name: string }[];
      const have = (name: string) => cols.some((c) => c.name === name);
      if (!have("device_fingerprint")) {
        this.db.exec("ALTER TABLE user_sessions ADD COLUMN device_fingerprint TEXT");
      }
      if (!have("suspicious_reason")) {
        this.db.exec("ALTER TABLE user_sessions ADD COLUMN suspicious_reason TEXT");
      }
    } catch (e) {
      console.warn("[DB] ensureSessionSecurityColumns:", e);
    }
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
      if (!haveCol("received_at")) {
        this.db.exec("ALTER TABLE external_signals ADD COLUMN received_at DATETIME");
        this.db.exec("UPDATE external_signals SET received_at = CURRENT_TIMESTAMP WHERE received_at IS NULL");
        /** Recompute grace from ingest clock; unkill HSOG replay rows killed by event-time grace. */
        this.db.exec(
          `UPDATE external_signals SET grace_expires_at = NULL WHERE state IN ('UNVERIFIED', 'GRACE')`,
        );
        this.db.exec(
          `UPDATE external_signals
           SET state = 'UNVERIFIED', grace_expires_at = NULL
           WHERE state = 'KILLED'
             AND json_extract(ingest_meta, '$.integration_runtime') IN ('hsog', 'hsog-provider')`,
        );
      }
      /**
       * Corpus evidence re-killed after received_at grace: restore so Signals UI / HSOG grade
       * keep ledger rows. Auditor holds these as GRACE instead of KILLED going forward.
       */
      this.db.exec(
        `UPDATE external_signals
         SET state = 'GRACE', grace_expires_at = COALESCE(grace_expires_at, CURRENT_TIMESTAMP)
         WHERE state = 'KILLED'
           AND (
             json_extract(ingest_meta, '$.integration_runtime') LIKE 'hsog%'
             OR json_extract(ingest_meta, '$.hsog_scenario_id') IS NOT NULL
             OR IFNULL(external_id, '') LIKE 'hsog:%'
           )`,
      );
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_signals_external_id ON external_signals(source, external_id)`,
      );

      /**
       * Source CHECK expansion. SQLite can't ALTER CHECK; rebuild when CRM/MEETING
       * buckets are missing. Copies every existing column (including org_id / received_at).
       */
      const masterRow = this.db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='external_signals'")
        .get() as { sql?: string } | undefined;
      const ddl = String(masterRow?.sql || "");
      const hasOpsBuckets = /'CRM'/.test(ddl) && /'MEETING'/.test(ddl);
      if (ddl && !hasOpsBuckets) {
        this.rebuildExternalSignalsForExpandedSourceEnum();
      }
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

  /**
   * One-shot, idempotent rebuild of `external_signals` to expand the source
   * CHECK constraint. Triggered by `ensureIntelligenceSchema` only when the
   * legacy DDL is detected. Atomic: wrapped in a transaction; on failure the
   * legacy table remains and the next process restart retries.
   */
  private rebuildExternalSignalsForExpandedSourceEnum() {
    console.log("[DB] migrating external_signals to expanded source enum...");
    const sourceIn =
      `'GITHUB', 'SLACK', 'JIRA', 'MICROSOFT', 'GOOGLE', 'GMAIL', 'NOTION', 'LINEAR', 'MANUAL', 'CRM', 'MEETING', 'INCIDENT', 'HRIS', 'FINANCE'`;
    const tx = this.db.transaction(() => {
      const cols = this.db
        .prepare("PRAGMA table_info(external_signals)")
        .all() as { name: string; notnull?: number; dflt_value?: string | null; type: string; pk?: number }[];
      const colNames = cols.map((c) => c.name);
      const colDefs = cols.map((c) => {
        if (c.name === "source") return `source TEXT CHECK(source IN (${sourceIn}))`;
        const type = c.type || "TEXT";
        if (c.pk) return `${c.name} ${type} PRIMARY KEY`;
        let def = `${c.name} ${type}`;
        if (c.notnull) def += " NOT NULL";
        if (c.dflt_value != null && String(c.dflt_value) !== "") def += ` DEFAULT ${c.dflt_value}`;
        return def;
      });

      this.db.exec(`CREATE TABLE external_signals__new (\n  ${colDefs.join(",\n  ")}\n);`);
      const copyCols = colNames.join(", ");
      this.db.exec(
        `INSERT INTO external_signals__new (${copyCols}) SELECT ${copyCols} FROM external_signals;`,
      );
      this.db.exec("DROP TABLE external_signals;");
      this.db.exec("ALTER TABLE external_signals__new RENAME TO external_signals;");
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_signals_external_id ON external_signals(source, external_id);`,
      );
    });
    try {
      tx();
      console.log("[DB] external_signals rebuild complete (expanded source enum).");
    } catch (e) {
      console.error("[DB] external_signals rebuild FAILED:", e);
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
  getActiveDecisions(userId: string, limit = 12) {
    return this.db
      .prepare(
        `SELECT id, vow, expected_outcomes, constraints, reversal_conditions, confidence, status, created_at
           FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'
           ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, limit) as {
      id: string;
      vow: string;
      expected_outcomes: string;
      constraints: string;
      reversal_conditions: string | null;
      confidence: number;
      status: string;
      created_at: string;
    }[];
  }

  /** Most recently created ACTIVE vow (compat). Prefer {@link getActiveDecisions}. */
  getActiveDecision(userId: string) {
    return this.getActiveDecisions(userId, 1)[0];
  }

  getActiveExecutions(userId: string, limit = 50) {
    return this.db
      .prepare(
        `SELECT e.task_id, e.decision_id, e.owner, e.type, e.weight, e.status,
                e.success_condition, e.failure_condition, e.last_update,
                d.vow as decision_vow
           FROM execution_ledger e
           INNER JOIN decision_ledger d ON e.decision_id = d.id
           WHERE d.user_id = ? AND d.status != 'DRAFT'
             AND e.status IN ('PENDING', 'ACTIVE', 'BLOCKED')
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

  /** One-shot backfill — skip when already populated so boot/auth are not blocked. */
  rebuildFtsFromLedger() {
    try {
      const force = process.env.HUSTRONIX_REBUILD_FTS === "1";
      const signalCount = (
        this.db
          .prepare(`SELECT count(*) as c FROM external_signals WHERE content IS NOT NULL`)
          .get() as { c: number }
      ).c;
      const ftsCount = (this.db.prepare(`SELECT count(*) as c FROM signals_fts`).get() as { c: number }).c;
      // Full truncate+rebuild blocks SQLite (and sign-in) on large ledgers. Incremental
      // upserts keep FTS current; only rebuild when empty and small, or when forced.
      if (!force && (ftsCount > 0 || signalCount > 2000)) {
        return { skipped: true, ftsCount, signalCount };
      }
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
   * Scoped single-entity embedding read. Replaces the per-call scan that
   * `listEmbeddingsForUser` does when callers only need one row (signal
   * vector lookup in autoLinker, etc.).
   */
  getEmbeddingForEntity(
    entityType: "signal" | "execution" | "decision",
    entityId: string,
  ): Float32Array | null {
    const row = this.db
      .prepare(`SELECT vector, dim FROM entity_embeddings WHERE entity_type = ? AND entity_id = ?`)
      .get(entityType, entityId) as { vector: Buffer; dim: number } | undefined;
    if (!row) return null;
    return new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dim);
  }

  /**
   * Scoped multi-entity embedding read. Returns a Map keyed by entityId.
   * Used by autoLinker to fetch only the shortlisted execution embeddings
   * instead of scanning every embedding in the tenant.
   */
  getEmbeddingsForEntities(
    entityType: "signal" | "execution" | "decision",
    entityIds: string[],
  ): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>();
    if (entityIds.length === 0) return out;
    const placeholders = entityIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT entity_id, vector, dim FROM entity_embeddings
           WHERE entity_type = ? AND entity_id IN (${placeholders})`,
      )
      .all(entityType, ...entityIds) as { entity_id: string; vector: Buffer; dim: number }[];
    for (const r of rows) {
      out.set(r.entity_id, new Float32Array(r.vector.buffer, r.vector.byteOffset, r.dim));
    }
    return out;
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

  /** execution_ledger columns for EIE duration / attribution features. */
  private ensureExecutionLedgerIntelligenceColumns() {
    try {
      const cols = this.db.prepare("PRAGMA table_info(execution_ledger)").all() as { name: string }[];
      if (cols.length === 0) return;
      if (!cols.some((c) => c.name === "estimated_duration_hours")) {
        this.db.exec("ALTER TABLE execution_ledger ADD COLUMN estimated_duration_hours REAL");
      }
      if (!cols.some((c) => c.name === "attribution")) {
        this.db.exec("ALTER TABLE execution_ledger ADD COLUMN attribution TEXT");
      }
      if (!cols.some((c) => c.name === "due_at")) {
        this.db.exec("ALTER TABLE execution_ledger ADD COLUMN due_at TEXT");
      }
    } catch (e) {
      console.warn("[DB] ensureExecutionLedgerIntelligenceColumns:", e);
    }
  }

  private ensureLearningLogColumns() {
    try {
      const cols = this.db.prepare("PRAGMA table_info(learning_log)").all() as { name: string }[];
      if (cols.length === 0) return;
      if (!cols.some((c) => c.name === "kind")) {
        this.db.exec("ALTER TABLE learning_log ADD COLUMN kind TEXT");
      }
      if (!cols.some((c) => c.name === "idempotency_key")) {
        this.db.exec("ALTER TABLE learning_log ADD COLUMN idempotency_key TEXT");
      }
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_log_idem ON learning_log(user_id, idempotency_key)",
      );
    } catch (e) {
      console.warn("[DB] ensureLearningLogColumns:", e);
    }
  }

  /** Execution Intelligence Engine — evidence, features, beliefs, predictions. */
  private ensureExecutionIntelligenceSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_evidence (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        subject_entity_type TEXT NOT NULL,
        subject_entity_id TEXT NOT NULL,
        source_entity_type TEXT,
        source_entity_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        idempotency_key TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_execution_evidence_tenant_subject
        ON execution_evidence(tenant_id, subject_entity_type, subject_entity_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_evidence_event_type
        ON execution_evidence(tenant_id, event_type);

      CREATE TABLE IF NOT EXISTS execution_features (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        feature_version TEXT NOT NULL,
        features_json TEXT NOT NULL DEFAULT '{}',
        extracted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(evidence_id) REFERENCES execution_evidence(id)
      );
      CREATE INDEX IF NOT EXISTS idx_execution_features_entity
        ON execution_features(tenant_id, entity_type, entity_id, feature_version);

      CREATE TABLE IF NOT EXISTS entity_beliefs (
        tenant_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        belief_key TEXT NOT NULL,
        model_id TEXT NOT NULL,
        mean REAL NOT NULL DEFAULT 0.5,
        variance REAL NOT NULL DEFAULT 0.25,
        n_obs INTEGER NOT NULL DEFAULT 0,
        params_json TEXT NOT NULL DEFAULT '{}',
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, entity_type, entity_id, belief_key)
      );
      CREATE INDEX IF NOT EXISTS idx_entity_beliefs_tenant_entity
        ON entity_beliefs(tenant_id, entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS execution_predictions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        prediction_type TEXT NOT NULL,
        predicted_value REAL NOT NULL,
        actual_value REAL,
        confidence REAL NOT NULL DEFAULT 0.5,
        explanation_json TEXT NOT NULL DEFAULT '[]',
        features_json TEXT NOT NULL DEFAULT '{}',
        model_version TEXT NOT NULL,
        feature_version TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        evidence_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        FOREIGN KEY(evidence_id) REFERENCES execution_evidence(id)
      );
      CREATE INDEX IF NOT EXISTS idx_execution_predictions_entity
        ON execution_predictions(tenant_id, entity_type, entity_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_predictions_algo
        ON execution_predictions(tenant_id, algorithm_version, resolved_at);
    `);
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

  /** Dedicated login email (nullable); username may be a non-email handle. */
  private ensureUsersEmailSchema() {
    try {
      const cols = this.db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      const have = (n: string) => cols.some((c) => c.name === n);
      if (!have("email")) {
        this.db.exec("ALTER TABLE users ADD COLUMN email TEXT");
        this.db.exec(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL",
        );
        this.db.exec(
          `UPDATE users SET email = LOWER(TRIM(username))
           WHERE email IS NULL AND INSTR(username, '@') > 0`,
        );
        this.db.exec(`
          INSERT OR IGNORE INTO settings (user_id, key, value)
          SELECT u.id, 'security.password_credential_set', '1' FROM users u
          WHERE u.id != 'system'
          AND NOT EXISTS (SELECT 1 FROM oauth_identities o WHERE o.user_id = u.id)
          AND (
            (INSTR(u.username, '@') > 0) OR (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0)
          )
        `);
      }
    } catch (e) {
      console.warn("[DB] ensureUsersEmailSchema:", e);
    }
  }

  private ensureTotpAuthSchema() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS login_totp_challenges (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at DATETIME NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          consumed_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_login_totp_user ON login_totp_challenges(user_id);
      `);
    } catch (e) {
      console.warn("[DB] login_totp_challenges:", e);
    }
    try {
      const cols = this.db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      const have = (n: string) => cols.some((c) => c.name === n);
      if (!have("totp_enabled"))
        this.db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
      if (!have("totp_secret_encrypted"))
        this.db.exec("ALTER TABLE users ADD COLUMN totp_secret_encrypted TEXT");
      if (!have("totp_pending_encrypted"))
        this.db.exec("ALTER TABLE users ADD COLUMN totp_pending_encrypted TEXT");
      if (!have("totp_backup_hashes"))
        this.db.exec("ALTER TABLE users ADD COLUMN totp_backup_hashes TEXT");
    } catch (e) {
      console.warn("[DB] ensureTotpAuthSchema users columns:", e);
    }
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

  /** Drop unconsumed signup OTP rows for this mailbox so a new code is the only active one. */
  deleteOpenSignupOtpForEmail(emailNorm: string) {
    this.db
      .prepare(
        `DELETE FROM email_otp_challenges
         WHERE purpose = 'signup' AND consumed_at IS NULL AND lower(trim(username)) = ?`,
      )
      .run(emailNorm);
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

  getUserTotpRow(userId: string) {
    return this.db
      .prepare(
        `SELECT id, username, totp_enabled, totp_secret_encrypted, totp_pending_encrypted, totp_backup_hashes
         FROM users WHERE id = ?`,
      )
      .get(userId) as
      | {
          id: string;
          username: string;
          totp_enabled: number;
          totp_secret_encrypted: string | null;
          totp_pending_encrypted: string | null;
          totp_backup_hashes: string | null;
        }
      | undefined;
  }

  setUserTotpPendingEncrypted(userId: string, enc: string | null) {
    this.db.prepare(`UPDATE users SET totp_pending_encrypted = ? WHERE id = ?`).run(enc, userId);
  }

  activateUserTotpFromPending(userId: string, backupHashesJson: string) {
    const r = this.db
      .prepare(
        `UPDATE users SET totp_enabled = 1, totp_secret_encrypted = totp_pending_encrypted, totp_pending_encrypted = NULL, totp_backup_hashes = ?
         WHERE id = ? AND totp_pending_encrypted IS NOT NULL`,
      )
      .run(backupHashesJson, userId);
    return r.changes > 0;
  }

  disableUserTotp(userId: string) {
    this.db
      .prepare(
        `UPDATE users SET totp_enabled = 0, totp_secret_encrypted = NULL, totp_pending_encrypted = NULL, totp_backup_hashes = NULL WHERE id = ?`,
      )
      .run(userId);
  }

  updateUserTotpBackupHashes(userId: string, json: string | null) {
    this.db.prepare(`UPDATE users SET totp_backup_hashes = ? WHERE id = ?`).run(json, userId);
  }

  deleteExpiredLoginTotpChallenges() {
    this.db.prepare(`DELETE FROM login_totp_challenges WHERE expires_at < datetime('now')`).run();
  }

  deleteOpenLoginTotpChallengesForUser(userId: string) {
    this.db
      .prepare(`DELETE FROM login_totp_challenges WHERE user_id = ? AND consumed_at IS NULL`)
      .run(userId);
  }

  insertLoginTotpChallenge(params: { tokenHash: string; userId: string; expiresAtIso: string }) {
    this.db
      .prepare(
        `INSERT INTO login_totp_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
      )
      .run(params.tokenHash, params.userId, params.expiresAtIso);
  }

  getLoginTotpChallenge(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT token_hash, user_id, expires_at, attempts, consumed_at FROM login_totp_challenges WHERE token_hash = ?`,
      )
      .get(tokenHash) as
      | {
          token_hash: string;
          user_id: string;
          expires_at: string;
          attempts: number;
          consumed_at: string | null;
        }
      | undefined;
  }

  incrementLoginTotpAttempts(tokenHash: string) {
    this.db
      .prepare(`UPDATE login_totp_challenges SET attempts = attempts + 1 WHERE token_hash = ?`)
      .run(tokenHash);
  }

  consumeLoginTotpChallenge(tokenHash: string) {
    this.db
      .prepare(
        `UPDATE login_totp_challenges SET consumed_at = datetime('now') WHERE token_hash = ? AND consumed_at IS NULL`,
      )
      .run(tokenHash);
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

  /** Lowercase slug for handle segments (email local-part, org name). */
  slugHandleSegment(raw: string, maxLen: number): string {
    const s = String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxLen)
      .replace(/-+$/g, "");
    return s || "";
  }

  isUsernameTaken(username: string, excludeUserId?: string | null): boolean {
    const row = excludeUserId
      ? (this.db
          .prepare(`SELECT 1 FROM users WHERE username = ? AND id != ?`)
          .get(username, excludeUserId) as { 1?: number } | undefined)
      : (this.db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username) as { 1?: number } | undefined);
    return Boolean(row);
  }

  /**
   * System-allocated login handle: email local-part + optional org slug.
   * Collisions: base-2 … base-10, then base + short hex nonce.
   */
  allocateUsername(opts: { email: string; orgName?: string | null; excludeUserId?: string | null }): string {
    const at = String(opts.email || "").indexOf("@");
    const localRaw = at > 0 ? opts.email.slice(0, at) : opts.email;
    let local = this.slugHandleSegment(localRaw, 24);
    if (!local) local = "user";
    const orgSlug = this.slugHandleSegment(String(opts.orgName || "").trim(), 24);
    const baseRaw = orgSlug ? `${local}-${orgSlug}` : local;
    let base = baseRaw.slice(0, 56);
    if (!base) base = "user";
    const exclude = opts.excludeUserId ?? null;
    for (let i = 0; i < 10; i += 1) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      if (!this.isUsernameTaken(candidate, exclude)) return candidate.slice(0, 56);
    }
    for (let k = 0; k < 8; k += 1) {
      const nonce = crypto.randomBytes(2).toString("hex");
      const candidate = `${base}-${nonce}`.slice(0, 56);
      if (!this.isUsernameTaken(candidate, exclude)) return candidate;
    }
    return this.allocateUniqueUsername(`${local}-x`);
  }

  updateUsername(userId: string, username: string) {
    this.db.prepare(`UPDATE users SET username = ? WHERE id = ?`).run(username, userId);
  }

  /** After onboarding saves `org.name`, move handle to localpart-orgslug when possible. */
  refreshUsernameWithOrg(userId: string) {
    if (userId === "system") return;
    const row = this.getUserById(userId);
    if (!row) return;
    const email = (row.email && String(row.email).trim()) || "";
    if (!email.includes("@")) return;
    const orgName = this.getSetting(userId, "org.name");
    const next = this.allocateUsername({ email, orgName, excludeUserId: userId });
    if (next !== row.username) {
      this.updateUsername(userId, next);
    }
  }

  private ensureOAuthTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_pending_states (
        state TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        redirect_path TEXT
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

      CREATE TABLE IF NOT EXISTS nango_connections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        integration_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        connection_name TEXT,
        last_sync_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_nango_connections_user
        ON nango_connections(user_id);
      CREATE INDEX IF NOT EXISTS idx_nango_connections_cid
        ON nango_connections(connection_id);

      CREATE TABLE IF NOT EXISTS nango_sync_cursors (
        connection_pk TEXT NOT NULL,
        model TEXT NOT NULL,
        cursor TEXT NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (connection_pk, model)
      );

      CREATE TABLE IF NOT EXISTS slack_event_receipts (
        event_id TEXT PRIMARY KEY,
        team_id TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS oauth_subscriptions (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        kind TEXT NOT NULL,
        external_resource TEXT,
        external_subscription_id TEXT,
        expires_at DATETIME,
        last_renewed_at DATETIME,
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (connection_id) REFERENCES oauth_connections(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_subscriptions_renew
        ON oauth_subscriptions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_oauth_subscriptions_conn
        ON oauth_subscriptions(connection_id);
    `);

    /**
     * Additive migrations on `oauth_connections` — bring legacy installs (Slack-only)
     * up to the multi-provider scheme. PRAGMA + ALTER is safe-by-default on SQLite:
     * each ALTER is wrapped because better-sqlite3 throws if the column already exists.
     */
    const ensureColumn = (name: string, ddl: string) => {
      try {
        this.db.exec(`ALTER TABLE oauth_connections ADD COLUMN ${name} ${ddl}`);
      } catch {
        /* already exists */
      }
    };
    ensureColumn("access_token_encrypted", "TEXT");
    ensureColumn("refresh_token_encrypted", "TEXT");
    ensureColumn("expires_at", "DATETIME");
    ensureColumn("external_user_id", "TEXT");
    ensureColumn("connection_label", "TEXT");
    ensureColumn("revoked_at", "DATETIME");

    /** Allow the existing UNIQUE(user_id, provider, external_team_id) to coexist with
     * the new generic OAuth installs, which often have no `team_id` (single-tenant providers).
     * SQLite treats empty strings as distinct from NULL in UNIQUE — keep empty string default.
     */
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

  // -------------------------------------------------------------------------
  // Generic OAuth connection storage (used by every provider except legacy
  // Slack bot install, which keeps `upsertSlackBotInstallation` for backwards
  // compatibility). Tokens are encrypted at rest by the caller (see oauthCrypto).
  // -------------------------------------------------------------------------

  /** PKCE / CSRF state row including a post-callback redirect target. */
  createOAuthPendingStateExt(
    state: string,
    userId: string,
    provider: string,
    ttlMinutes: number,
    redirectPath: string | null,
  ) {
    const expiresAt = new Date(
      Date.now() + ttlMinutes * 60 * 1000,
    ).toISOString();
    this.db
      .prepare(
        `INSERT INTO oauth_pending_states (state, user_id, provider, expires_at, redirect_path)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(state, userId, provider, expiresAt, redirectPath);
  }

  consumeOAuthPendingStateExt(
    state: string,
  ): { user_id: string; provider: string; redirect_path: string | null } | null {
    const row = this.db
      .prepare(
        `SELECT user_id, provider, redirect_path FROM oauth_pending_states
         WHERE state = ? AND expires_at > datetime('now')`,
      )
      .get(state) as
      | { user_id: string; provider: string; redirect_path: string | null }
      | undefined;
    if (!row) return null;
    this.db.prepare(`DELETE FROM oauth_pending_states WHERE state = ?`).run(state);
    return row;
  }

  /** Insert/replace a connection. Tokens here MUST already be ciphertext. */
  upsertOAuthConnection(data: {
    userId: string;
    provider: string;
    externalTeamId: string;
    externalTeamName?: string | null;
    externalUserId?: string | null;
    connectionLabel?: string | null;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    expiresAt: string | null;
    scope: string | null;
    tokenType: string | null;
    rawInstallPayload: string;
  }): string {
    this.db
      .prepare(
        `DELETE FROM oauth_connections
         WHERE user_id = ? AND provider = ? AND external_team_id = ?`,
      )
      .run(data.userId, data.provider, data.externalTeamId || "");
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO oauth_connections (
           id, user_id, provider, external_team_id, external_team_name,
           external_user_id, connection_label,
           access_token, access_token_encrypted, refresh_token_encrypted,
           expires_at, scope, token_type, raw_install_payload, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        id,
        data.userId,
        data.provider,
        data.externalTeamId || "",
        data.externalTeamName ?? null,
        data.externalUserId ?? null,
        data.connectionLabel ?? null,
        data.accessTokenEncrypted,
        data.refreshTokenEncrypted,
        data.expiresAt,
        data.scope,
        data.tokenType,
        data.rawInstallPayload,
      );
    return id;
  }

  /** All non-revoked connections for a given user/provider pair. */
  listOAuthConnections(userId: string, provider: string) {
    return this.db
      .prepare(
        `SELECT id, user_id, provider, external_team_id, external_team_name,
                external_user_id, connection_label,
                access_token, access_token_encrypted, refresh_token_encrypted,
                expires_at, scope, token_type, created_at, updated_at
         FROM oauth_connections
         WHERE user_id = ? AND provider = ? AND revoked_at IS NULL
         ORDER BY updated_at DESC`,
      )
      .all(userId, provider) as any[];
  }

  getOAuthConnectionById(connectionId: string) {
    return (
      (this.db
        .prepare(
          `SELECT id, user_id, provider, external_team_id, external_team_name,
                  external_user_id, connection_label,
                  access_token, access_token_encrypted, refresh_token_encrypted,
                  expires_at, scope, token_type, created_at, updated_at, revoked_at
           FROM oauth_connections WHERE id = ?`,
        )
        .get(connectionId) as any) || null
    );
  }

  /** Returns the freshest connection for (user, provider). Used when we don't care which workspace. */
  getOAuthConnectionForUser(userId: string, provider: string) {
    return (
      (this.db
        .prepare(
          `SELECT id, user_id, provider, external_team_id, external_team_name,
                  external_user_id, connection_label,
                  access_token, access_token_encrypted, refresh_token_encrypted,
                  expires_at, scope, token_type, created_at, updated_at
           FROM oauth_connections
           WHERE user_id = ? AND provider = ? AND revoked_at IS NULL
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(userId, provider) as any) || null
    );
  }

  /** Lookup connection by external team id (provider-side tenant) — used by webhooks for owner resolution. */
  findOAuthConnectionByExternalTeam(provider: string, externalTeamId: string) {
    return (
      (this.db
        .prepare(
          `SELECT id, user_id, provider, external_team_id, external_team_name,
                  external_user_id, connection_label, scope, expires_at,
                  access_token, access_token_encrypted, refresh_token_encrypted,
                  token_type, updated_at
           FROM oauth_connections
           WHERE provider = ? AND external_team_id = ? AND revoked_at IS NULL
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(provider, externalTeamId) as any) || null
    );
  }

  /** Update tokens after a refresh. expiresAt is ISO or null. */
  updateOAuthConnectionTokens(
    connectionId: string,
    data: {
      accessTokenEncrypted: string;
      refreshTokenEncrypted?: string;
      expiresAt?: string | null;
      scope?: string | null;
    },
  ) {
    const parts: string[] = [
      "access_token_encrypted = ?",
      "updated_at = CURRENT_TIMESTAMP",
    ];
    const values: any[] = [data.accessTokenEncrypted];
    if (data.refreshTokenEncrypted !== undefined) {
      parts.push("refresh_token_encrypted = ?");
      values.push(data.refreshTokenEncrypted);
    }
    if (data.expiresAt !== undefined) {
      parts.push("expires_at = ?");
      values.push(data.expiresAt);
    }
    if (data.scope !== undefined) {
      parts.push("scope = ?");
      values.push(data.scope);
    }
    values.push(connectionId);
    this.db
      .prepare(`UPDATE oauth_connections SET ${parts.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  /** Soft delete — keeps audit trail, prevents new use. */
  revokeOAuthConnection(connectionId: string) {
    this.db
      .prepare(
        `UPDATE oauth_connections
         SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
             access_token_encrypted = '', refresh_token_encrypted = ''
         WHERE id = ?`,
      )
      .run(connectionId);
    this.db
      .prepare(`DELETE FROM oauth_subscriptions WHERE connection_id = ?`)
      .run(connectionId);
  }

  /** True if user has at least one live connection for this provider. */
  hasOAuthConnection(userId: string, provider: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM oauth_connections
         WHERE user_id = ? AND provider = ? AND revoked_at IS NULL LIMIT 1`,
      )
      .get(userId, provider);
    return !!row;
  }

  // ---- Webhook / change-notification subscription bookkeeping --------------

  upsertOAuthSubscription(data: {
    connectionId: string;
    userId: string;
    provider: string;
    kind: string;
    externalResource?: string | null;
    externalSubscriptionId?: string | null;
    expiresAt?: string | null;
    meta?: string | null;
  }): string {
    const existing = this.db
      .prepare(
        `SELECT id FROM oauth_subscriptions
         WHERE connection_id = ? AND kind = ?
           AND COALESCE(external_resource,'') = COALESCE(?,'')`,
      )
      .get(data.connectionId, data.kind, data.externalResource ?? "") as
      | { id: string }
      | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE oauth_subscriptions
           SET external_subscription_id = ?, expires_at = ?, last_renewed_at = CURRENT_TIMESTAMP,
               meta = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(
          data.externalSubscriptionId ?? null,
          data.expiresAt ?? null,
          data.meta ?? null,
          existing.id,
        );
      return existing.id;
    }
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO oauth_subscriptions
         (id, connection_id, user_id, provider, kind, external_resource,
          external_subscription_id, expires_at, last_renewed_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      )
      .run(
        id,
        data.connectionId,
        data.userId,
        data.provider,
        data.kind,
        data.externalResource ?? null,
        data.externalSubscriptionId ?? null,
        data.expiresAt ?? null,
        data.meta ?? null,
      );
    return id;
  }

  listOAuthSubscriptions(connectionId: string) {
    return this.db
      .prepare(
        `SELECT id, connection_id, user_id, provider, kind, external_resource,
                external_subscription_id, expires_at, last_renewed_at, meta
         FROM oauth_subscriptions WHERE connection_id = ?`,
      )
      .all(connectionId) as any[];
  }

  /** Subscriptions due for renewal in the next `minutesAhead`. Used by renewal worker. */
  listOAuthSubscriptionsDueForRenewal(minutesAhead: number) {
    return this.db
      .prepare(
        `SELECT s.*, c.user_id AS owner_user_id
         FROM oauth_subscriptions s
         JOIN oauth_connections c ON c.id = s.connection_id
         WHERE c.revoked_at IS NULL
           AND s.expires_at IS NOT NULL
           AND s.expires_at <= datetime('now', ? || ' minutes')`,
      )
      .all(`+${minutesAhead}`) as any[];
  }

  deleteOAuthSubscription(id: string) {
    this.db.prepare(`DELETE FROM oauth_subscriptions WHERE id = ?`).run(id);
  }

  insertExternalSignal(row: {
    id: string;
    userId: string;
    source:
      | "SLACK"
      | "GITHUB"
      | "JIRA"
      | "MICROSOFT"
      | "GOOGLE"
      | "GMAIL"
      | "NOTION"
      | "LINEAR"
      | "MANUAL"
      | "CRM"
      | "MEETING"
      | "INCIDENT"
      | "HRIS"
      | "FINANCE";
    content: string;
    owner: string;
    /** Event time (when it happened). Grace uses `received_at`, not this. */
    detectedAt?: string;
    /** Provider-specific subtype: meeting / crm.hubspot / github.issues / etc. */
    sourceSubtype?: string;
    /** Idempotency key from the upstream provider (e.g. github delivery id). */
    externalId?: string;
    /** Free-form JSON-stringified context (channel, repo, attendees…). */
    ingestMeta?: string;
  }) {
    const detectedAt = row.detectedAt ?? null;
    const orgId = this.resolveOrgIdForUser(row.userId);
    this.db
      .prepare(
        `INSERT INTO external_signals
            (id, user_id, org_id, source, content, owner, detected_at, received_at, state,
             source_subtype, external_id, ingest_meta)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, 'UNVERIFIED', ?, ?, ?)`,
      )
      .run(
        row.id,
        row.userId,
        orgId,
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
  linkExternalSignalToTask(
    signalId: string,
    taskId: string,
    meta?: { linkMethod?: string; linkProvenance?: Record<string, unknown> },
  ) {
    const linkMethod = meta?.linkMethod ?? "manual";
    const linkProvenanceJson = meta?.linkProvenance ? JSON.stringify(meta.linkProvenance) : null;
    this.db
      .prepare(
        `UPDATE external_signals
         SET state = 'LINKED', linked_execution_id = ?, link_method = ?, link_provenance_json = ?
         WHERE id = ?`,
      )
      .run(taskId, linkMethod, linkProvenanceJson, signalId);
    this.invokeLedgerAuditor({ type: "signal_link", signalId, taskId });
  }

  /** Reversible unlink — returns signal to UNVERIFIED for review. */
  unlinkExternalSignal(signalId: string) {
    this.db
      .prepare(
        `UPDATE external_signals
         SET state = 'UNVERIFIED', linked_execution_id = NULL, link_method = NULL, link_provenance_json = NULL
         WHERE id = ?`,
      )
      .run(signalId);
    this.invokeLedgerAuditor({ type: "signal", signalId });
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

  /** Phase 0: org_id on ledger tables for tenant scoping. */
  private ensureOrgIdColumns() {
    const addCol = (table: string, col: string, ddl: string) => {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === col)) {
        try {
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
        } catch {
          /* ignore */
        }
      }
    };
    addCol("decision_ledger", "org_id", "TEXT");
    addCol("execution_ledger", "org_id", "TEXT");
    addCol("external_signals", "org_id", "TEXT");
    addCol("external_signals", "link_method", "TEXT");
    addCol("external_signals", "link_provenance_json", "TEXT");
  }

  /** Resolve org_id without importing tenant-context (avoids circular deps). */
  resolveOrgIdForUser(userId: string): string {
    if (!userId || userId === "system") return "system";
    const mem = this.db
      .prepare(`SELECT org_id FROM workspace_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(userId) as { org_id: string } | undefined;
    if (mem?.org_id) return mem.org_id;
    const org = this.db
      .prepare(`SELECT id FROM organizations WHERE owner_user_id = ? LIMIT 1`)
      .get(userId) as { id: string } | undefined;
    if (org?.id) return org.id;
    return `org_${userId}`;
  }

  /** Backfill org_id on boot — safe to re-run. */
  backfillOrgIds(): { decisions: number; executions: number; signals: number } {
    let decisions = 0;
    let executions = 0;
    let signals = 0;
    const decisionRows = this.db
      .prepare(`SELECT id, user_id FROM decision_ledger WHERE org_id IS NULL OR org_id = ''`)
      .all() as { id: string; user_id: string }[];
    for (const row of decisionRows) {
      const orgId = this.resolveOrgIdForUser(row.user_id);
      this.db.prepare(`UPDATE decision_ledger SET org_id = ? WHERE id = ?`).run(orgId, row.id);
      decisions++;
    }
    const execRows = this.db
      .prepare(
        `SELECT e.task_id, d.org_id, d.user_id
         FROM execution_ledger e
         INNER JOIN decision_ledger d ON e.decision_id = d.id
         WHERE e.org_id IS NULL OR e.org_id = ''`,
      )
      .all() as { task_id: string; org_id: string | null; user_id: string }[];
    for (const row of execRows) {
      const orgId = row.org_id || this.resolveOrgIdForUser(row.user_id);
      this.db.prepare(`UPDATE execution_ledger SET org_id = ? WHERE task_id = ?`).run(orgId, row.task_id);
      executions++;
    }
    const signalRows = this.db
      .prepare(`SELECT id, user_id FROM external_signals WHERE org_id IS NULL OR org_id = ''`)
      .all() as { id: string; user_id: string }[];
    for (const row of signalRows) {
      const orgId = this.resolveOrgIdForUser(row.user_id);
      this.db.prepare(`UPDATE external_signals SET org_id = ? WHERE id = ?`).run(orgId, row.id);
      signals++;
    }
    return { decisions, executions, signals };
  }

  private normalizeConstraint(s: string): string {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Shared NO-list item, or null if the vows are orthogonal. */
  private constraintListsOverlap(aJson: string | null | undefined, bJson: string | null | undefined): string | null {
    let a: unknown[] = [];
    let b: unknown[] = [];
    try {
      a = JSON.parse(aJson || "[]");
    } catch {
      a = [];
    }
    try {
      b = JSON.parse(bJson || "[]");
    } catch {
      b = [];
    }
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const bNorm = b.map((x) => this.normalizeConstraint(String(x))).filter((x) => x.length >= 8);
    for (const item of a) {
      const n = this.normalizeConstraint(String(item));
      if (n.length < 8) continue;
      const hit = bNorm.find((x) => x === n || (n.length >= 20 && x.includes(n)) || (x.length >= 20 && n.includes(x)));
      if (hit) return String(item);
    }
    return null;
  }

  /**
   * Conflict class: another ACTIVE vow in the org whose NO-list overlaps this one.
   * Orthogonal bets (launch hold vs hiring freeze) may both be ACTIVE; capacity
   * still gates owners at execution time.
   */
  private findConflictingActiveDecision(
    orgId: string,
    excludeDecisionId: string,
    constraintsJson: string | null | undefined,
  ) {
    const others = this.db
      .prepare(
        `SELECT id, vow, constraints FROM decision_ledger
         WHERE org_id = ? AND status = 'ACTIVE' AND id != ?`,
      )
      .all(orgId, excludeDecisionId) as { id: string; vow: string; constraints: string | null }[];
    for (const other of others) {
      const overlap = this.constraintListsOverlap(constraintsJson, other.constraints);
      if (overlap) return { id: other.id, vow: other.vow, overlap };
    }
    return undefined;
  }

  /** Same-vow conflict: two ACTIVE decisions with identical vow text in one org. */
  private findActiveDuplicateVow(
    orgId: string,
    excludeDecisionId: string,
    vow: string | null | undefined,
  ) {
    const needle = String(vow || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!needle) return undefined;
    const others = this.db
      .prepare(
        `SELECT id, vow FROM decision_ledger
         WHERE org_id = ? AND status = 'ACTIVE' AND id != ?`,
      )
      .all(orgId, excludeDecisionId) as { id: string; vow: string }[];
    for (const other of others) {
      const otherVow = String(other.vow || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (otherVow && otherVow === needle) return { id: other.id, vow: other.vow };
    }
    return undefined;
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

  getUserByEmail(email: string) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  }

  findUserIdByEmail(email: string): string | null {
    const row = this.db
      .prepare(`SELECT id FROM users WHERE email = ?`)
      .get(email) as { id: string } | undefined;
    return row?.id ?? null;
  }

  getUserById(id: string) {
    return this.db
      .prepare(`SELECT id, username, email, created_at FROM users WHERE id = ?`)
      .get(id) as { id: string; username: string; email: string | null; created_at: string } | undefined;
  }

  /** Human label for an account (aligned with `GET /api/me` `profile.displayName`). */
  getAccountDisplayName(userId: string): string {
    if (!userId || userId === "system") return "system";
    const row = this.getUserById(userId);
    const profName = (this.getSetting(userId, "profile.display_name") || "").trim();
    const username = (row?.username || userId || "").trim();
    if (profName) return profName;
    return username;
  }

  createUser(id: string, username: string, hash: string, email: string | null = null) {
    this.db
      .prepare(`INSERT INTO users (id, username, password_hash, email) VALUES (?, ?, ?, ?)`)
      .run(id, username, hash, email);
  }

  updateUserEmail(userId: string, email: string | null) {
    const r = this.db.prepare(`UPDATE users SET email = ? WHERE id = ?`).run(email, userId);
    return r.changes > 0;
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

  insertNotificationRow(row: {
    id: string;
    userId: string;
    kind: string;
    title: string;
    body: string;
    linkUrl: string | null;
    payloadJson: string | null;
    deliveredInApp: 0 | 1;
    deliveredEmail: 0 | 1;
    deliveredSlack: 0 | 1;
  }) {
    this.db
      .prepare(
        `INSERT INTO notifications (
          id, user_id, kind, title, body, link_url, payload_json,
          delivered_in_app, delivered_email, delivered_slack
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.userId,
        row.kind,
        row.title,
        row.body,
        row.linkUrl,
        row.payloadJson,
        row.deliveredInApp,
        row.deliveredEmail,
        row.deliveredSlack,
      );
  }

  updateNotificationDeliveryFlags(
    id: string,
    userId: string,
    patch: { deliveredEmail?: 0 | 1; deliveredSlack?: 0 | 1; deliveredInApp?: 0 | 1 },
  ) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.deliveredEmail !== undefined) {
      sets.push("delivered_email = ?");
      vals.push(patch.deliveredEmail);
    }
    if (patch.deliveredSlack !== undefined) {
      sets.push("delivered_slack = ?");
      vals.push(patch.deliveredSlack);
    }
    if (patch.deliveredInApp !== undefined) {
      sets.push("delivered_in_app = ?");
      vals.push(patch.deliveredInApp);
    }
    if (!sets.length) return 0;
    vals.push(id, userId);
    const r = this.db
      .prepare(`UPDATE notifications SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
      .run(...vals);
    return r.changes as number;
  }

  listNotificationsForUser(userId: string, limit: number, unreadOnly: boolean) {
    let sql = `SELECT id, user_id, kind, title, body, link_url, payload_json,
      delivered_in_app, delivered_email, delivered_slack, read_at, digest_sent_at, created_at
      FROM notifications WHERE user_id = ?`;
    const params: unknown[] = [userId];
    if (unreadOnly) sql += ` AND read_at IS NULL`;
    sql += ` ORDER BY datetime(created_at) DESC LIMIT ?`;
    params.push(Math.min(Math.max(limit, 1), 200));
    return this.db.prepare(sql).all(...params) as {
      id: string;
      user_id: string;
      kind: string;
      title: string;
      body: string;
      link_url: string | null;
      payload_json: string | null;
      delivered_in_app: number;
      delivered_email: number;
      delivered_slack: number;
      read_at: string | null;
      digest_sent_at: string | null;
      created_at: string;
    }[];
  }

  countUnreadNotifications(userId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`)
      .get(userId) as { c: number };
    return row?.c ?? 0;
  }

  markNotificationRead(userId: string, id: string): number {
    const r = this.db
      .prepare(
        `UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL`,
      )
      .run(id, userId);
    return r.changes as number;
  }

  markAllNotificationsRead(userId: string): number {
    const r = this.db
      .prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`)
      .run(userId);
    return r.changes as number;
  }

  /** Latest Slack bot install including secrets (server-only; never expose to clients). */
  getSlackBotInstallWithToken(userId: string): {
    id: string;
    external_team_id: string;
    external_team_name: string | null;
    bot_user_id: string | null;
    access_token: string;
    raw_install_payload: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, external_team_id, external_team_name, bot_user_id, access_token, raw_install_payload
         FROM oauth_connections WHERE user_id = ? AND provider = 'slack' ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(userId) as
      | {
          id: string;
          external_team_id: string;
          external_team_name: string | null;
          bot_user_id: string | null;
          access_token: string;
          raw_install_payload: string | null;
        }
      | undefined;
    return row ?? null;
  }

  listUsersWithSettingKey(key: string, value: string): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT user_id FROM settings WHERE key = ? AND value = ?`)
      .all(key, value) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  listPendingDigestNotificationIds(userId: string, beforeIso: string, limit: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM notifications
         WHERE user_id = ? AND digest_sent_at IS NULL AND datetime(created_at) <= datetime(?)
         ORDER BY datetime(created_at) ASC LIMIT ?`,
      )
      .all(userId, beforeIso, Math.min(Math.max(limit, 1), 500)) as { id: string }[];
    return rows.map((r) => r.id);
  }

  getNotificationsByIds(userId: string, ids: string[]) {
    if (!ids.length)
      return [] as {
        id: string;
        kind: string;
        title: string;
        body: string;
        link_url: string | null;
        created_at: string;
      }[];
    const placeholders = ids.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT id, kind, title, body, link_url, created_at FROM notifications
         WHERE user_id = ? AND id IN (${placeholders}) ORDER BY datetime(created_at) ASC`,
      )
      .all(userId, ...ids) as {
      id: string;
      kind: string;
      title: string;
      body: string;
      link_url: string | null;
      created_at: string;
    }[];
  }

  markNotificationsDigestSent(ids: string[], iso: string): number {
    if (!ids.length) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const r = this.db
      .prepare(`UPDATE notifications SET digest_sent_at = ? WHERE id IN (${placeholders}) AND digest_sent_at IS NULL`)
      .run(iso, ...ids);
    return r.changes as number;
  }

  getUserEmailForDelivery(userId: string): string | null {
    const row = this.db
      .prepare(`SELECT email, username FROM users WHERE id = ?`)
      .get(userId) as { email: string | null; username: string } | undefined;
    if (!row) return null;
    const em = (row.email && String(row.email).trim()) || "";
    if (em.includes("@")) return em;
    const u = String(row.username || "").trim();
    if (u.includes("@")) return u;
    return null;
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
    const orgIdForFp = this.resolveOrgIdForUser(userId);
    // Semantic Fingerprint: org + vow + outcomes + reasoning (before server-only epistemic_derivation).
    const payloadFp =
      (data.vow || "") +
      JSON.stringify(data.expected_outcomes || {}) +
      (ir ? JSON.stringify(ir) : "");
    const fingerprint = crypto.createHash("sha256").update(`org:${orgIdForFp}\n${payloadFp}`).digest("hex");
    const legacyFingerprint = crypto.createHash("sha256").update(payloadFp).digest("hex");

    const hit = (fp: string) =>
      this.db.prepare("SELECT id, user_id, org_id FROM decision_ledger WHERE fingerprint = ?").get(fp) as
        | { id: string; user_id: string; org_id: string | null }
        | undefined;
    const sameTenant = (row: { user_id: string; org_id: string | null }) =>
      row.user_id === userId || (row.org_id || this.resolveOrgIdForUser(row.user_id)) === orgIdForFp;

    const existing = hit(fingerprint) || (() => {
      const legacy = hit(legacyFingerprint);
      return legacy && sameTenant(legacy) ? legacy : undefined;
    })();
    if (existing && sameTenant(existing)) {
      this.log(userId, "Database", `Deduplicated decision attempt for fingerprint ${fingerprint.slice(0, 8)}`);
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
        id, user_id, org_id, fingerprint, vow, expected_outcomes, constraints, reversal_conditions, confidence, status, decision_reasoning
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)
    `).run(
      id, userId, this.resolveOrgIdForUser(userId), fingerprint, data.vow || "Unspecified Vow",
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
      | { user_id: string; org_id: string | null; status: string; vow?: string | null; constraints?: string | null }
      | undefined;
    if (!current) throw new Error("Decision not found.");

    if (newState === "ACTIVE") {
      if (current.status === "ACTIVE") {
        throw new Error("Decision is already ACTIVE.");
      }
      const orgId = current.org_id || this.resolveOrgIdForUser(current.user_id || "system");
      const sameVow = this.findActiveDuplicateVow(orgId, id, current.vow);
      if (sameVow) {
        this.logAudit(
          "DECISION_DUPLICATE_VOW_BLOCKED",
          `Duplicate ACTIVE vow blocked vs ${sameVow.id}`,
          id,
        );
        throw new Error(
          `CONFLICT: Cannot activate — vow already ACTIVE on decision ${sameVow.id}.`,
        );
      }
      const other = this.findConflictingActiveDecision(orgId, id, current.constraints);
      if (other) {
        this.logAudit(
          "DECISION_CONFLICT_BLOCKED",
          `NO-list overlap with ACTIVE ${other.id}: ${other.overlap}`,
          id,
        );
        throw new Error(
          `CONFLICT: Cannot activate while decision ${other.id} is ACTIVE — shared NO-list: "${other.overlap}".`,
        );
      }
    }

    this.db.prepare(`
      UPDATE decision_ledger SET status = ?, last_update = CURRENT_TIMESTAMP WHERE id = ?
    `).run(newState, id);

    const lifecycleMap: Record<string, string> = {
      DRAFT: "PROPOSED",
      REVERSED: "REVOKED",
      KILLED: "REVOKED",
    };
    const lifecycle = lifecycleMap[newState] ?? newState;
    try {
      this.db.prepare(`UPDATE decision_ledger SET lifecycle_state = ? WHERE id = ?`).run(lifecycle, id);
    } catch {
      /* lifecycle_state column may be absent on very old DBs until migration runs */
    }

    this.logAudit('DECISION_TRANSITION', `New State: ${newState} | ${reason}`, id);

    // If decision is KILLED, kill all pending tasks
    if (newState === 'KILLED') {
        this.db.prepare("UPDATE execution_ledger SET status = 'KILLED' WHERE decision_id = ? AND status IN ('PENDING', 'ACTIVE', 'BLOCKED')").run(id);
    }

    this.invokeLedgerAuditor({ type: "decision", decisionId: id });
    try {
      onDecisionTerminalState(id, newState);
    } catch (e) {
      console.error("[DB] Outcome evaluation hook failed:", e);
    }
  }

  saveExecutionTask(data: any, skipAuditorHook = false) {
    const taskId = data.task_id || uuidv4();
    const decisionRow = this.db
      .prepare(`SELECT user_id, org_id FROM decision_ledger WHERE id = ?`)
      .get(data.decision_id) as { user_id: string; org_id: string | null } | undefined;
    const orgId = decisionRow?.org_id || this.resolveOrgIdForUser(decisionRow?.user_id || "system");
    this.db.prepare(`
      INSERT INTO execution_ledger (
        task_id, decision_id, org_id, parent_task_id, owner, type, priority, weight, status,
        dependencies, success_condition, failure_condition
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `).run(
      taskId, data.decision_id, orgId, data.parent_task_id || null, data.owner || 'system',
      data.type || 'ACTION', data.priority || 3, data.weight || 1.0,
      JSON.stringify(data.dependencies || []),
      data.success_condition || null, data.failure_condition || null
    );
    if (data.estimated_duration_hours != null || data.due_at) {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (data.estimated_duration_hours != null) {
        sets.push("estimated_duration_hours = ?");
        params.push(data.estimated_duration_hours);
      }
      if (data.due_at) {
        sets.push("due_at = ?");
        params.push(data.due_at);
      }
      if (sets.length) {
        params.push(taskId);
        this.db.prepare(`UPDATE execution_ledger SET ${sets.join(", ")} WHERE task_id = ?`).run(...params);
      }
    }
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
      void import("./execution-intelligence/index.js")
        .then((m) => m.emitTaskSpawnedEvidence(taskId, data.owner || "system"))
        .catch(() => undefined);
    }
    return taskId;
  }

  // --- Reputation & Capacity ---
  /**
   * Load budget = roster weekly hours / 8 (one person-day ≈ 1.0 weight), times
   * reputation_modifier. No roster → 3.0 (legacy default).
   * ponytail: lookup without userId is first matching roster row across tenants.
   */
  getOwnerCapacity(owner: string, userId?: string) {
    const rep = this.db.prepare("SELECT * FROM owner_reputation WHERE owner = ?").get(owner) as
      | {
          reputation_modifier: number;
          is_locked: number;
          failed_executions: number;
          successful_executions: number;
        }
      | undefined;
    const modifier = rep ? Number(rep.reputation_modifier) || 1.0 : 1.0;
    const hours = this.lookupRosterWeeklyHours(owner, userId);
    const base = hours != null && hours > 0 ? Math.max(1, hours / 8) : 3.0;
    return {
      capacity: base * modifier,
      reputation_modifier: modifier,
      is_locked: rep ? rep.is_locked === 1 : false,
      roster_hours: hours,
      failed: rep?.failed_executions,
      success: rep?.successful_executions,
    };
  }

  /**
   * ACTIVE execution weight for an owner, scoped to one decision tenant when userId is set.
   * Global owner names (Ethan, Imani, …) are shared across sim/prod tenants — capacity must
   * not bleed load from other users' ledgers.
   */
  getOwnerActiveWeight(owner: string, userId?: string): number {
    if (userId) {
      const row = this.db
        .prepare(
          `SELECT COALESCE(SUM(e.weight), 0) AS w
           FROM execution_ledger e
           INNER JOIN decision_ledger d ON d.id = e.decision_id
           WHERE e.owner = ? AND e.status = 'ACTIVE' AND d.user_id = ?`,
        )
        .get(owner, userId) as { w: number } | undefined;
      return Number(row?.w ?? 0);
    }
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(weight), 0) AS w FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'`,
      )
      .get(owner) as { w: number } | undefined;
    return Number(row?.w ?? 0);
  }

  /** Remaining effort hours on ACTIVE tasks (full estimate — conservative). */
  getOwnerActiveHours(owner: string, userId?: string, excludeTaskId?: string): number {
    const rows = (
      userId
        ? this.db
            .prepare(
              `SELECT e.task_id, e.estimated_duration_hours, e.weight, e.status
               FROM execution_ledger e
               INNER JOIN decision_ledger d ON d.id = e.decision_id
               WHERE e.owner = ? AND e.status = 'ACTIVE' AND d.user_id = ?`,
            )
            .all(owner, userId)
        : this.db
            .prepare(
              `SELECT task_id, estimated_duration_hours, weight, status
               FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'`,
            )
            .all(owner)
    ) as Array<{
      task_id: string;
      estimated_duration_hours: number | null;
      weight: number | null;
      status: string;
    }>;
    return rows
      .filter((r) => !excludeTaskId || r.task_id !== excludeTaskId)
      .reduce((n, r) => n + taskEffortHours(r), 0);
  }

  private lookupRosterWeeklyHours(owner: string, userId?: string): number | null {
    const ownerTrim = String(owner || "").trim();
    if (!ownerTrim) return null;
    const first = ownerTrim.split(/\s+/)[0];
    const row = (
      userId
        ? this.db
            .prepare(
              `SELECT capacity FROM team_roster
               WHERE user_id = ?
                 AND (
                   slack_id = ? OR slack_id = ?
                   OR name = ? OR name = ?
                   OR name LIKE ? OR name LIKE ?
                   OR lower(substr(name, 1, instr(name || ' ', ' ') - 1)) = lower(?)
                 )
               ORDER BY created_at DESC LIMIT 1`,
            )
            .get(
              userId,
              ownerTrim,
              first,
              ownerTrim,
              first,
              `${ownerTrim}%`,
              `${first}%`,
              first,
            )
        : this.db
            .prepare(
              `SELECT capacity FROM team_roster
               WHERE slack_id = ? OR slack_id = ?
                  OR name = ? OR name = ?
                  OR name LIKE ? OR name LIKE ?
               ORDER BY created_at DESC LIMIT 1`,
            )
            .get(ownerTrim, first, ownerTrim, first, `${ownerTrim}%`, `${first}%`)
    ) as { capacity: string } | undefined;
    if (!row?.capacity) return null;
    const m = String(row.capacity).match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  }

  /** Sum of ACTIVE execution weights for decisions owned by this user (Settings capacity usage). */
  getActiveExecutionWeightSumForDecisionOwner(userId: string): number {
    if (!userId || userId === "system") return 0;
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(e.weight), 0) AS w
         FROM execution_ledger e
         INNER JOIN decision_ledger d ON e.decision_id = d.id
         WHERE d.user_id = ? AND e.status = 'ACTIVE'`,
      )
      .get(userId) as { w: number } | undefined;
    return Number(row?.w ?? 0);
  }

  listTeamRoster(userId: string) {
    return this.db
      .prepare(
        `SELECT id, user_id, name, email, role, team, capacity, slack_id, talent_tier, reports_to, created_at
         FROM team_roster WHERE user_id = ? ORDER BY created_at ASC`,
      )
      .all(userId) as {
      id: string;
      user_id: string;
      name: string;
      email: string;
      role: string;
      team: string;
      capacity: string;
      slack_id: string | null;
      talent_tier: string | null;
      reports_to: string | null;
      created_at: string;
    }[];
  }

  getTeamRosterMember(userId: string, rosterId: string) {
    return this.db
      .prepare(
        `SELECT id, user_id, name, email, role, team, capacity, slack_id, talent_tier, created_at
         FROM team_roster WHERE id = ? AND user_id = ?`,
      )
      .get(rosterId, userId) as
      | {
          id: string;
          user_id: string;
          name: string;
          email: string;
          role: string;
          team: string;
          capacity: string;
          slack_id: string | null;
          talent_tier: string | null;
          created_at: string;
        }
      | undefined;
  }

  insertTeamRosterMember(
    userId: string,
    row: {
      name: string;
      email: string;
      role: string;
      team: string;
      capacity: string;
      slackId?: string;
      talentTier?: string;
    },
  ): string {
    const id = uuidv4();
    const email = row.email.trim().toLowerCase();
    this.db
      .prepare(
        `INSERT INTO team_roster (id, user_id, name, email, role, team, capacity, slack_id, talent_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        row.name.trim(),
        email,
        row.role.trim() || "Member",
        row.team.trim() || "General",
        row.capacity.trim() || "40h / week",
        row.slackId?.trim() || null,
        row.talentTier?.trim() || null,
      );
    return id;
  }

  deleteTeamRosterMember(userId: string, rosterId: string): boolean {
    const r = this.db
      .prepare(`DELETE FROM team_roster WHERE id = ? AND user_id = ?`)
      .run(rosterId, userId);
    return r.changes > 0;
  }

  updateTeamRosterMember(
    userId: string,
    rosterId: string,
    row: {
      name: string;
      email: string;
      role: string;
      team: string;
      capacity: string;
      slackId?: string;
      talentTier?: string;
    },
  ): boolean {
    const email = row.email.trim().toLowerCase();
    const r = this.db
      .prepare(
        `UPDATE team_roster
         SET name = ?, email = ?, role = ?, team = ?, capacity = ?, slack_id = ?, talent_tier = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        row.name.trim(),
        email,
        row.role.trim() || "Member",
        row.team.trim() || "General",
        row.capacity.trim() || "40h / week",
        row.slackId?.trim() || null,
        row.talentTier?.trim() || null,
        rosterId,
        userId,
      );
    return r.changes > 0;
  }

  upsertTeamRosterByEmail(
    userId: string,
    row: {
      name: string;
      email: string;
      role: string;
      team: string;
      capacity: string;
      slackId?: string;
      talentTier?: string;
    },
  ): { id: string; created: boolean } {
    const email = row.email.trim().toLowerCase();
    const existing = this.db
      .prepare(`SELECT id FROM team_roster WHERE user_id = ? AND email = ?`)
      .get(userId, email) as { id: string } | undefined;
    if (existing) {
      this.updateTeamRosterMember(userId, existing.id, row);
      return { id: existing.id, created: false };
    }
    const id = this.insertTeamRosterMember(userId, row);
    return { id, created: true };
  }

  // --- The Enforcement Gate (Auditor Logic) ---
  transitionExecutionState(
    taskId: string,
    newState: string,
    reason: string = "State update",
    skipAuditorHook = false,
    options?: { estimatedDurationHours?: number; attribution?: string; dueAt?: string },
  ) {
    const task = this.db.prepare("SELECT * FROM execution_ledger WHERE task_id = ?").get(taskId);
    if (!task) throw new Error("Task not found.");

    if (options?.estimatedDurationHours != null || options?.attribution || options?.dueAt) {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (options.estimatedDurationHours != null) {
        sets.push("estimated_duration_hours = ?");
        params.push(options.estimatedDurationHours);
      }
      if (options.attribution) {
        sets.push("attribution = ?");
        params.push(options.attribution);
      }
      if (options.dueAt) {
        sets.push("due_at = ?");
        params.push(options.dueAt);
      }
      if (sets.length) {
        params.push(taskId);
        this.db.prepare(`UPDATE execution_ledger SET ${sets.join(", ")} WHERE task_id = ?`).run(...params);
      }
    }

    const refreshed = this.db.prepare("SELECT * FROM execution_ledger WHERE task_id = ?").get(taskId);
    const taskRow = refreshed ?? task;
    const current = String(taskRow.status || "PENDING").toUpperCase();
    const target = String(newState || "").toUpperCase();
    const LEGAL: Record<string, string[]> = {
      PENDING: ["ACTIVE", "BLOCKED", "KILLED"],
      ACTIVE: ["DONE", "BLOCKED", "KILLED"],
      BLOCKED: ["ACTIVE", "KILLED"],
      DONE: [],
      KILLED: [],
    };
    if (current === target) {
      this.logAudit("TASK_TRANSITION", `No-op ${current} | ${reason}`, taskId);
      if (!skipAuditorHook) {
        this.invokeLedgerAuditor({ type: "execution", taskId });
      }
      return { status: current, noop: true };
    }
    const allowed = LEGAL[current];
    if (!allowed || !allowed.includes(target)) {
      this.logAudit("TASK_TRANSITION_REJECTED", `Illegal ${current} → ${target} | ${reason}`, taskId);
      throw new Error(`Illegal execution transition: ${current} → ${target}`);
    }

    if (target === 'ACTIVE') {
        const decisionOwner = this.db
          .prepare(`SELECT user_id FROM decision_ledger WHERE id = ?`)
          .get(taskRow.decision_id) as { user_id: string } | undefined;
        const { is_locked, roster_hours, reputation_modifier } = this.getOwnerCapacity(taskRow.owner, decisionOwner?.user_id);
        const reasons = [];

        if (is_locked) reasons.push("owner_locked");

        // 1. Dependency Check
        const deps = JSON.parse(taskRow.dependencies || '[]');
        for (const depId of deps) {
            const depTask = this.db.prepare("SELECT status FROM execution_ledger WHERE task_id = ?").get(depId);
            if (!depTask || depTask.status !== 'DONE') {
                reasons.push(`dependency_incomplete:${depId}`);
            }
        }

        // 2. Hours capacity — available roster hours minus ACTIVE remaining minus this task
        const avail = availableHours(roster_hours, reputation_modifier);
        const remainingActiveHours = this.getOwnerActiveHours(taskRow.owner, decisionOwner?.user_id, taskId);
        const newTaskHours = taskEffortHours(taskRow);
        const dueHours = hoursUntilDue(taskRow.due_at);
        const hoursGate = evaluateHoursActivation({
          availableHours: avail,
          remainingActiveHours,
          newTaskHours,
          incompleteDeps: reasons.filter((r) => String(r).startsWith("dependency_incomplete")).length,
          hoursUntilDue: dueHours,
          pathHoursUntilDue: newTaskHours,
        });
        if (taskRow.type !== "KILL") {
          for (const r of hoursGate.reasons) {
            if (r !== "dependency_incomplete" && !reasons.includes(r)) reasons.push(r);
          }
        }

        if (reasons.length > 0) {
            this.db.prepare(
              "UPDATE execution_ledger SET status = 'BLOCKED', blocked_reasons = ?, last_update = CURRENT_TIMESTAMP WHERE task_id = ?",
            ).run(JSON.stringify(reasons), taskId);
            this.logAudit('TASK_BLOCKED', hoursGate.message || reasons.join(', '), taskId);
            if (!skipAuditorHook) {
              this.invokeLedgerAuditor({ type: "execution", taskId });
            }
            return { status: 'BLOCKED', reasons, message: hoursGate.message };
        }

        // Pass: Move to ACTIVE
        this.db.prepare(
          "UPDATE execution_ledger SET status = 'ACTIVE', started_at = CURRENT_TIMESTAMP, last_update = CURRENT_TIMESTAMP WHERE task_id = ?",
        ).run(taskId);
    } else {
        this.db.prepare("UPDATE execution_ledger SET status = ?, last_update = CURRENT_TIMESTAMP WHERE task_id = ?").run(target, taskId);
        if (target === 'DONE') {
            this.db.prepare("UPDATE execution_ledger SET completed_at = CURRENT_TIMESTAMP WHERE task_id = ?").run(taskId);
        }
    }

    this.logAudit('TASK_TRANSITION', `New State: ${target} | ${reason}`, taskId);

    // --- Reward/Penalty & Recovery Loop ---
    if (target === 'DONE') {
        this.db.prepare("INSERT OR IGNORE INTO owner_reputation (owner) VALUES (?)").run(taskRow.owner);
        this.db.prepare("UPDATE owner_reputation SET successful_executions = successful_executions + 1 WHERE owner = ?").run(taskRow.owner);
        
        // Recovery: 3 successes -> reputation +0.1
        const rep = this.db.prepare("SELECT successful_executions, reputation_modifier FROM owner_reputation WHERE owner = ?").get(taskRow.owner);
        if (rep && rep.successful_executions >= 3) {
            this.db.prepare("UPDATE owner_reputation SET successful_executions = 0, reputation_modifier = MIN(1.0, reputation_modifier + 0.1), is_locked = 0 WHERE owner = ?").run(taskRow.owner);
            this.logAudit('REPUTATION_RECOVERED', '3 consecutive successes', taskRow.owner);
        }
    } else if (target === 'KILLED' && current === 'ACTIVE') {
        this.db.prepare("INSERT OR IGNORE INTO owner_reputation (owner) VALUES (?)").run(taskRow.owner);
        this.db.prepare("UPDATE owner_reputation SET failed_executions = failed_executions + 1, reputation_modifier = MAX(0.2, reputation_modifier - 0.1) WHERE owner = ?").run(taskRow.owner);
        this.logAudit('REPUTATION_PENALIZED', 'Task killed', taskRow.owner);
    }

    if (!skipAuditorHook) {
      this.invokeLedgerAuditor({ type: "execution", taskId });
    }
    return { status: target };
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
    deviceFingerprint?: string | null;
    suspiciousReason?: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO user_sessions
          (id, user_id, token_hash, expires_at, user_agent, ip, device_fingerprint, suspicious_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.id,
        params.userId,
        params.tokenHash,
        params.expiresAtIso,
        params.userAgent,
        params.ip,
        params.deviceFingerprint ?? null,
        params.suspiciousReason ?? null
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

  countActiveUserSessions(userId: string) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM user_sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`
      )
      .get(userId) as { count: number };
    return row.count;
  }

  revokeOldestActiveSessions(userId: string, keepNewest: number) {
    this.db
      .prepare(
        `UPDATE user_sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE id IN (
          SELECT id FROM user_sessions
          WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
          ORDER BY last_seen_at DESC
          LIMIT -1 OFFSET ?
         )`
      )
      .run(userId, keepNewest);
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

  insertMarketingContactMessage(params: {
    id: string;
    email: string;
    name: string;
    company?: string;
    subject: string;
    message: string;
    source: string;
    ip?: string;
    userAgent?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO marketing_contact_messages (id, email, name, company, subject, message, source, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.email,
        params.name,
        params.company ?? null,
        params.subject,
        params.message,
        params.source,
        params.ip ?? null,
        params.userAgent ?? null,
      );
  }

  insertEarlyAccessLead(params: {
    id: string;
    email: string;
    name: string;
    company?: string;
    role?: string;
    source: string;
    ip?: string;
    userAgent?: string;
  }): { created: boolean } {
    try {
      this.db
        .prepare(
          `INSERT INTO early_access_leads (id, email, name, company, role, source, ip, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.id,
          params.email,
          params.name,
          params.company ?? null,
          params.role ?? null,
          params.source,
          params.ip ?? null,
          params.userAgent ?? null,
        );
      return { created: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") || msg.includes("unique")) {
        return { created: false };
      }
      throw e;
    }
  }

  insertSecurityEvent(params: {
    eventType: string;
    severity: "info" | "warning" | "critical";
    userId?: string | null;
    authKind?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const metadataJson = params.metadata ? JSON.stringify(params.metadata).slice(0, 4000) : null;
    this.db
      .prepare(
        `INSERT INTO security_events
          (id, event_type, severity, user_id, auth_kind, ip, user_agent, request_id, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uuidv4(),
        params.eventType,
        params.severity,
        params.userId ?? null,
        params.authKind ?? null,
        params.ip ?? null,
        params.userAgent ?? null,
        params.requestId ?? null,
        metadataJson
      );
  }

  getLastLedgerEventHash(orgId: string, aggregateType: string, aggregateId: string) {
    const row = this.db
      .prepare(
        `SELECT event_hash FROM ledger_events
         WHERE org_id = ? AND aggregate_type = ? AND aggregate_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(orgId, aggregateType, aggregateId) as { event_hash: string } | undefined;
    return row?.event_hash ?? null;
  }

  appendLedgerEvent(params: {
    id: string;
    orgId: string;
    aggregateType: "decision" | "execution" | "signal" | "capability";
    aggregateId: string;
    eventType: string;
    payloadJson: string;
    actorType: "user" | "agent" | "service" | "system";
    actorId: string;
    policyVersion: string;
    capabilityId?: string | null;
    causationEventId?: string | null;
    correlationId: string;
    previousHash?: string | null;
    eventHash: string;
    signature?: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO ledger_events
          (id, org_id, aggregate_type, aggregate_id, event_type, payload_json, actor_type, actor_id,
           policy_version, capability_id, causation_event_id, correlation_id, previous_hash, event_hash, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.id,
        params.orgId,
        params.aggregateType,
        params.aggregateId,
        params.eventType,
        params.payloadJson,
        params.actorType,
        params.actorId,
        params.policyVersion,
        params.capabilityId ?? null,
        params.causationEventId ?? null,
        params.correlationId,
        params.previousHash ?? null,
        params.eventHash,
        params.signature ?? null
      );
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
