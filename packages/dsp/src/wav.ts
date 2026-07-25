// Mono Float32 → 16 kHz 16-bit PCM WAV (linear-interpolation resample).
export const WAV_RATE = 16000;

export function resampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === WAV_RATE) return samples;
  const outLen = Math.floor((samples.length * WAV_RATE) / fromRate);
  const out = new Float32Array(outLen);
  const step = fromRate / WAV_RATE;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

export function encodeWav16k(samples: Float32Array, fromRate: number): ArrayBuffer {
  const pcmF = resampleTo16k(samples, fromRate);
  const buf = new ArrayBuffer(44 + pcmF.length * 2);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + pcmF.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, WAV_RATE, true); v.setUint32(28, WAV_RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, pcmF.length * 2, true);
  for (let i = 0; i < pcmF.length; i++) {
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcmF[i])) * 32767, true);
  }
  return buf;
}
