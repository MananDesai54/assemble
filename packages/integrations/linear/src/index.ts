import { Hono } from 'hono';
import type { IntegrationContext, IntegrationManifest } from '@assemble/core';
import { myIssues } from './api';

export * from './api';

const apiKey = (ctx: IntegrationContext) => ctx.kv.get('linear_api_key') || process.env.LINEAR_API_KEY || '';

export const linearIntegration: IntegrationManifest = {
  id: 'linear',
  name: 'Linear',
  description: 'Your assigned issues, one click away from a Claude Code session.',
  icon: '<svg viewBox="0 0 16 16"><path d="M1 9.5L6.5 15M1 5.5L10.5 15M2 2l12 12M5.5 1L15 10.5" stroke-width="1.6" stroke-linecap="round"/></svg>',
  connectFields: [
    { key: 'linear_api_key', label: 'API key', placeholder: 'lin_api_…', secret: true, help: 'linear.app → Settings → API → personal key.' },
  ],

  async status(ctx) {
    return apiKey(ctx) ? { connected: true } : { connected: false };
  },

  // Pull-based: nothing runs in the background. start() just validates the key.
  async start(ctx) {
    const key = apiKey(ctx);
    if (!key) throw new Error('Linear key missing');
    await myIssues(key);
  },

  async stop() {},

  routes(ctx) {
    const app = new Hono();
    app.get('/issues', async c => {
      const key = apiKey(ctx);
      if (!key) return c.json({ error: 'Linear not connected — open Settings → Integrations' }, 503);
      try { return c.json(await myIssues(key)); }
      catch (err) { return c.json({ error: (err as Error).message }, 502); }
    });
    return app;
  },
};
