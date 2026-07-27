import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const realExecFile = promisify(nodeExecFile);

export type ExecFileFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

export interface TranscribeOptions {
  modelPath?: string;
  binPath?: string;
  /** 'auto' detects per file — handles Hindi / Hinglish / Gujarati / English mixing. */
  language?: string;
  execFile?: ExecFileFn;
}

// Local speech-to-text via whisper.cpp's CLI (parrot-style: no cloud).
export async function transcribe(
  wavPath: string,
  {
    modelPath = process.env.ASSEMBLE_WHISPER_MODEL || 'models/ggml-large-v3-turbo.bin',
    binPath = process.env.ASSEMBLE_WHISPER_BIN || 'whisper-cli',
    language = 'auto',
    execFile = (f, a) => realExecFile(f, a, { maxBuffer: 64 * 1024 * 1024 }),
  }: TranscribeOptions = {},
): Promise<string> {
  const { stdout } = await execFile(binPath, [
    '-m', modelPath,
    '-f', wavPath,
    '-l', language,
    '--max-context', '0', // don't carry text context across 30s windows — a
                          // hallucination loop otherwise propagates through
                          // the whole file (25 min call → 1.3k chars of loop)
    '--no-prints',   // suppress progress/system logs
    '--no-timestamps',
  ]);
  return collapseRepeats(stdout.trim());
}

/**
 * Whisper's failure mode on noisy stretches is a decoder loop — the same
 * phrase (or single char) repeated dozens of times. Collapse 3+ consecutive
 * repeats to one instance; real speech rarely repeats a phrase verbatim 3×
 * back-to-back with identical punctuation.
 */
export function collapseRepeats(text: string): string {
  let out = text;
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(/(.{2,120}?)(?:[,.\s]*\1){2,}/gsu, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}
