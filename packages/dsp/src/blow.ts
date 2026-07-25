import { fft } from './fingerprint';

export interface BlowOptions {
  sampleRate?: number;
  rmsMin?: number;
  flatnessMin?: number;
  durMs?: number;
  refractoryMs?: number;
}

// Detects blowing at the mic: loud, spectrally flat (noise-like), sustained.
// Taps are too short; whistles/speech are too tonal.
export class BlowDetector {
  sampleRate: number;
  rmsMin: number;
  flatnessMin: number;
  durMs: number;
  refractoryMs: number;
  frameSize = 1024;
  private buf: Float32Array;
  private fill = 0;
  private since: number | null = null;
  private lastFire = -Infinity;

  constructor({ sampleRate = 44100, rmsMin = 0.02, flatnessMin = 0.45,
                durMs = 350, refractoryMs = 2000 }: BlowOptions = {}) {
    this.sampleRate = sampleRate;
    this.rmsMin = rmsMin;
    this.flatnessMin = flatnessMin;
    this.durMs = durMs;
    this.refractoryMs = refractoryMs;
    this.buf = new Float32Array(this.frameSize);
  }

  push(chunk: Float32Array, tMs: number): boolean {
    let fired = false;
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(this.frameSize - this.fill, chunk.length - offset);
      this.buf.set(chunk.subarray(offset, offset + take), this.fill);
      this.fill += take; offset += take;
      if (this.fill < this.frameSize) break;
      this.fill = 0;
      if (this._frameIsBlowy()) {
        if (this.since === null) this.since = tMs;
        if (tMs - this.since >= this.durMs && tMs - this.lastFire >= this.refractoryMs) {
          this.lastFire = tMs;
          this.since = null;
          fired = true;
        }
      } else {
        this.since = null;
      }
    }
    return fired;
  }

  private _frameIsBlowy(): boolean {
    const n = this.frameSize;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.buf[i] * this.buf[i];
    if (Math.sqrt(sum / n) < this.rmsMin) return false;
    const re = new Float64Array(n), im = new Float64Array(n);
    re.set(this.buf);
    fft(re, im);
    // spectral flatness (geometric/arithmetic mean) over ~300 Hz – 6 kHz
    const lo = Math.max(1, Math.floor((300 / this.sampleRate) * n));
    const hi = Math.min(n / 2, Math.floor((6000 / this.sampleRate) * n));
    let logSum = 0, linSum = 0, count = 0;
    for (let k = lo; k < hi; k++) {
      const p = re[k] * re[k] + im[k] * im[k] + 1e-12;
      logSum += Math.log(p); linSum += p; count++;
    }
    const flatness = Math.exp(logSum / count) / (linSum / count);
    return flatness >= this.flatnessMin;
  }
}
