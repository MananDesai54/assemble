import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import type { IntegrationContext, IntegrationManifest } from '@assemble/core';
import { startSlack, type SlackIntake } from './intake';
import { ensureSlackTables, insertMessage, recentMessages } from './store';

export * from './intake';
export * from './store';

let intake: SlackIntake | null = null;
let startGen = 0;

const userToken = (ctx: IntegrationContext) =>
  ctx.kv.get('slack_user_token') || process.env.SLACK_USER_TOKEN || '';

export const slackIntegration: IntegrationManifest = {
  id: 'slack',
  name: 'Slack',
  description: 'Listens for new messages in the channels and DMs you are in, as you. Stored locally, nothing else touches them.',
  icon: '<svg class="brand" viewBox="0 0 122.8 122.8"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A"/><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E"/></svg>',
  connectFields: [
    { key: 'slack_user_token', label: 'User token', placeholder: 'xoxp-… user OAuth token', secret: true, help: 'api.slack.com → your app → OAuth & Permissions → User OAuth Token. Listens to what you can read — no bot invites, no extra setup.' },
  ],

  async status() {
    return intake ? { connected: true, detail: 'listening for new messages' } : { connected: false };
  },

  async start(ctx) {
    await this.stop();
    const token = userToken(ctx);
    if (!token) throw new Error('Slack user token missing');
    const db = ctx.db as Database;
    ensureSlackTables(db);
    const gen = ++startGen;
    const fresh = await startSlack({
      userToken: token,
      onMessage: m => {
        const id = insertMessage(db, m);
        if (id === null) return;
        console.log(`[${m.channelName ?? m.channel}] ${m.userName ?? m.user}: ${m.text.slice(0, 80)}`);
        ctx.broadcast({ kind: 'slack-message', message: m });
      },
    });
    if (gen !== startGen || intake) {
      // a newer start() won the race (or one already landed) — discard this poller
      await fresh.stop().catch(() => {});
      return;
    }
    intake = fresh;
    ctx.broadcast({ kind: 'slack-connected' });
  },

  async stop() {
    startGen++;
    if (intake) { await intake.stop().catch(() => {}); intake = null; }
  },

  routes(ctx) {
    const db = ctx.db as Database;
    ensureSlackTables(db); // routes can be hit before first connect
    const app = new Hono();
    app.get('/recent', c => {
      const limit = Math.min(200, Number(c.req.query('limit') || 50));
      return c.json(recentMessages(db, limit));
    });
    return app;
  },
};
