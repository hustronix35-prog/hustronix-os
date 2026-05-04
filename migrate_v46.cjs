const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join('d:', 'Hustronix OS', 'hustronix.db');
const db = new Database(dbPath);

console.log('🛡️ [Migration] Hardening Decision OS Core to 10/10 Investable Standard...');

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategic_cycles (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT 'system',
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_date DATETIME,
      cumulative_impact REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS learning_log (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT 'system',
      decision_id TEXT,
      mistake_analysis TEXT,
      weight_shifts TEXT,
      surfaced_insight TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrate decision_ledger
  const columns = db.prepare("PRAGMA table_info(decision_ledger)").all();
  const hasColumn = (name) => columns.some(c => c.name === name);

  if (!hasColumn('priority_score')) db.exec("ALTER TABLE decision_ledger ADD COLUMN priority_score REAL DEFAULT 0;");
  if (!hasColumn('confidence_breakdown')) db.exec("ALTER TABLE decision_ledger ADD COLUMN confidence_breakdown TEXT;");
  if (!hasColumn('confidence_decay_rate')) db.exec("ALTER TABLE decision_ledger ADD COLUMN confidence_decay_rate REAL DEFAULT 0.05;");
  if (!hasColumn('expires_at')) db.exec("ALTER TABLE decision_ledger ADD COLUMN expires_at DATETIME;");
  if (!hasColumn('cycle_id')) db.exec("ALTER TABLE decision_ledger ADD COLUMN cycle_id TEXT;");
  if (!hasColumn('user_override_reason')) db.exec("ALTER TABLE decision_ledger ADD COLUMN user_override_reason TEXT;");
  if (!hasColumn('last_updated_at')) db.exec("ALTER TABLE decision_ledger ADD COLUMN last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;");

  // Migrate decision_outcomes
  const outcomeColumns = db.prepare("PRAGMA table_info(decision_outcomes)").all();
  if (!outcomeColumns.some(c => c.name === 'performance_history')) {
    db.exec("ALTER TABLE decision_outcomes ADD COLUMN performance_history TEXT;");
  }

  console.log('✅ [Migration] 10/10 Schema Hardened Successfully.');
} catch (err) {
  console.error('❌ [Migration] Failed:', err.message);
  process.exit(1);
} finally {
  db.close();
}
