import { openSync, readSync, fstatSync, closeSync, writeFileSync, rmSync } from 'node:fs';
import { transcribe } from '@assemble/stt';

// audiotap writes a standard 44-byte WAV header up front (sizes patched on
// finalize), then appends 16 kHz mono 16-bit PCM — safe to slice live.
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SEC = 16_000 * 2;

/** Wrap a raw 16 kHz mono 16-bit PCM buffer in a valid WAV container. */
export function wavFromPcm(pcm: Buffer): Buffer {
  const h = Buffer.alloc(WAV_HEADER_BYTES);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16_000, 24); h.writeUInt32LE(BYTES_PER_SEC, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Whisper hallucinates markers/punctuation on silent chunks — drop those. */
export function isNoiseSegment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[\s\[\](){}.,!?\-–—_*♪]+$/.test(t)) return true;
  return /\[BLANK_AUDIO\]|\[MUSIC\]|\(silence\)|\(music\)/i.test(t);
}

/**
 * Tails a growing WAV file and transcribes new audio every ~10 s, so the
 * transcript builds up live during the call instead of one big pass at stop.
 */
export class LiveTranscriber {
  private timer: ReturnType<typeof setInterval> | null = null;
  private offset = WAV_HEADER_BYTES;
  private busy = false;
  private stopped = false;
  private segments: string[] = [];

  constructor(private opts: {
    wavPath: string;
    modelPath: string;
    intervalMs?: number;
    onSegment: (segment: string, fullTranscript: string) => void;
    transcribeFn?: typeof transcribe;
  }) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(false), this.opts.intervalMs ?? 10_000);
  }

  transcript(): string {
    return this.segments.join(' ');
  }

  private async tick(final: boolean): Promise<void> {
    if (this.busy || (this.stopped && !final)) return;
    this.busy = true;
    try {
      let buf: Buffer;
      try {
        const fd = openSync(this.opts.wavPath, 'r');
        try {
          const avail = fstatSync(fd).size - this.offset;
          // regular ticks want ≥2 s of new audio; the final drain takes ≥0.25 s
          if (avail < (final ? BYTES_PER_SEC / 4 : BYTES_PER_SEC * 2)) return;
          buf = Buffer.alloc(avail);
          readSync(fd, buf, 0, avail, this.offset);
        } finally { closeSync(fd); }
      } catch { return; } // recorder may not have created the file yet
      const chunkPath = `${this.opts.wavPath}.live.wav`;
      writeFileSync(chunkPath, wavFromPcm(buf));
      try {
        const text = (await (this.opts.transcribeFn ?? transcribe)(chunkPath, { modelPath: this.opts.modelPath })).trim();
        this.offset += buf.length;
        if (!isNoiseSegment(text)) {
          this.segments.push(text);
          this.opts.onSegment(text, this.transcript());
        }
      } finally { rmSync(chunkPath, { force: true }); }
    } catch (err) {
      console.error('live-stt tick failed:', (err as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /** Stops ticking, drains the audio tail, returns the full transcript. */
  async stop(): Promise<string> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.busy) await new Promise(r => setTimeout(r, 100));
    await this.tick(true);
    return this.transcript();
  }
}
