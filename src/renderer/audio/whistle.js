import { detectPitch } from './pitch.js';

// Turns a sustained whistle into discrete ±1 steps as the pitch slides.
// Feed raw chunks; returns an array of {dir: 1|-1} events per call.
export class WhistleController {
  constructor({ sampleRate = 44100, minHz = 500, maxHz = 3000,
                clarityMin = 0.9, minDurMs = 250, stepCents = 120 } = {}) {
    this.sampleRate = sampleRate;
    this.minHz = minHz; this.maxHz = maxHz;
    this.clarityMin = clarityMin;
    this.minDurMs = minDurMs;
    this.stepCents = stepCents;
    this.frameSize = 1024;
    this.buf = new Float32Array(this.frameSize);
    this.fill = 0;
    this.active = false;
    this.startedAt = 0;
    this.refHz = 0;
    this.graceMisses = 2;   // unclear frames tolerated before the whistle ends
    this.misses = 0;
  }

  push(chunk, tMs) {
    const events = [];
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
