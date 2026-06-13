/**
 * One-off: create a password user for local UI login.
 * Usage (repo root): npx tsx ops/scripts/create-login-account.ts [username] [password]
 */
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../apps/api/src/auth/password.js";

const username =
  process.argv[2]?.trim() ||
  process.env.HUSTRONIX_DEMO_USER?.trim() ||
  "hustronix-demo";
const password =
  process.argv[3] ||
  process.env.HUSTRONIX_DEMO_PASS ||
  "DemoCheck2026!";

if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}

const existing = db.getUser(username);
if (existing) {
  console.log(`User already exists: ${username}`);
  console.log(`Use /login with this username and your existing password, or pick another username.`);
  process.exit(0);
}

const id = uuidv4();
db.createUser(id, username, hashPassword(password));
console.log("Created account:");
console.log(`  Username: ${username}`);
console.log(`  Password: ${password}`);
console.log(`  User ID:  ${id}`);
console.log("");
console.log("Sign in at http://localhost:3000/login (or your APP_ORIGIN) with the credentials above.");
