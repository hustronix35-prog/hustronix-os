import Database from 'better-sqlite3';
const db = new Database('d:/Hustronix OS/data/hustronix.db');

try {
    // 1. Create decision_outcomes Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS decision_outcomes (
            id TEXT PRIMARY KEY,
            decision_id TEXT,
            expected_delta TEXT,
            actual_delta TEXT,
            horizon TEXT,
            verification_score REAL,
            error_classification TEXT,
            status TEXT,
            timestamp TEXT,
            FOREIGN KEY(decision_id) REFERENCES decision_events(id)
        );
    `);

    // 2. Harden decision_events Table with V4.2 Logic
    try {
        db.exec("ALTER TABLE decision_events ADD COLUMN is_exploration INTEGER DEFAULT 0;");
    } catch (e) {
        console.log('Skipping is_exploration (already exists or column cannot be added).');
    }

    try {
        db.exec("ALTER TABLE decision_events ADD COLUMN horizon TEXT DEFAULT 'medium_term';");
    } catch (e) {
        console.log('Skipping horizon (already exists or column cannot be added).');
    }

    try {
        db.exec("ALTER TABLE decision_events ADD COLUMN omega_weight REAL DEFAULT 1.0;");
    } catch (e) {
        console.log('Skipping omega_weight (already exists or column cannot be added).');
    }

    console.log('✅ Database Hardened for V4.2 (Anti-Fragile).');
} catch (error) {
    console.error('❌ Migration Failed:', error.message);
} finally {
    db.close();
}
