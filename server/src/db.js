import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'campus.db');

if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

// Columns added after the first release; CREATE TABLE IF NOT EXISTS does not add them to existing databases.
const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
if (!hasColumn('saved_searches', 'email_alerts')) {
  db.exec('ALTER TABLE saved_searches ADD COLUMN email_alerts INTEGER NOT NULL DEFAULT 1');
}

export default db;
