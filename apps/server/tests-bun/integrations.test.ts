import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { IntegrationContext, IntegrationManifest } from '@assemble/core';
import { registry, connectIntegration, disconnectIntegration } from '../src/integrations';

function makeCtx(): IntegrationContext {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)`);
  return {
    kv: {
      get: k => (db.query<{ value: string }, [string]>(`SELECT value FROM kv WHERE key = ?`).get(k)?.value ?? null),
      set: (k, v) => db.run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]),
      del: k => db.run(`DELETE FROM kv WHERE key = ?`, [k]),
    },
    db, broadcast: () => {}, llm: async () => null, notify: () => {},
  };
}

describe('registry', () => {
  it('has unique ids, fields, and svg icons', () => {
    const ids = registry.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of registry) {
      expect(m.connectFields.length).toBeGreaterThan(0);
      expect(m.icon).toContain('<svg');
      expect(m.name.length).toBeGreaterThan(0);
    }
  });

  it('connect saves fields, starts, and reports status; disconnect stops and clears', async () => {
    const ctx = makeCtx();
    let started = 0, stopped = 0;
    const fake: IntegrationManifest = {
      id: 'fake', name: 'Fake', description: '', icon: '<svg/>',
      connectFields: [{ key: 'fake_token', label: 'Token', placeholder: 't', secret: true }],
      status: async c => ({ connected: Boolean(c.kv.get('fake_token')) && started > stopped }),
      start: async c => { if (!c.kv.get('fake_token')) throw new Error('missing'); started++; },
      stop: async () => { stopped++; },
      routes: () => null,
    };
    registry.push(fake);
    try {
      const s = await connectIntegration(ctx, 'fake', { fake_token: '  abc  ' });
      expect(s.connected).toBe(true);
      expect(ctx.kv.get('fake_token')).toBe('abc'); // trimmed
      expect(started).toBe(1);

      await disconnectIntegration(ctx, 'fake');
      expect(stopped).toBeGreaterThan(0);
      expect(ctx.kv.get('fake_token')).toBe(null);
    } finally {
      registry.pop();
    }
  });

  it('connect rejects unknown id and failed start', async () => {
    const ctx = makeCtx();
    await expect(connectIntegration(ctx, 'nope', {})).rejects.toThrow('unknown integration');
    // bun auto-loads .env — blank the fallbacks so slack start fails fast without tokens
    process.env.SLACK_USER_TOKEN = '';
    await expect(connectIntegration(ctx, 'slack', {})).rejects.toThrow();
  });
});
