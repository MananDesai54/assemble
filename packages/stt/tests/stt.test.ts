import { describe, it, expect } from 'vitest';
import { transcribe } from '../src/index';

describe('transcribe', () => {
  it('spawns whisper-cli with model + file and returns trimmed text', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const out = await transcribe('/tmp/call.wav', {
      modelPath: '/models/ggml-medium.bin',
      binPath: 'whisper-cli',
      execFile: async (file, args) => { calls.push({ file, args }); return { stdout: '  hello world \n' }; },
    });
    expect(out).toBe('hello world');
    expect(calls[0].file).toBe('whisper-cli');
    expect(calls[0].args).toContain('/tmp/call.wav');
    expect(calls[0].args).toContain('/models/ggml-medium.bin');
    expect(calls[0].args).toContain('--no-timestamps');
  });
});
