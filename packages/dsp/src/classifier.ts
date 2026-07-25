import { dist } from './fingerprint';
import { REJECT_LABEL, type ClassifierJSON } from '@assemble/core';

export interface Classification {
  label: string;
  confidence: number;
  distance: number;
}

// k-NN over calibration fingerprints with distance + margin gates.
export class TapClassifier {
  k: number;
  maxDistance: number;
  minMargin: number;
  samples: { label: string; vec: number[] }[] = [];

  constructor({ k = 3, maxDistance = 0.9, minMargin = 0.05 }: Partial<ClassifierJSON> = {}) {
    this.k = k;
    this.maxDistance = maxDistance;
    this.minMargin = minMargin;
  }

  addSample(label: string, vec: ArrayLike<number>): void {
    this.samples.push({ label, vec: Array.from(vec) });
  }
  clearAll(): void { this.samples = []; }
  clear(label: string): void { this.samples = this.samples.filter(s => s.label !== label); }
  counts(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const s of this.samples) c[s.label] = (c[s.label] || 0) + 1;
    return c;
  }

  classify(vec: ArrayLike<number>): Classification {
    if (this.samples.length === 0) return { label: REJECT_LABEL, confidence: 0, distance: Infinity };
    const scored = this.samples
      .map(s => ({ label: s.label, d: dist(s.vec, vec) }))
      .sort((a, b) => a.d - b.d);
    const top = scored.slice(0, Math.min(this.k, scored.length));
    const votes: Record<string, number> = {};
    for (const t of top) votes[t.label] = (votes[t.label] || 0) + 1;
    const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
    const dWin = scored.find(s => s.label === winner)!.d;
    const other = scored.find(s => s.label !== winner);
    const margin = other ? other.d - dWin : Infinity;
    if (winner === REJECT_LABEL) return { label: REJECT_LABEL, confidence: 1, distance: dWin };
    if (dWin > this.maxDistance || margin < this.minMargin)
      return { label: REJECT_LABEL, confidence: 0, distance: dWin };
    const confidence = Math.max(0, Math.min(1, 1 - dWin / this.maxDistance));
    return { label: winner, confidence, distance: dWin };
  }

  toJSON(): ClassifierJSON {
    return { k: this.k, maxDistance: this.maxDistance, minMargin: this.minMargin, samples: this.samples };
  }

  static fromJSON(json: ClassifierJSON, opts: Partial<ClassifierJSON> = {}): TapClassifier {
    const c = new TapClassifier({ k: json.k, maxDistance: json.maxDistance, minMargin: json.minMargin, ...opts });
    c.samples = (json.samples || []).map(s => ({ label: s.label, vec: Array.from(s.vec) }));
    return c;
  }
}
