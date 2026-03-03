import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../data/app.db');

import fs from 'fs';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    requirement TEXT,
    comment TEXT,
    user_display_name TEXT NOT NULL,
    latest_review TEXT,
    locale TEXT NOT NULL DEFAULT 'en',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    phase1_messages TEXT NOT NULL DEFAULT '[]',
    phase2_messages TEXT NOT NULL DEFAULT '[]',
    phase2_meta TEXT,
    status TEXT NOT NULL DEFAULT 'phase1',
    review TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    finished_at INTEGER,
    pending_start_chat TEXT,
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  );
`);

// Migrations for columns added after initial release
for (const col of [
  'ALTER TABLE worlds ADD COLUMN requirement TEXT',
  'ALTER TABLE worlds ADD COLUMN comment TEXT',
  "ALTER TABLE worlds ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'",
]) {
  try { db.exec(col); } catch { /* already exists */ }
}

export default db;