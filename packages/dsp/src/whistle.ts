import { detectPitch } from './pitch';

export interface WhistleStep {
  dir: 1 | -1;
}

export interface WhistleOptions {
  sampleRate?: number;
  minHz?: number;
  maxHz?: number;
  clarityMin?: number;
  minDurMs?: number;
  stepCents?: number;
}

// Turns a sustained whistle into discrete ±1 steps as the pitch slides.
// Feed raw chunks; returns an array of {dir} events per call.
export class WhistleController {
  sampleRate: number;
  minHz: number;
  maxHz: number;
  clarityMin: number;
  minDurMs: number;
  stepCents: number;
  frameSize = 1024;
  graceMisses = 2; // unclear frames tolerated before the whistle ends
  private buf: Float32Array;
  private fill = 0;
  private active = false;
  private startedAt = 0;
  private refHz = 0;
  private misses = 0;

  constructor({ sampleRate = 44100, minHz = 500, maxHz = 3000,
                clarityMin = 0.9, minDurMs = 250, stepCents = 120 }: WhistleOptions = {}) {
    this.sampleRate = sampleRate;
    this.minHz = minHz; this.maxHz = maxHz;
    this.clarityMin = clarityMin;
    this.minDurMs = minDurMs;
    this.stepCents = stepCents;
    this.buf = new Float32Array(this.frameSize);
  }

  push(chunk: Float32Array, tMs: number): WhistleStep[] {
    const events: WhistleStep[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(this.frameSize - this.fill, chunk.length - offset);
      this.buf.set(chunk.subarray(offset, offset + take), this.fill);
      this.fill += take; offset += take;
      if (this.fill < this.frameSize) break;
      this.fill = 0;
      const { hz, clarity } = detectPitch(this.buf, this.sampleRate, { minHz: this.minHz, maxHz: this.maxHz });
      const isWhistle = clarity >= this.clarityMin && hz >= this.minHz && hz <= this.maxHz;
      if (!isWhistle) {
        if (this.active && ++this.misses > this.graceMisses) this.active = false;
        continue;
      }
      this.misses = 0;
      if (!this.active) {
        this.active = true; this.startedAt = tMs; this.refHz = hz;
        continue;
      }
      if (tMs - this.startedAt < this.minDurMs) continue;
      const cents = 1200 * Math.log2(hz / this.refHz);
      if (cents >= this.stepCents) { events.push({ dir: 1 }); this.refHz = hz; }
      else if (cents <= -this.stepCents) { events.push({ dir: -1 }); this.refHz = hz; }
    }
    return events;
  }
}
