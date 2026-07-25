import { describe, it, expect } from 'vitest';
import { TapClassifier } from '@assemble/dsp';
import { fingerprint } from '@assemble/dsp';
import { synthTap, ZONE_FREQS } from './fixtures/synth';

function trained() {
  const c = new TapClassifier();
  for (const [zone, freq] of Object.entries(ZONE_FREQS))
    for (let s = 0; s < 8; s++)
      c.addSample(zone, fingerprint(synthTap({ freq, seed: s, decay: 18 + (s % 3) })));
  return c;
}

describe('TapClassifier', () => {
  it('classifies held-out taps for every zone', () => {
    const c = trained();
    for (const [zone, freq] of Object.entries(ZONE_FREQS)) {
      const r = c.classify(fingerprint(synthTap({ freq, seed: 99 })));
      expect(r.label).toBe(zone);
      expect(r.confidence).toBeGreaterThan(0.5);
    }
  });

  it('rejects an unfamiliar sound as ultron', () => {
    const c = trained();
    const weird = fingerprint(synthTap({ freq: 6000, decay: 3, seed: 7 }));
    expect(c.classify(weird).label).toBe('ultron');
  });

  it('explicit ultron negatives win over stretched zone matches', () => {
    const c = trained();
    for (let s = 0; s < 8; s++)
      c.addSample('ultron', fingerprint(synthTap({ freq: 3600, decay: 5, seed: s })));
    const r = c.classify(fingerprint(synthTap({ freq: 3600, decay: 5, seed: 50 })));
    expect(r.label).toBe('ultron');
  });

  it('JSON round-trip preserves behavior', () => {
    const c = trained();
    const c2 = TapClassifier.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    const v = fingerprint(synthTap({ freq: ZONE_FREQS.bl, seed: 77 }));
    expect(c2.classify(v).label).toBe(c.classify(v).label);
  });

  it('clear(label) removes only that label', () => {
    const c = trained();
    c.clear('tl');
    const counts = c.counts();
    expect(counts.tl).toBeUndefined();
    expect(counts.tr).toBe(8);
  });

  it('empty classifier rejects everything', () => {
    const c = new TapClassifier();
    expect(c.classify(fingerprint(synthTap({ freq: 800 }))).label).toBe('ultron');
  });
});
