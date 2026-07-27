import { describe, it, expect } from 'vitest';
import { transcribe, collapseRepeats } from '../src/index';

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

  it('disables cross-window context so hallucination loops cannot propagate', async () => {
    const calls: { args: string[] }[] = [];
    await transcribe('/tmp/call.wav', {
      execFile: async (_f, args) => { calls.push({ args }); return { stdout: 'ok' }; },
    });
    const i = calls[0].args.indexOf('--max-context');
    expect(i).toBeGreaterThan(-1);
    expect(calls[0].args[i + 1]).toBe('0');
  });

  it('collapses decoder repetition loops in the output', async () => {
    const loop = 'अच्छी कोपी किया है '.repeat(12) + 'ग ग ग ग ग ग ग';
    const out = await transcribe('/tmp/call.wav', {
      execFile: async () => ({ stdout: `real speech. ${loop}` }),
    });
    expect(out).toBe('real speech. अच्छी कोपी किया है ग');
  });
});

describe('collapseRepeats', () => {
  it('keeps twice-repeated phrases (legit speech)', () => {
    expect(collapseRepeats('ठीक है ठीक है chalo done')).toBe('ठीक है ठीक है chalo done');
  });

  it('collapses 3+ consecutive repeats to one', () => {
    expect(collapseRepeats('yes, yes, yes, yes, moving on')).toBe('yes, moving on');
  });

  it('leaves normal prose untouched', () => {
    const t = 'The team will proceed with showing the pending items to the client.';
    expect(collapseRepeats(t)).toBe(t);
  });
});
