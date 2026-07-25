import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wavFromPcm, isNoiseSegment, LiveTranscriber } from '../src/live-stt';

describe('wavFromPcm', () => {
  it('builds a valid 16kHz mono 16-bit header', () => {
    const pcm = Buffer.alloc(32_000); // 1s
    const wav = wavFromPcm(pcm);
    expect(wav.length).toBe(44 + 32_000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16_000);  // sample rate
    expect(wav.readUInt16LE(22)).toBe(1);       // mono
    expect(wav.readUInt32LE(40)).toBe(32_000);  // data size
  });
});

describe('isNoiseSegment', () => {
  it('drops whisper silence hallucinations, keeps speech', () => {
    expect(isNoiseSegment('[BLANK_AUDIO]')).toBe(true);
    expect(isNoiseSegment(' . . . ')).toBe(true);
    expect(isNoiseSegment('')).toBe(true);
    expect(isNoiseSegment('chalo shuru karte hain')).toBe(false);
  });
});

describe('LiveTranscriber', () => {
  it('tails a growing wav, transcribes new audio, drains on stop', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-stt-'));
    const wavPath = join(dir, 'call.wav');
    writeFileSync(wavPath, wavFromPcm(Buffer.alloc(64_000))); // header + 2s
    const seen: string[] = [];
    let n = 0;
    const lt = new LiveTranscriber({
      wavPath,
      modelPath: '/nonexistent-model',
      intervalMs: 30,
      onSegment: s => seen.push(s),
      transcribeFn: async () => `seg${++n}`,
    });
    lt.start();
    await new Promise(r => setTimeout(r, 100)); // first tick eats the 2s
    appendFileSync(wavPath, Buffer.alloc(96_000)); // +3s of audio
    await new Promise(r => setTimeout(r, 100));
    const transcript = await lt.stop();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(transcript).toBe(seen.join(' '));
    expect(transcript).toContain('seg1');
  });
});
