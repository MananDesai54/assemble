import { describe, it, expect } from 'vitest';
import { fingerprint, dist, BANDS } from '@assemble/dsp';
import { synthTap, ZONE_FREQS } from './fixtures/synth';

describe('fingerprint', () => {
  it('returns unit-norm vector of BANDS length', () => {
    const v = fingerprint(synthTap({ freq: 800 }));
    expect(v.length).toBe(BANDS);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('same tap → near-zero distance; different zones → clearly larger', () => {
    const a1 = fingerprint(synthTap({ freq: ZONE_FREQS.tl, seed: 1 }));
    const a2 = fingerprint(synthTap({ freq: ZONE_FREQS.tl, seed: 9 }));
    const b  = fingerprint(synthTap({ freq: ZONE_FREQS.br, seed: 1 }));
    expect(dist(a1, a2)).toBeLessThan(0.2);
    expect(dist(a1, b)).toBeGreaterThan(0.5);
  });

  it('all four zone frequencies are mutually separable', () => {
    const vs = Object.values(ZONE_FREQS).map(f => fingerprint(synthTap({ freq: f })));
    for (let i = 0; i < vs.length; i++)
      for (let j = i + 1; j < vs.length; j++)
        expect(dist(vs[i], vs[j])).toBeGreaterThan(0.4);
  });
});
