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
