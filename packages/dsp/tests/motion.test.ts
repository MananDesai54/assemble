import { describe, it, expect } from 'vitest';
import { regionMotion, WaveDetector } from '@assemble/dsp';

const W = 16, H = 12;

function frame(fill = 0) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = fill; d[i + 3] = 255; }
  return d;
}

function withHalf(base: Uint8ClampedArray, side: 'left' | 'right', fill: number) {
  const d = new Uint8ClampedArray(base);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inLeft = x < W / 2;
      if ((side === 'left' && inLeft) || (side === 'right' && !inLeft)) {
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = fill;
      }
    }
  return d;
}

describe('regionMotion', () => {
  it('no motion between identical frames', () => {
    const m = regionMotion(frame(50), frame(50), W, H);
    expect(m.left).toBe(0);
    expect(m.right).toBe(0);
  });

  it('detects which half moved', () => {
    const a = frame(50);
    const m = regionMotion(a, withHalf(a, 'left', 200), W, H);
    expect(m.left).toBeGreaterThan(50);
    expect(m.right).toBe(0);
  });
});

describe('WaveDetector', () => {
  it('sustained one-sided motion fires that side once', () => {
    const d = new WaveDetector({ thresh: 20, frames: 3, refractoryMs: 1500 });
    const hits: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = d.push({ left: 60, right: 2 }, i * 100);
      if (r) hits.push(r);
    }
    expect(hits).toEqual(['left']);
  });

  it('two-sided motion (walking by) does not fire', () => {
    const d = new WaveDetector({ thresh: 20, frames: 3 });
    for (let i = 0; i < 6; i++) expect(d.push({ left: 60, right: 55 }, i * 100)).toBe(null);
  });

  it('fires again after refractory', () => {
    const d = new WaveDetector({ thresh: 20, frames: 3, refractoryMs: 1000 });
    const hits: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = d.push({ left: 60, right: 2 }, i * 100);
      if (r) hits.push(r);
    }
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
