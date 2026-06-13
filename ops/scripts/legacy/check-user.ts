import Database from "better-sqlite3";
import path from "path";
const db = new Database(path.resolve("data", "hustronix.db"));
const userId = "411d412c-b8ab-40c9-a96b-0434e827c5dc";
const keys = db.prepare("SELECT * FROM api_keys WHERE user_id = ?").all(userId);
console.log("Keys for user:", userId, JSON.stringify(keys, null, 2));
const settings = db.prepare("SELECT * FROM settings WHERE user_id = ?").all(userId);
console.log("Settings for user:", userId, JSON.stringify(settings, null, 2));
