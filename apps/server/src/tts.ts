import { join } from 'node:path';
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { MODELS_DIR } from './paths';

// Kokoro-82M v1.0 (ONNX, q8 ≈ 92 MB) — local neural TTS, downloaded once
// into the assemble models dir, never the repo.
(env as { cacheDir: string }).cacheDir = join(MODELS_DIR, 'kokoro');

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export interface KokoroVoice { id: string; label: string; lang: 'en' }

// The ONNX pack ships English voices only (the PyTorch release also has
// Hindi — not available here). Devanagari replies fall back to the system
// Hindi voice in the renderer.
export const KOKORO_VOICES: KokoroVoice[] = [
  { id: 'af_heart', label: 'Heart — US female (best)', lang: 'en' },
  { id: 'af_bella', label: 'Bella — US female', lang: 'en' },
  { id: 'af_nicole', label: 'Nicole — US female (soft)', lang: 'en' },
  { id: 'af_sky', label: 'Sky — US female', lang: 'en' },
  { id: 'am_michael', label: 'Michael — US male', lang: 'en' },
  { id: 'am_puck', label: 'Puck — US male', lang: 'en' },
  { id: 'am_fenrir', label: 'Fenrir — US male (deep)', lang: 'en' },
  { id: 'bf_emma', label: 'Emma — UK female', lang: 'en' },
  { id: 'bf_isabella', label: 'Isabella — UK female', lang: 'en' },
  { id: 'bm_george', label: 'George — UK male', lang: 'en' },
  { id: 'bm_daniel', label: 'Daniel — UK male', lang: 'en' },
];

let ttsPromise: Promise<KokoroTTS> | null = null;
let loaded = false;

export const kokoroLoaded = () => loaded;

export function getKokoro(onProgress?: (line: string) => void): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      progress_callback: (p: any) => {
        if (p?.status === 'progress' && p.progress && onProgress) {
          onProgress(`downloading voice model — ${p.file} ${p.progress.toFixed(0)}%`);
        }
      },
    }).then(t => { loaded = true; return t; })
      .catch(err => { ttsPromise = null; throw err; }); // retryable
  }
  return ttsPromise;
}

function encodeWavPcm16(samples: Float32Array, rate: number): Uint8Array {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return new Uint8Array(buf);
}

export async function synthWav(text: string, voice: string, onProgress?: (line: string) => void): Promise<Uint8Array> {
  const tts = await getKokoro(onProgress);
  const audio = await tts.generate(text, { voice: voice as never });
  return encodeWavPcm16(audio.audio as Float32Array, audio.sampling_rate);
}
