import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, statSync, mkdirSync, renameSync } from 'node:fs';

export interface SetupStatus {
  brew: boolean;
  llamaCpp: boolean;
  whisperCpp: boolean;
  whisperModel: boolean;
  audiotap: boolean;
  swiftc: boolean;
  llmRunning: boolean;
  slackConfigured: boolean;
  slackConnected: boolean;
}

export const WHISPER_MODEL_PATH = 'models/ggml-medium.bin';
export const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin';
export const AUDIOTAP_BIN = 'native/audiotap/audiotap';

const has = (bin: string) => Bun.which(bin) !== null;

export function toolStatus(): Omit<SetupStatus, 'llmRunning' | 'slackConfigured' | 'slackConnected'> {
  return {
    brew: has('brew'),
    llamaCpp: has('llama-server'),
    whisperCpp: has('whisper-cli'),
    whisperModel: existsSync(WHISPER_MODEL_PATH) && statSync(WHISPER_MODEL_PATH).size > 1_000_000_000,
    audiotap: existsSync(AUDIOTAP_BIN),
    swiftc: has('swiftc'),
  };
}

export type SetupStep = 'llama.cpp' | 'whisper-cpp' | 'whisper-model' | 'audiotap';
export const SETUP_STEPS: SetupStep[] = ['llama.cpp', 'whisper-cpp', 'whisper-model', 'audiotap'];

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
  mkdirSync('models', { recursive: true });
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

export async function runSetupStep(step: SetupStep, onLine: (l: string) => void): Promise<void> {
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
      if (toolStatus().whisperModel) { onLine('already downloaded'); return; }
      onLine('whisper medium model (~1.5 GB)…');
      return downloadWithProgress(WHISPER_MODEL_URL, WHISPER_MODEL_PATH, onLine);
    case 'audiotap':
      if (existsSync(AUDIOTAP_BIN)) { onLine('already built'); return; }
      if (!has('swiftc')) throw new Error('Xcode Command Line Tools required — run: xcode-select --install');
      onLine('compiling audio capture helper…');
      return streamCmd('swiftc', ['-O', 'native/audiotap/main.swift', '-o', AUDIOTAP_BIN], onLine);
  }
}
