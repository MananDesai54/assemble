// Streaming tap detector: short-window RMS spike over an EMA noise floor.
// Emits a frameSize window (peak positioned preSamples in) via onFrame.
export class TransientDetector {
  constructor({ sampleRate = 44100, frameSize = 4096, preSamples = 256,
                threshold = 6, minRms = 0.01, refractoryMs = 300 } = {}) {
    this.frameSize = frameSize;
    this.preSamples = preSamples;
    this.threshold = threshold;
    this.minRms = minRms;
    this.refractorySamples = Math.floor((sampleRate * refractoryMs) / 1000);
    this.blockSize = 128;
    this.ring = new Float32Array(sampleRate * 2);
    this.total = 0;                 // absolute samples consumed
    this.noiseEma = 1e-4;
    this.emaAlpha = 0.02;           // per 128-sample block
    this.lastTriggerAt = -Infinity;
    this.pendingPeakAt = null;      // absolute index of triggering block start
    this.onFrame = null;
    this._block = new Float32Array(this.blockSize);
    this._blockFill = 0;
  }

  push(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      this.ring[this.total % this.ring.length] = chunk[i];
      this.total++;
      this._block[this._blockFill++] = chunk[i];
      if (this._blockFill === this.blockSize) {
        this._processBlock();
        this._blockFill = 0;
      }
      this._maybeEmit();
    }
  }

  _processBlock() {
    let sum = 0;
    for (let i = 0; i < this.blockSize; i++) sum += this._block[i] * this._block[i];
    const rms = Math.sqrt(sum / this.blockSize);
    const triggered =
      rms > this.minRms &&
      rms > this.threshold * this.noiseEma &&
      this.total - this.lastTriggerAt > this.refractorySamples &&
      this.pendingPeakAt === null;
    if (triggered) {
      this.lastTriggerAt = this.total;
      this.pendingPeakAt = this.total - this.blockSize;
    } else if (rms < this.threshold * this.noiseEma) {
      // only adapt the floor to quiet blocks so a tap doesn't poison it
      this.noiseEma += this.emaAlpha * (rms - this.noiseEma);
      if (this.noiseEma < 1e-6) this.noiseEma = 1e-6;
    }
  }

  _maybeEmit() {
    if (this.pendingPeakAt === null) return;
    const start = this.pendingPeakAt - this.preSamples;
    const end = start + this.frameSize;
    if (this.total < end || start < 0) return;
    if (this.total - start > this.ring.length) { this.pendingPeakAt = null; return; }
    const frame = new Float32Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i++) frame[i] = this.ring[(start + i) % this.ring.length];
    this.pendingPeakAt = null;
    if (this.onFrame) this.onFrame(frame);
  }
}
