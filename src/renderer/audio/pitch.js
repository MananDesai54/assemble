// Normalized-autocorrelation pitch detector for whistle-range tones.
export function detectPitch(frame, sampleRate, { minHz = 400, maxHz = 3200 } = {}) {
  const n = frame.length;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += frame[i] * frame[i];
  if (e0 < 1e-6) return { hz: 0, clarity: 0 };

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minHz));
  let bestLag = 0, bestR = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0, eLag = 0;
    for (let i = 0; i < n - lag; i++) {
      r += frame[i] * frame[i + lag];
      eLag += frame[i + lag] * frame[i + lag];
    }
    const norm = r / Math.sqrt((e0 * eLag) || 1e-12);
    if (norm > bestR) { bestR = norm; bestLag = lag; }
  }
  if (!bestLag) return { hz: 0, clarity: 0 };

  // parabolic interpolation around the peak for sub-sample lag accuracy
  const rAt = lag => {
    if (lag < minLag || lag > maxLag) return 0;
    let r = 0, eLag = 0;
    for (let i = 0; i < n - lag; i++) { r += frame[i] * frame[i + lag]; eLag += frame[i + lag] * frame[i + lag]; }
    return r / Math.sqrt((e0 * eLag) || 1e-12);
  };
  const y1 = rAt(bestLag - 1), y2 = bestR, y3 = rAt(bestLag + 1);
  const denom = y1 - 2 * y2 + y3;
  const shift = denom ? (0.5 * (y1 - y3)) / denom : 0;
  const lag = bestLag + Math.max(-0.5, Math.min(0.5, shift));
  return { hz: sampleRate / lag, clarity: bestR };
}
