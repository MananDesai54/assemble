import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wav_path TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      transcript TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'recording'
    );
  `);
  return db;
}

export interface RecordingRow {
  id: number;
  wav_path: string;
  started_at: string;
  ended_at: string | null;
  transcript: string | null;
  summary: string | null;
  status: string; // recording | transcribing | done | error
}

export function insertRecording(db: Database, wavPath: string, startedAt: string): number {
  const res = db.run(
    `INSERT INTO recordings (wav_path, started_at, status) VALUES (?, ?, 'recording')`,
    [wavPath, startedAt],
  );
  return Number(res.lastInsertRowid);
}

export function updateRecording(db: Database, id: number, fields: Partial<Omit<RecordingRow, 'id'>>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.run(`UPDATE recordings SET ${sets} WHERE id = ?`,
    [...keys.map(k => (fields as Record<string, unknown>)[k] as string | null), id]);
}

export function listRecordings(db: Database, limit = 20): RecordingRow[] {
  return db.query<RecordingRow, [number]>(
    `SELECT * FROM recordings ORDER BY id DESC LIMIT ?`,
  ).all(limit);
}

export function getRecording(db: Database, id: number): RecordingRow | null {
  return db.query<RecordingRow, [number]>(`SELECT * FROM recordings WHERE id = ?`).get(id) ?? null;
}

export function activeRecording(db: Database): RecordingRow | null {
  return db.query<RecordingRow, []>(
    `SELECT * FROM recordings WHERE status = 'recording' ORDER BY id DESC LIMIT 1`,
  ).get() ?? null;
}

export function kvGet(db: Database, key: string): string | null {
  const row = db.query<{ value: string }, [string]>(`SELECT value FROM kv WHERE key = ?`).get(key);
  return row?.value ?? null;
}

export function kvSet(db: Database, key: string, value: string): void {
  db.run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
}

export function kvDel(db: Database, key: string): void {
  db.run(`DELETE FROM kv WHERE key = ?`, [key]);
}

/* ---------------- talk: persisted conversations ---------------- */

export interface TalkChat {
  id: number;
  title: string;
  summary: string | null;
  summarized_upto: number; // message id already folded into summary
  created_at: string;
}

export interface TalkMessage {
  id: number;
  chat_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export function ensureTalkTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS talk_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New chat',
      summary TEXT,
      summarized_upto INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS talk_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_talk_messages_chat ON talk_messages (chat_id, id);
  `);
}

export function createTalkChat(db: Database): TalkChat {
  const id = Number(db.run(`INSERT INTO talk_chats DEFAULT VALUES`).lastInsertRowid);
  return db.query<TalkChat, [number]>(`SELECT * FROM talk_chats WHERE id = ?`).get(id)!;
}

export function listTalkChats(db: Database, limit = 30): TalkChat[] {
  return db.query<TalkChat, [number]>(`SELECT * FROM talk_chats ORDER BY id DESC LIMIT ?`).all(limit);
}

export function getTalkChat(db: Database, id: number): TalkChat | null {
  return db.query<TalkChat, [number]>(`SELECT * FROM talk_chats WHERE id = ?`).get(id) ?? null;
}

export function deleteTalkChat(db: Database, id: number): void {
  db.run(`DELETE FROM talk_messages WHERE chat_id = ?`, [id]);
  db.run(`DELETE FROM talk_chats WHERE id = ?`, [id]);
}

export function addTalkMessage(db: Database, chatId: number, role: 'user' | 'assistant', content: string): number {
  const id = Number(db.run(
    `INSERT INTO talk_messages (chat_id, role, content) VALUES (?, ?, ?)`, [chatId, role, content],
  ).lastInsertRowid);
  // first user message names the chat
  if (role === 'user') {
    db.run(`UPDATE talk_chats SET title = ? WHERE id = ? AND title = 'New chat'`,
      [content.slice(0, 60), chatId]);
  }
  return id;
}

export function talkMessages(db: Database, chatId: number, afterId = 0): TalkMessage[] {
  return db.query<TalkMessage, [number, number]>(
    `SELECT * FROM talk_messages WHERE chat_id = ? AND id > ? ORDER BY id ASC`,
  ).all(chatId, afterId);
}

export function setTalkSummary(db: Database, chatId: number, summary: string, upto: number): void {
  db.run(`UPDATE talk_chats SET summary = ?, summarized_upto = ? WHERE id = ?`, [summary, upto, chatId]);
}
