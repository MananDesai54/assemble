import { spawn, type ChildProcess } from 'node:child_process';

// Owns the llama-server child. First start of a model downloads its GGUF into
// llama.cpp's own cache; subsequent starts are fast.
export class LlmRuntime {
  private proc: ChildProcess | null = null;
  port: number;
  currentModel: string | null = null;
  currentReasoning = true;

  constructor({ port = Number(process.env.ASSEMBLE_LLM_PORT || 4820) } = {}) {
    this.port = port;
  }

  get running(): boolean { return this.proc !== null; }

  start(onLine: (l: string) => void, hfModel: string, reasoning = true): void {
    if (this.proc && this.currentModel === hfModel && this.currentReasoning === reasoning) {
      onLine('llm already running');
      return;
    }
    if (this.proc) { this.stop(); onLine('switching model…'); }
    if (Bun.which('llama-server') === null) throw new Error('llama.cpp not installed yet');
    onLine(`starting ${hfModel} on :${this.port} (first run downloads the model)…`);
    this.currentModel = hfModel;
    this.currentReasoning = reasoning;
    const p = spawn('llama-server', [
      '-hf', hfModel, '--port', String(this.port), '-ngl', '99', '-c', '8192', '--jinja',
      // reasoning off = --reasoning-budget 0: thinking models otherwise burn
      // the token budget before answering — UI toggle decides
      ...(reasoning ? [] : ['--reasoning-budget', '0']),
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
