import { describe, it, expect } from 'vitest';
import { detectPitch } from '../src/renderer/audio/pitch.js';
import { WhistleController } from '../src/renderer/audio/whistle.js';
import { mulberry32 } from './fixtures/synth.js';

const SR = 44100;

function sine(freq, length, amp = 0.3) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

function noise(length, amp = 0.1, seed = 5) {
  const rand = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (rand() - 0.5) * 2 * amp;
  return out;
}

describe('detectPitch', () => {
  it('finds the frequency of a pure tone within 3%', () => {
    for (const f of [600, 1000, 2000]) {
      const { hz, clarity } = detectPitch(sine(f, 1024), SR);
      expect(Math.abs(hz - f) / f).toBeLessThan(0.03);
      expect(clarity).toBeGreaterThan(0.9);
    }
  });

  it('reports low clarity for noise and silence', () => {
    expect(detectPitch(noise(1024), SR).clarity).toBeLessThan(0.6);
    expect(detectPitch(new Float32Array(1024), SR).clarity).toBe(0);
  });
});

describe('WhistleController', () => {
  function feed(ctrl, samples, startMs) {
    const events = [];
    const chunk = 512;
    for (let i = 0; i < samples.length; i += chunk) {
      const tMs = startMs + (i / SR) * 1000;
      events.push(...ctrl.push(samples.subarray(i, Math.min(i + chunk, samples.length)), tMs));
    }
    return events;
  }

  it('rising whistle emits +1 steps', () => {
    const c = new WhistleController({ sampleRate: SR });
    feed(c, sine(800, SR * 0.4), 0);                 // establish
    const ev = feed(c, sine(1000, SR * 0.4), 400);   // ~386 cents up
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every(e => e.dir === 1)).toBe(true);
  });

  it('falling whistle emits -1 steps', () => {
    const c = new WhistleController({ sampleRate: SR });
    feed(c, sine(1200, SR * 0.4), 0);
    const ev = feed(c, sine(950, SR * 0.4), 400);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every(e => e.dir === -1)).toBe(true);
  });

  it('noise and short blips emit nothing', () => {
    const c = new WhistleController({ sampleRate: SR });
    expect(feed(c, noise(SR * 0.5), 0)).toEqual([]);
    expect(feed(c, sine(900, 2048), 500)).toEqual([]); // ~46ms blip, under min duration
  });
});
