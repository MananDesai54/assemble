export interface RhythmPattern {
  zone: string;
  count: number;
}

// Groups taps into per-zone patterns: N taps in the same zone with < gapMs
// between them = one pattern of count N (clamped to maxCount).
// push() returns a completed pattern when a new one interrupts it;
// flush(t) returns the pending pattern once the gap has passed.
export class RhythmMatcher {
  gapMs: number;
  maxCount: number;
  private cur: { zone: string; count: number; last: number } | null = null;

  constructor({ gapMs = 600, maxCount = 3 }: { gapMs?: number; maxCount?: number } = {}) {
    this.gapMs = gapMs;
    this.maxCount = maxCount;
  }

  push(zone: string, t: number): RhythmPattern | null {
    let completed: RhythmPattern | null = null;
    if (this.cur && (zone !== this.cur.zone || t - this.cur.last > this.gapMs)) {
      completed = this._close();
    }
    if (!this.cur) this.cur = { zone, count: 0, last: t };
    this.cur.count = Math.min(this.cur.count + 1, this.maxCount);
    this.cur.last = t;
    return completed;
  }

  flush(t: number): RhythmPattern | null {
    if (this.cur && t - this.cur.last > this.gapMs) return this._close();
    return null;
  }

  private _close(): RhythmPattern {
    const { zone, count } = this.cur!;
    this.cur = null;
    return { zone, count };
  }
}
