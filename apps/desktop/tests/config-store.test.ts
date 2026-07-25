import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/main/config-store';

const fresh = () => new ConfigStore(join(mkdtempSync(join(tmpdir(), 'assemble-')), 'config.json'));

describe('ConfigStore', () => {
  it('returns defaults when file missing', () => {
    const s = fresh();
    const c = s.get();
    expect(c.armed).toBe(true);
    expect(c.zones.tl.actions).toEqual({});
    expect(c.classifier).toBe(null);
  });

  it('set() persists and get() re-reads after new instance', () => {
    const s = fresh();
    s.set({ sensitivity: 9, zones: { tl: { actions: { 1: { type: 'shell', value: 'say hi' } } } } });
    const s2 = new ConfigStore(s.filePath);
    expect(s2.get().sensitivity).toBe(9);
    expect(s2.get().zones.tl.actions['1']!.value).toBe('say hi');
    expect(s2.get().zones.br.actions).toEqual({}); // merge kept other zones
    expect(existsSync(s.filePath)).toBe(true);
  });

  it('migrates legacy zone action to actions map', () => {
    const s = fresh();
    writeFileSync(s.filePath, JSON.stringify({
      zones: { tl: { action: { type: 'shell', value: 'say hi' } } },
    }));
    const c = new ConfigStore(s.filePath).get();
    expect(c.zones.tl.actions['1']!.value).toBe('say hi');
    expect(c.zones.br.actions).toEqual({});
  });

  it('has extras defaults', () => {
    const c = fresh().get();
    expect(c.extras.whistleVolume).toBe(false);
    expect(c.extras.blow.action).toBe(null);
    expect(c.extras.camera.enabled).toBe(false);
  });

  it('reset() restores defaults and persists', () => {
    const s = fresh();
    s.set({ sensitivity: 12, onboarded: true });
    s.reset();
    expect(s.get().sensitivity).toBe(6);
    expect(s.get().onboarded).toBe(false);
    expect(new ConfigStore(s.filePath).get().onboarded).toBe(false);
  });

  it('survives corrupt file', () => {
    const s = fresh();
    s.set({ sensitivity: 9 });
    writeFileSync(s.filePath, '{nope');
    expect(new ConfigStore(s.filePath).get().sensitivity).toBe(6);
  });
});
