export const BANDS = 32;
const MAX_FREQ = 8000; // taps carry little useful energy above this
const ANALYSIS = 2048; // ~46ms @ 44.1k — covers the tap, excludes tail noise

// In-place iterative radix-2 Cooley-Tukey. Lengths must be powers of two.
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}

export function fingerprint(frame: Float32Array, sampleRate = 44100): Float64Array {
  // Tap onset sits near the frame START (detector places peak preSamples in),
  // so a symmetric Hann would zero it out. Analyze the first ANALYSIS samples
  // with a flat window + cosine fade-out tail (Tukey-style).
  const n = ANALYSIS;
  const flatEnd = Math.floor(n * 0.75);
  const re = new Float64Array(n), im = new Float64Array(n);
  const m = Math.min(frame.length, n);
  for (let i = 0; i < m; i++) {
    const w = i < flatEnd ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - flatEnd)) / (n - flatEnd)));
    re[i] = frame[i] * w;
  }
  fft(re, im);
  const maxBin = Math.min(n / 2, Math.floor((MAX_FREQ / sampleRate) * n));
  // log-spaced band edges from bin 2 → maxBin
  const v = new Float64Array(BANDS);
  const energies = new Float64Array(BANDS);
  const logLo = Math.log(2), logHi = Math.log(maxBin);
  let maxE = 0;
  for (let b = 0; b < BANDS; b++) {
    const lo = Math.floor(Math.exp(logLo + ((logHi - logLo) * b) / BANDS));
    const hi = Math.max(lo + 1, Math.floor(Math.exp(logLo + ((logHi - logLo) * (b + 1)) / BANDS)));
    let e = 0;
    for (let k = lo; k < hi && k < maxBin; k++) e += re[k] * re[k] + im[k] * im[k];
    energies[b] = e / (hi - lo);
    if (energies[b] > maxE) maxE = energies[b];
  }
  // floor at -50dB below frame max: near-empty bands stop encoding random noise
  const floor = maxE * 1e-5 + 1e-12;
  for (let b = 0; b < BANDS; b++) v[b] = Math.log(Math.max(energies[b], floor));
  // mean-center then unit-normalize → gain invariant
  const mean = v.reduce((s, x) => s + x, 0) / BANDS;
  let norm = 0;
  for (let b = 0; b < BANDS; b++) { v[b] -= mean; norm += v[b] * v[b]; }
  norm = Math.sqrt(norm) || 1;
  for (let b = 0; b < BANDS; b++) v[b] /= norm;
  return v;
}

export function dist(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}
