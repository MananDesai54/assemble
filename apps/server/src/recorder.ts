import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ActiveRecording {
  wavPath: string;
  startedAt: string;
}

// Owns the audiotap child process. One recording at a time.
export class Recorder {
  private proc: ChildProcess | null = null;
  private current: ActiveRecording | null = null;
  private binPath: string;
  private dir: string;

  constructor({ binPath = 'native/audiotap/audiotap', dir = 'data/recordings' } = {}) {
    this.binPath = binPath;
    this.dir = dir;
  }

  get active(): ActiveRecording | null { return this.current; }

  start(): ActiveRecording {
    if (this.current) throw new Error('already recording');
    mkdirSync(this.dir, { recursive: true });
    const startedAt = new Date().toISOString();
    const wavPath = join(this.dir, `call-${startedAt.replace(/[:.]/g, '-')}.wav`);
    if (process.platform === 'linux') {
      // mic via PulseAudio/PipeWire default source; system-audio mixing TBD on Linux
      if (Bun.which('ffmpeg') === null) throw new Error('ffmpeg required on Linux — install it via your package manager');
      this.proc = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'pulse', '-i', 'default',
        '-ac', '1', '-ar', '16000', '-y', wavPath,
      ], { stdio: ['ignore', 'inherit', 'inherit'] });
    } else {
      this.proc = spawn(this.binPath, [wavPath], { stdio: ['ignore', 'inherit', 'inherit'] });
    }
    this.current = { wavPath, startedAt };
    this.proc.on('exit', () => { this.proc = null; this.current = null; });
    return this.current;
  }

  /** SIGINT audiotap and wait for it to finalize the WAV. */
  async stop(): Promise<ActiveRecording> {
    const rec = this.current;
    const proc = this.proc;
    if (!rec || !proc) throw new Error('not recording');
    await new Promise<void>(resolve => {
      proc.once('exit', () => resolve());
      proc.kill('SIGINT');
      setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 5000).unref();
    });
    this.proc = null;
    this.current = null;
    return rec;
  }
}
