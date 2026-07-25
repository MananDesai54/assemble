import { describe, it, expect } from 'vitest';
import type { IntegrationContext } from '@assemble/core';
import { linearIntegration } from '../src/index';

const ctx = (key: string | null): IntegrationContext => ({
  kv: { get: k => (k === 'linear_api_key' ? key : null), set: () => {}, del: () => {} },
  db: null,
  broadcast: () => {},
  llm: async () => null,
  notify: () => {},
});

describe('linear manifest', () => {
  it('has catalog metadata', () => {
    expect(linearIntegration.id).toBe('linear');
    expect(linearIntegration.icon).toContain('<svg');
    expect(linearIntegration.connectFields[0].key).toBe('linear_api_key');
  });

  it('status is disconnected without a key', async () => {
    delete process.env.LINEAR_API_KEY;
    const s = await linearIntegration.status(ctx(null));
    expect(s.connected).toBe(false);
  });

  it('status with a key present returns connected without any network call', async () => {
    delete process.env.LINEAR_API_KEY;
    const s = await linearIntegration.status(ctx('lin_api_test'));
    expect(s.connected).toBe(true);
  });

  it('start throws without a key', async () => {
    delete process.env.LINEAR_API_KEY;
    await expect(linearIntegration.start(ctx(null))).rejects.toThrow('Linear key missing');
  });
});
