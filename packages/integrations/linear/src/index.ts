import { Hono } from 'hono';
import type { IntegrationContext, IntegrationManifest } from '@assemble/core';
import { myIssues } from './api';

export * from './api';

const apiKey = (ctx: IntegrationContext) => ctx.kv.get('linear_api_key') || process.env.LINEAR_API_KEY || '';

export const linearIntegration: IntegrationManifest = {
  id: 'linear',
  name: 'Linear',
  description: 'Your assigned issues, one click away from a Claude Code session.',
  icon: '<svg class="brand" viewBox="0 0 100 100"><path fill="#5E6AD2" d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1522c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99128 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3904.3487-.984.3258-1.3541-.0443L12.6587 18.074Z"/></svg>',
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
