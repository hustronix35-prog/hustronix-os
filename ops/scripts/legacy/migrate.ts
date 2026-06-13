import { db } from "../../../apps/api/src/database.js";
try {
    (db as any).db.prepare('ALTER TABLE decision_ledger ADD COLUMN impact_weight REAL DEFAULT 0.5').run();
    console.log("✅ Schema Migration Success: added impact_weight");
} catch (e: any) {
    console.log("ℹ️ Schema Migration: " + e.message);
}
