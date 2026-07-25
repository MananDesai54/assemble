import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface MessageRow {
  id: number;
  slack_ts: string;
  channel: string;
  channel_type: string | null;
  channel_name: string | null;
  user: string | null;
  user_name: string | null;
  text: string;
  thread_ts: string | null;
  team: string | null;
  received_at: string;
}

export interface InsertMessage {
  slackTs: string;
  channel: string;
  channelType?: string | null;
  channelName?: string | null;
  user?: string | null;
  userName?: string | null;
  text: string;
  threadTs?: string | null;
  team?: string | null;
}

export function openDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slack_ts TEXT NOT NULL,
      channel TEXT NOT NULL,
      channel_type TEXT,
      channel_name TEXT,
      user TEXT,
      user_name TEXT,
      text TEXT NOT NULL,
      thread_ts TEXT,
      team TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (channel, slack_ts)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_received ON messages (received_at DESC);
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

export function insertMessage(db: Database, m: InsertMessage): boolean {
  const res = db.run(
    `INSERT OR IGNORE INTO messages
       (slack_ts, channel, channel_type, channel_name, user, user_name, text, thread_ts, team)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.slackTs, m.channel, m.channelType ?? null, m.channelName ?? null,
     m.user ?? null, m.userName ?? null, m.text, m.threadTs ?? null, m.team ?? null],
  );
  return res.changes > 0;
}

export function recentMessages(db: Database, limit = 50): MessageRow[] {
  return db.query<MessageRow, [number]>(
    `SELECT * FROM messages ORDER BY id DESC LIMIT ?`,
  ).all(limit);
}

export function kvGet(db: Database, key: string): string | null {
  const row = db.query<{ value: string }, [string]>(`SELECT value FROM kv WHERE key = ?`).get(key);
  return row?.value ?? null;
}

export function kvSet(db: Database, key: string, value: string): void {
  db.run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
}
