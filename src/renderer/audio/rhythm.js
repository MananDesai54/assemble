// Groups taps into per-zone patterns: N taps in the same zone with < gapMs
// between them = one pattern of count N (clamped to maxCount).
// push() returns a completed pattern when a new one interrupts it;
// flush(t) returns the pending pattern once the gap has passed.
export class RhythmMatcher {
  constructor({ gapMs = 600, maxCount = 3 } = {}) {
    this.gapMs = gapMs;
    this.maxCount = maxCount;
    this.cur = null;
  }

  push(zone, t) {
    let completed = null;
    if (this.cur && (zone !== this.cur.zone || t - this.cur.last > this.gapMs)) {
      completed = this._close();
    }
    if (!this.cur) this.cur = { zone, count: 0, last: t };
    this.cur.count = Math.min(this.cur.count + 1, this.maxCount);
    this.cur.last = t;
    return completed;
  }

  flush(t) {
    if (this.cur && t - this.cur.last > this.gapMs) return this._close();
    return null;
  }

  _close() {
    const { zone, count } = this.cur;
    this.cur = null;
    return { zone, count };
  }
}
