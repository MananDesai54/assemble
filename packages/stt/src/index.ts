import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const realExecFile = promisify(nodeExecFile);

export type ExecFileFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

export interface TranscribeOptions {
  modelPath?: string;
  binPath?: string;
  language?: string;
  execFile?: ExecFileFn;
}

// Local speech-to-text via whisper.cpp's CLI (parrot-style: no cloud).
export async function transcribe(
  wavPath: string,
  {
    modelPath = process.env.ASSEMBLE_WHISPER_MODEL || 'models/ggml-medium.bin',
    binPath = process.env.ASSEMBLE_WHISPER_BIN || 'whisper-cli',
    language = 'en',
    execFile = (f, a) => realExecFile(f, a, { maxBuffer: 64 * 1024 * 1024 }),
  }: TranscribeOptions = {},
): Promise<string> {
  const { stdout } = await execFile(binPath, [
    '-m', modelPath,
    '-f', wavPath,
    '-l', language,
    '--no-prints',   // suppress progress/system logs
    '--no-timestamps',
  ]);
  return stdout.trim();
}
