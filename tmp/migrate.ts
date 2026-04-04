import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'data', 'gravity.db'));

try {
  db.exec('ALTER TABLE messages ADD COLUMN tool_calls TEXT;');
  console.log('✅ Added tool_calls column');
} catch (e: any) {
  if (e.message.includes('duplicate column name')) {
    console.log('ℹ️ tool_calls column already exists');
  } else {
    throw e;
  }
}

try {
  db.exec('ALTER TABLE messages ADD COLUMN tool_call_id TEXT;');
  console.log('✅ Added tool_call_id column');
} catch (e: any) {
  if (e.message.includes('duplicate column name')) {
    console.log('ℹ️ tool_call_id column already exists');
  } else {
    throw e;
  }
}

console.log('🚀 Migration complete');
process.exit(0);
