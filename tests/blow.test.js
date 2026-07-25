import { describe, it, expect } from 'vitest';
import { BlowDetector } from '../src/renderer/audio/blow.js';
import { mulberry32, synthTap } from './fixtures/synth.js';

const SR = 44100;

function noise(length, amp, seed = 9) {
  const rand = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (rand() - 0.5) * 2 * amp;
  return out;
}

function sine(freq, length, amp = 0.3) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

function feed(det, samples, startMs = 0) {
  let fired = 0;
  const chunk = 512;
  for (let i = 0; i < samples.length; i += chunk) {
    const tMs = startMs + (i / SR) * 1000;
    if (det.push(samples.subarray(i, Math.min(i + chunk, samples.length)), tMs)) fired++;
  }
  return fired;
}

describe('BlowDetector', () => {
  it('fires once on sustained loud broadband noise', () => {
    const det = new BlowDetector({ sampleRate: SR });
    expect(feed(det, noise(SR * 0.8, 0.15))).toBe(1);
  });

  it('respects refractory across a long blow', () => {
    const det = new BlowDetector({ sampleRate: SR, refractoryMs: 2000 });
    expect(feed(det, noise(SR * 1.5, 0.15))).toBe(1);
  });

  it('ignores whistles (tonal)', () => {
    const det = new BlowDetector({ sampleRate: SR });
    expect(feed(det, sine(1000, SR * 0.8))).toBe(0);
  });

  it('ignores taps (too short)', () => {
    const det = new BlowDetector({ sampleRate: SR });
    expect(feed(det, synthTap({ freq: 800 }))).toBe(0);
  });

  it('ignores quiet room noise', () => {
    const det = new BlowDetector({ sampleRate: SR });
    expect(feed(det, noise(SR * 1, 0.005))).toBe(0);
  });
});
