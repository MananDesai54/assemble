// Camera wave detection: mean grayscale frame-diff per screen half,
// then "one side busy, other side quiet, sustained" = a wave.

export interface RegionScores {
  left: number;
  right: number;
}

export type WaveSide = 'left' | 'right';

export function regionMotion(
  prev: Uint8ClampedArray,
  cur: Uint8ClampedArray,
  width: number,
  height: number,
): RegionScores {
  let left = 0, right = 0;
  const half = width / 2;
  const nPer = (width * height) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gPrev = (prev[i] + prev[i + 1] + prev[i + 2]) / 3;
      const gCur = (cur[i] + cur[i + 1] + cur[i + 2]) / 3;
      const d = Math.abs(gCur - gPrev);
      if (x < half) left += d; else right += d;
    }
  }
  return { left: left / nPer, right: right / nPer };
}

export class WaveDetector {
  thresh: number;
  frames: number;
  refractoryMs: number;
  private runSide: WaveSide | null = null;
  private runLen = 0;
  private lastFire = -Infinity;

  constructor({ thresh = 12, frames = 3, refractoryMs = 1500 }:
    { thresh?: number; frames?: number; refractoryMs?: number } = {}) {
    this.thresh = thresh;
    this.frames = frames;
    this.refractoryMs = refractoryMs;
  }

  push({ left, right }: RegionScores, tMs: number): WaveSide | null {
    const side: WaveSide | null =
      left > this.thresh && left > right * 2 ? 'left' :
      right > this.thresh && right > left * 2 ? 'right' : null;
    if (side && side === this.runSide) this.runLen++;
    else { this.runSide = side; this.runLen = side ? 1 : 0; }
    if (side && this.runLen >= this.frames && tMs - this.lastFire >= this.refractoryMs) {
      this.lastFire = tMs;
      this.runLen = 0;
      return side;
    }
    return null;
  }
}
