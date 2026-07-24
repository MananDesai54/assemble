import { describe, it, expect } from 'vitest';
import { TransientDetector } from '../src/renderer/audio/transient-detector.js';
import { synthTap, noiseFloor, embed, ZONE_FREQS } from './fixtures/synth.js';

const SR = 44100;

function run(stream, opts = {}) {
  const det = new TransientDetector({ sampleRate: SR, ...opts });
  const frames = [];
  det.onFrame = f => frames.push(f);
  for (let i = 0; i < stream.length; i += 128) det.push(stream.subarray(i, Math.min(i + 128, stream.length)));
  return frames;
}

describe('TransientDetector', () => {
  it('detects two separated taps', () => {
    const stream = noiseFloor(SR * 2);
    embed(stream, synthTap({ freq: ZONE_FREQS.tl }), Math.floor(SR * 0.5));
    embed(stream, synthTap({ freq: ZONE_FREQS.br, seed: 2 }), Math.floor(SR * 1.2));
    const frames = run(stream);
    expect(frames.length).toBe(2);
    expect(frames[0].length).toBe(4096);
  });

  it('captured frame contains the tap energy', () => {
    const stream = noiseFloor(SR * 1);
    embed(stream, synthTap({ freq: 1000 }), Math.floor(SR * 0.5));
    const [frame] = run(stream);
    const rms = Math.sqrt(frame.reduce((s, x) => s + x * x, 0) / frame.length);
    expect(rms).toBeGreaterThan(0.05);
  });

  it('ignores pure noise', () => {
    expect(run(noiseFloor(SR * 2)).length).toBe(0);
  });

  it('refractory: taps 100ms apart fire once', () => {
    const stream = noiseFloor(SR * 1);
    embed(stream, synthTap({ freq: 800 }), Math.floor(SR * 0.4));
    embed(stream, synthTap({ freq: 800, seed: 3 }), Math.floor(SR * 0.5));
    expect(run(stream).length).toBe(1);
  });
});
