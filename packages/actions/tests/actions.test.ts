import { describe, it, expect } from 'vitest';
import { buildCommand, executeAction, SYSTEM_PRESETS } from '@assemble/actions';

describe('buildCommand', () => {
  it('shell passes through', () => {
    expect(buildCommand({ type: 'shell', value: 'say assemble' })).toBe('say assemble');
  });

  it('open URL uses open', () => {
    expect(buildCommand({ type: 'open', value: 'https://x.com' })).toBe("open 'https://x.com'");
  });

  it('open bare name uses open -a', () => {
    expect(buildCommand({ type: 'open', value: 'Spotify' })).toBe("open -a 'Spotify'");
  });

  it('keystroke char with modifiers → osascript keystroke', () => {
    const cmd = buildCommand({ type: 'keystroke', value: 'cmd+shift+4' });
    expect(cmd).toContain('keystroke "4"');
    expect(cmd).toContain('command down');
    expect(cmd).toContain('shift down');
  });

  it('keystroke special key → key code', () => {
    const cmd = buildCommand({ type: 'keystroke', value: 'cmd+return' });
    expect(cmd).toContain('key code 36');
    expect(cmd).toContain('command down');
  });

  it('system presets exist and build', () => {
    for (const p of ['volume-up', 'volume-down', 'mute-toggle', 'lock-screen', 'screenshot', 'screenshot-region', 'display-sleep', 'record-toggle'])
      expect(buildCommand({ type: 'system', value: p })).toBe(SYSTEM_PRESETS[p]);
  });

  it('unknown type throws', () => {
    expect(() => buildCommand({ type: 'nope', value: '' } as any)).toThrow();
  });
});

describe('executeAction', () => {
  it('runs built command through injected exec', async () => {
    const calls: string[] = [];
    await executeAction({ type: 'shell', value: 'echo hi' }, cmd => { calls.push(cmd); return Promise.resolve(); });
    expect(calls).toEqual(['echo hi']);
  });

  it('null action is a no-op', async () => {
    const calls: string[] = [];
    await executeAction(null, cmd => { calls.push(cmd); return Promise.resolve(); });
    expect(calls).toEqual([]);
  });
});
