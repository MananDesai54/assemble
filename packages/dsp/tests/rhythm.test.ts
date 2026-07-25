import { describe, it, expect } from 'vitest';
import { RhythmMatcher } from '@assemble/dsp';

describe('RhythmMatcher', () => {
  it('single tap completes on flush after the gap', () => {
    const m = new RhythmMatcher({ gapMs: 600 });
    expect(m.push('tl', 1000)).toBe(null);
    expect(m.flush(1400)).toBe(null);           // gap not over yet
    expect(m.flush(1700)).toEqual({ zone: 'tl', count: 1 });
    expect(m.flush(2000)).toBe(null);            // nothing pending
  });

  it('two taps within the gap = double', () => {
    const m = new RhythmMatcher({ gapMs: 600 });
    m.push('tl', 1000);
    expect(m.push('tl', 1400)).toBe(null);
    expect(m.flush(2100)).toEqual({ zone: 'tl', count: 2 });
  });

  it('three taps = triple; extra taps clamp at maxCount', () => {
    const m = new RhythmMatcher({ gapMs: 600, maxCount: 3 });
    m.push('tl', 1000); m.push('tl', 1300); m.push('tl', 1600); m.push('tl', 1900);
    expect(m.flush(2600)).toEqual({ zone: 'tl', count: 3 });
  });

  it('tap in a different zone closes the previous pattern immediately', () => {
    const m = new RhythmMatcher({ gapMs: 600 });
    m.push('tl', 1000);
    expect(m.push('br', 1200)).toEqual({ zone: 'tl', count: 1 });
    expect(m.flush(1900)).toEqual({ zone: 'br', count: 1 });
  });

  it('same zone after the gap closes previous and starts new', () => {
    const m = new RhythmMatcher({ gapMs: 600 });
    m.push('tl', 1000);
    expect(m.push('tl', 1800)).toEqual({ zone: 'tl', count: 1 });
    expect(m.flush(2500)).toEqual({ zone: 'tl', count: 1 });
  });
});
