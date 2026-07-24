import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/main/config-store.js';

const fresh = () => new ConfigStore(join(mkdtempSync(join(tmpdir(), 'assemble-')), 'config.json'));

describe('ConfigStore', () => {
  it('returns defaults when file missing', () => {
    const s = fresh();
    const c = s.get();
    expect(c.armed).toBe(true);
    expect(c.zones.tl.action).toBe(null);
    expect(c.classifier).toBe(null);
  });

  it('set() persists and get() re-reads after new instance', () => {
    const s = fresh();
    s.set({ sensitivity: 9, zones: { tl: { action: { type: 'shell', value: 'say hi' } } } });
    const s2 = new ConfigStore(s.filePath);
    expect(s2.get().sensitivity).toBe(9);
    expect(s2.get().zones.tl.action.value).toBe('say hi');
    expect(s2.get().zones.br.action).toBe(null); // merge kept other zones
    expect(existsSync(s.filePath)).toBe(true);
  });

  it('survives corrupt file', () => {
    const s = fresh();
    s.set({ sensitivity: 9 });
    writeFileSync(s.filePath, '{nope');
    expect(new ConfigStore(s.filePath).get().sensitivity).toBe(6);
  });
});
