import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import type { AuditorWriteContext } from "./auditor-context.js";

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
    this.ensureTenantColumns();
    this.ensureOwnerReputationColumns();
    this.ensureOAuthTables();
    this.ensureSocialAuthTables();
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
  }) {
    if (row.detectedAt) {
      this.db
        .prepare(
          `INSERT INTO external_signals (id, user_id, source, content, owner, detected_at, state)
           VALUES (?, ?, ?, ?, ?, ?, 'UNVERIFIED')`,
        )
        .run(row.id, row.userId, row.source, row.content, row.owner, row.detectedAt);
    } else {
      this.db
        .prepare(
          `INSERT INTO external_signals (id, user_id, source, content, owner, detected_at, state)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'UNVERIFIED')`,
        )
        .run(row.id, row.userId, row.source, row.content, row.owner);
    }
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

  // --- Decision Management ---
  saveDecisionEvent(userId: string, data: any) {
    const id = uuidv4();
    // Semantic Fingerprint: Vow + Expected Outcomes
    const fingerprintStr = (data.vow || "") + JSON.stringify(data.expected_outcomes || {});
    const fingerprint = crypto.createHash('sha256').update(fingerprintStr).digest('hex');

    // DEDUPLICATION Check
    const existing = this.db.prepare("SELECT id FROM decision_ledger WHERE fingerprint = ?").get(fingerprint);
    if (existing) {
        this.log(userId, "Database", `Deduplicated decision attempt for fingerprint ${fingerprint.slice(0,8)}`);
        return existing.id;
    }

    this.db.prepare(`
      INSERT INTO decision_ledger (
        id, user_id, fingerprint, vow, expected_outcomes, constraints, reversal_conditions, confidence, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
    `).run(
      id, userId, fingerprint, data.vow || "Unspecified Vow",
      JSON.stringify(data.expected_outcomes || []),
      JSON.stringify(data.constraints || []),
      data.reversal_conditions || null,
      data.confidence || 0.8
    );

    this.logAudit('DECISION_CREATED', 'Initial decision capture', id);
    
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

export const db = new HustronixDB();
