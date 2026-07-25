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
  `);
  db.exec(`
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
  // additive migrations for older DBs
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(messages)`).all().map(c => c.name);
  if (!cols.includes('urgency')) db.exec(`ALTER TABLE messages ADD COLUMN urgency INTEGER`);
  if (!cols.includes('urgency_reason')) db.exec(`ALTER TABLE messages ADD COLUMN urgency_reason TEXT`);
  return db;
}

/** Returns the new row id, or null if this (channel, ts) was already stored. */
export function insertMessage(db: Database, m: InsertMessage): number | null {
  const res = db.run(
    `INSERT OR IGNORE INTO messages
       (slack_ts, channel, channel_type, channel_name, user, user_name, text, thread_ts, team)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.slackTs, m.channel, m.channelType ?? null, m.channelName ?? null,
     m.user ?? null, m.userName ?? null, m.text, m.threadTs ?? null, m.team ?? null],
  );
  return res.changes > 0 ? Number(res.lastInsertRowid) : null;
}

export function setUrgency(db: Database, id: number, urgent: boolean, reason: string): void {
  db.run(`UPDATE messages SET urgency = ?, urgency_reason = ? WHERE id = ?`, [urgent ? 1 : 0, reason, id]);
}

export function messagesAfter(db: Database, afterId: number, limit = 200): MessageRow[] {
  return db.query<MessageRow, [number, number]>(
    `SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?`,
  ).all(afterId, limit);
}

export function channelMessages(db: Database, channel: string, limit = 15): MessageRow[] {
  return db.query<MessageRow, [string, number]>(
    `SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?`,
  ).all(channel, limit).reverse();
}

export function lastMessageId(db: Database): number {
  const row = db.query<{ m: number | null }, []>(`SELECT MAX(id) AS m FROM messages`).get();
  return row?.m ?? 0;
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
