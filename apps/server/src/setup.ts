import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS_DIR, BIN_DIR } from './paths';

export interface SetupStatus {
  brew: boolean;
  llamaCpp: boolean;
  whisperCpp: boolean;
  whisperModel: boolean;
  kokoroModel: boolean;
  audiotap: boolean;
  swiftc: boolean;
  llmRunning: boolean;
  claudeCli: boolean;
  steps: SetupStep[];
}

export interface WhisperModel {
  id: string;
  label: string;
  file: string;
  size: string;
  speed: string;
  quality: string;
  notes: string;
}

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: 'small', label: 'Whisper small', file: 'ggml-small.bin',
    size: '0.5 GB', speed: 'Fastest (~10× realtime)',
    quality: 'Good English · fair Hindi',
    notes: 'Snappiest voice commands; long Hindi calls will have more errors.',
  },
  {
    id: 'large-v3-turbo', label: 'Whisper large-v3-turbo (recommended)', file: 'ggml-large-v3-turbo.bin',
    size: '1.6 GB', speed: 'Fast (~6× realtime)',
    quality: 'Great English · strong Hindi/Hinglish',
    notes: 'Best balance of speed and accuracy for mixed-language use.',
  },
  {
    id: 'large-v3', label: 'Whisper large-v3', file: 'ggml-large-v3.bin',
    size: '2.9 GB', speed: '~2× slower than turbo',
    quality: 'Maximum accuracy, all languages',
    notes: 'For long, important calls and heavy accents. Transcription takes noticeably longer.',
  },
];
export const DEFAULT_WHISPER = 'large-v3-turbo';
export const whisperModel = (id: string): WhisperModel =>
  WHISPER_MODELS.find(m => m.id === id) ?? WHISPER_MODELS.find(m => m.id === DEFAULT_WHISPER)!;
export const whisperPath = (id: string): string => join(MODELS_DIR, whisperModel(id).file);
export const whisperUrl = (id: string): string =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${whisperModel(id).file}`;

export interface LlmModel {
  id: string;
  label: string;
  hf: string;
  size: string;
  ram: string;
  strengths: string;
  notes: string;
}

export const LLM_MODELS: LlmModel[] = [
  {
    id: 'gemma-4-e4b', label: 'Gemma 4 E4B — light', hf: 'unsloth/gemma-4-E4B-it-GGUF:Q4_K_M',
    size: '~3 GB download', ram: '8 GB+',
    strengths: 'Fast responses, low memory. Decent Hindi/Hinglish.',
    notes: 'Pick on 8–16 GB Macs or if 12B feels slow. Summaries and drafts are simpler.',
  },
  {
    id: 'gemma-4-12b', label: 'Gemma 4 12B (recommended)', hf: 'unsloth/gemma-4-12b-it-GGUF:Q4_K_M',
    size: '~7 GB download', ram: '16 GB+',
    strengths: 'Strong multilingual (Hindi/Hinglish), good drafts + summaries, balanced speed.',
    notes: 'The default. Best all-rounder for Slack triage, digests, call summaries.',
  },
  {
    id: 'gemma-4-26b-a4b', label: 'Gemma 4 26B-A4B — big MoE', hf: 'unsloth/gemma-4-26B-A4B-it-GGUF:Q4_K_M',
    size: '~15 GB download', ram: '24 GB+',
    strengths: 'Noticeably smarter drafts/summaries; MoE keeps it fast (only 4B active per token).',
    notes: 'Pick on 24–32 GB Macs when quality matters more than disk space.',
  },
  {
    id: 'gpt-oss-20b', label: 'gpt-oss-20b — OpenAI open-weight', hf: 'ggml-org/gpt-oss-20b-GGUF',
    size: '~12 GB download', ram: '16–24 GB',
    strengths: 'Strongest reasoning and agent-style tasks. English-first.',
    notes: 'Hindi/Hinglish weaker than Gemma. Pick if your Slack/calls are mostly English and you want the sharpest summaries.',
  },
];
export const DEFAULT_LLM = 'gemma-4-12b';
export const llmModel = (id: string): LlmModel =>
  LLM_MODELS.find(m => m.id === id) ?? LLM_MODELS.find(m => m.id === DEFAULT_LLM)!;
export const AUDIOTAP_BIN = join(BIN_DIR, 'audiotap');
export const KEYWATCH_BIN = join(BIN_DIR, 'keywatch');

const has = (bin: string) => Bun.which(bin) !== null;

export function toolStatus(whisperModelPath: string): Omit<SetupStatus, 'llmRunning' | 'claudeCli' | 'steps'> {
  return {
    brew: has('brew'),
    llamaCpp: has('llama-server'),
    whisperCpp: has('whisper-cli'),
    whisperModel: existsSync(whisperModelPath) && statSync(whisperModelPath).size > 300_000_000,
    kokoroModel: existsSync(KOKORO_MODEL_FILE),
    audiotap: process.platform === 'linux'
      ? has('ffmpeg')
      : existsSync(AUDIOTAP_BIN) && existsSync(KEYWATCH_BIN),
    swiftc: has('swiftc'),
  };
}

export type SetupStep = 'llama.cpp' | 'whisper-cpp' | 'whisper-model' | 'kokoro' | 'audiotap';
export const SETUP_STEPS: SetupStep[] = ['llama.cpp', 'whisper-cpp', 'whisper-model', 'kokoro', 'audiotap'];

// the q8 onnx weights kokoro-js downloads — presence = voice ready
export const KOKORO_MODEL_FILE = join(MODELS_DIR, 'kokoro/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx');

function streamCmd(cmd: string, args: string[], onLine: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (buf: Buffer) => buf.toString().split('\n').filter(Boolean).forEach(onLine);
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', reject);
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}

async function downloadWithProgress(url: string, dest: string, onLine: (l: string) => void): Promise<void> {
  mkdirSync(MODELS_DIR, { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: http ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  const tmp = dest + '.part';
  const out = createWriteStream(tmp);
  let got = 0, lastPct = -10;
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(value);
    got += value.length;
    if (total) {
      const pct = Math.floor((got / total) * 100);
      if (pct >= lastPct + 5) { lastPct = pct; onLine(`downloading… ${pct}% of ${(total / 1e9).toFixed(1)} GB`); }
    }
  }
  await new Promise<void>((r, j) => out.end((err?: Error) => err ? j(err) : r()));
  renameSync(tmp, dest);
  onLine('download complete');
}

export async function runSetupStep(
  step: SetupStep,
  onLine: (l: string) => void,
  { whisperModelPath, whisperModelUrl }: { whisperModelPath: string; whisperModelUrl: string },
): Promise<void> {
  switch (step) {
    case 'llama.cpp':
      if (has('llama-server')) { onLine('already installed'); return; }
      if (!has('brew')) throw new Error('Homebrew required — install from https://brew.sh first');
      onLine('brew install llama.cpp (a few minutes)…');
      return streamCmd('brew', ['install', 'llama.cpp'], onLine);
    case 'whisper-cpp':
      if (has('whisper-cli')) { onLine('already installed'); return; }
      if (!has('brew')) throw new Error('Homebrew required — install from https://brew.sh first');
      onLine('brew install whisper-cpp…');
      return streamCmd('brew', ['install', 'whisper-cpp'], onLine);
    case 'whisper-model':
      if (toolStatus(whisperModelPath).whisperModel) { onLine('already downloaded'); return; }
      onLine('downloading speech model…');
      return downloadWithProgress(whisperModelUrl, whisperModelPath, onLine);
    case 'kokoro': {
      if (existsSync(KOKORO_MODEL_FILE)) { onLine('already downloaded'); return; }
      onLine('downloading voice model (~90 MB)…');
      const { getKokoro } = await import('./tts');
      await getKokoro(onLine);
      onLine('voice ready');
      return;
    }
    case 'audiotap': {
      if (process.platform === 'linux') {
        if (!has('ffmpeg')) throw new Error('ffmpeg required — e.g. sudo apt install ffmpeg');
        onLine('ffmpeg present — mic recording ready (system-audio capture is macOS-only for now)');
        return;
      }
      if (existsSync(AUDIOTAP_BIN) && existsSync(KEYWATCH_BIN)) { onLine('already built'); return; }
      if (!has('swiftc')) throw new Error('Xcode Command Line Tools required — run: xcode-select --install');
      if (!existsSync(AUDIOTAP_BIN)) {
        onLine('compiling audio capture helper…');
        await streamCmd('swiftc', ['-O', 'native/audiotap/main.swift', '-o', AUDIOTAP_BIN], onLine);
      }
      if (!existsSync(KEYWATCH_BIN)) {
        onLine('compiling hotkey helper…');
        await streamCmd('swiftc', ['-O', 'native/keywatch/main.swift', '-o', KEYWATCH_BIN], onLine);
      }
      return;
    }
  }
}
