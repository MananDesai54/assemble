import { spawn, type ChildProcess } from 'node:child_process';

const GEMMA = 'unsloth/gemma-4-12b-it-GGUF:Q4_K_M';

// Owns the llama-server child. First start downloads the GGUF (~7 GB) into
// llama.cpp's own cache; subsequent starts are fast.
export class LlmRuntime {
  private proc: ChildProcess | null = null;
  port: number;

  constructor({ port = Number(process.env.ASSEMBLE_LLM_PORT || 4820) } = {}) {
    this.port = port;
  }

  get running(): boolean { return this.proc !== null; }

  start(onLine: (l: string) => void): void {
    if (this.proc) { onLine('llm already running'); return; }
    if (Bun.which('llama-server') === null) throw new Error('llama.cpp not installed yet');
    onLine(`starting Gemma 4 12B on :${this.port} (first run downloads ~7 GB)…`);
    const p = spawn('llama-server', [
      '-hf', GEMMA, '--port', String(this.port), '-ngl', '99', '-c', '8192', '--jinja',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (buf: Buffer) => {
      for (const line of buf.toString().split('\n')) {
        // surface only the interesting lines: download progress + readiness
        if (/(downloading|%|listening|server is listening|error)/i.test(line)) onLine(line.trim());
      }
    };
    p.stdout?.on('data', feed);
    p.stderr?.on('data', feed);
    p.on('exit', code => {
      this.proc = null;
      onLine(`llm stopped (${code ?? 'signal'})`);
    });
    this.proc = p;
  }

  stop(): void {
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }
}
