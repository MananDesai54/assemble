import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Database } from 'bun:sqlite';

export interface AgentSessionRow {
  id: number;
  cwd: string;
  prompt: string;
  status: string; // running | done | error | stopped
  output: string | null;
  created_at: string;
  ended_at: string | null;
}

const OUTPUT_CAP = 200_000;
const MAX_CONCURRENT = 3;

export function initAgentTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cwd TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      output TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );
  `);
}

export function listSessions(db: Database, limit = 20): AgentSessionRow[] {
  return db.query<AgentSessionRow, [number]>(
    `SELECT * FROM agent_sessions ORDER BY id DESC LIMIT ?`,
  ).all(limit);
}

export function getSession(db: Database, id: number): AgentSessionRow | null {
  return db.query<AgentSessionRow, [number]>(`SELECT * FROM agent_sessions WHERE id = ?`).get(id) ?? null;
}

export function expandDir(dir: string): string {
  const expanded = dir.startsWith('~') ? dir.replace(/^~/, homedir()) : dir;
  return resolve(expanded);
}

export class AgentRunner {
  private procs = new Map<number, ChildProcess>();

  get runningCount(): number { return this.procs.size; }

  run(
    db: Database,
    { cwd, prompt, skipPermissions = false }: { cwd: string; prompt: string; skipPermissions?: boolean },
    onEvent: (payload: { id: number; state: string }) => void,
  ): number {
    if (this.procs.size >= MAX_CONCURRENT) throw new Error(`already running ${MAX_CONCURRENT} sessions`);
    const dir = expandDir(cwd);
    if (!existsSync(dir)) throw new Error(`directory not found: ${dir}`);
    if (Bun.which('claude') === null) throw new Error('claude CLI not found in PATH');

    const res = db.run(
      `INSERT INTO agent_sessions (cwd, prompt) VALUES (?, ?)`, [dir, prompt]);
    const id = Number(res.lastInsertRowid);

    const args = ['-p', prompt,
      ...(skipPermissions ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'acceptEdits'])];
    const proc = spawn('claude', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    this.procs.set(id, proc);
    let output = '';
    const feed = (buf: Buffer) => {
      if (output.length < OUTPUT_CAP) output += buf.toString();
    };
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    proc.on('error', err => {
      this.procs.delete(id);
      db.run(`UPDATE agent_sessions SET status = 'error', output = ?, ended_at = datetime('now') WHERE id = ?`,
        [err.message, id]);
      onEvent({ id, state: 'error' });
    });
    proc.on('exit', code => {
      if (!this.procs.has(id)) return; // stopped or errored already
      this.procs.delete(id);
      const status = code === 0 ? 'done' : 'error';
      db.run(`UPDATE agent_sessions SET status = ?, output = ?, ended_at = datetime('now') WHERE id = ?`,
        [status, output.slice(0, OUTPUT_CAP), id]);
      onEvent({ id, state: status });
    });
    onEvent({ id, state: 'running' });
    return id;
  }

  stop(db: Database, id: number): boolean {
    const proc = this.procs.get(id);
    if (!proc) return false;
    this.procs.delete(id);
    proc.kill('SIGTERM');
    db.run(`UPDATE agent_sessions SET status = 'stopped', ended_at = datetime('now') WHERE id = ?`, [id]);
    return true;
  }
}
