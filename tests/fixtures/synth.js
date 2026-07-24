export const ZONE_FREQS = { tl: 800, tr: 1500, bl: 400, br: 2500 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthTap({ freq, sampleRate = 44100, length = 4096, decay = 18, seed = 1, amp = 0.8 } = {}) {
  const rand = mulberry32(seed);
  const out = new Float32Array(length);
  // slight per-sample randomness models real-world variation between taps
  const f2 = freq * 2.7, f3 = freq * 0.5;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-decay * t * 10);
    out[i] = amp * env * (
      Math.sin(2 * Math.PI * freq * t) +
      0.5 * Math.sin(2 * Math.PI * f2 * t) +
      0.3 * Math.sin(2 * Math.PI * f3 * t)
    ) + (rand() - 0.5) * 0.01;
  }
  return out;
}

export function noiseFloor(length, level = 0.001, seed = 42) {
  const rand = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (rand() - 0.5) * 2 * level;
  return out;
}

export function embed(stream, tap, offset) {
  for (let i = 0; i < tap.length && offset + i < stream.length; i++) stream[offset + i] += tap[i];
  return stream;
}
