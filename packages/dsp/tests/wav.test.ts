import { describe, it, expect } from 'vitest';
import { encodeWav16k, resampleTo16k, WAV_RATE } from '../src/wav';

describe('resampleTo16k', () => {
  it('passes through 16k input', () => {
    const x = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleTo16k(x, 16000)).toBe(x);
  });

  it('halves length from 32k and preserves shape', () => {
    const x = new Float32Array(3200).map((_, i) => Math.sin((2 * Math.PI * 100 * i) / 32000));
    const y = resampleTo16k(x, 32000);
    expect(y.length).toBe(1600);
    // peak amplitude survives resampling
    expect(Math.max(...Array.from(y).map(Math.abs))).toBeGreaterThan(0.9);
  });
});

describe('encodeWav16k', () => {
  it('writes valid RIFF header + correct sizes', () => {
    const wav = encodeWav16k(new Float32Array(48000), 48000); // 1s @ 48k → 16000 samples
    const v = new DataView(wav);
    const tag = (off: number, len: number) =>
      String.fromCharCode(...new Uint8Array(wav, off, len));
    expect(tag(0, 4)).toBe('RIFF');
    expect(tag(8, 4)).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(WAV_RATE);
    expect(v.getUint32(40, true)).toBe(16000 * 2);
    expect(wav.byteLength).toBe(44 + 16000 * 2);
  });

  it('clamps out-of-range samples', () => {
    const wav = encodeWav16k(new Float32Array([2, -2]), 16000);
    const v = new DataView(wav);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32767);
  });
});
