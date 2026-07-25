import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { WebClient } from '@slack/web-api';
import type { IntegrationContext, IntegrationManifest } from '@assemble/core';
import { Llm, scoreUrgency, digestMessages, draftReply } from '@assemble/llm';
import { startSlack, type SlackIntake, type EnrichedMessage } from './intake';
import {
  ensureSlackTables, insertMessage, recentMessages, setUrgency,
  messagesAfter, channelMessages, lastMessageId, type MessageRow,
} from './store';

export * from './intake';
export * from './store';

let intake: SlackIntake | null = null;
let startGen = 0;

const tokens = (ctx: IntegrationContext) => ({
  appToken: ctx.kv.get('slack_app_token') || process.env.SLACK_APP_TOKEN || '',
  botToken: ctx.kv.get('slack_bot_token') || process.env.SLACK_BOT_TOKEN || '',
});

const readyLlm = async (ctx: IntegrationContext) => (await ctx.llm()) as Llm | null;

async function scoreInBackground(ctx: IntegrationContext, id: number, m: EnrichedMessage) {
  const llm = await readyLlm(ctx);
  if (!llm) return;
  try {
    const verdict = await scoreUrgency(llm, m);
    setUrgency(ctx.db as Database, id, verdict.urgent, verdict.reason);
    if (verdict.urgent) {
      ctx.notify(`Slack · #${m.channelName ?? '?'}`, `${m.userName ?? 'Someone'}: ${m.text.slice(0, 120)} (${verdict.reason})`);
      ctx.broadcast({ kind: 'urgent', message: m, reason: verdict.reason });
    }
  } catch (err) {
    console.error('urgency scoring failed:', (err as Error).message);
  }
}

/** Digest of everything since the last digest cursor. Also used by voice intents. */
export async function runDigest(ctx: IntegrationContext): Promise<{ summary: string; count: number }> {
  const llm = await readyLlm(ctx);
  if (!llm) throw new Error('local AI is off — open Setup');
  const db = ctx.db as Database;
  const cursor = Number(ctx.kv.get('digest_cursor') || 0);
  const rows = messagesAfter(db, cursor, 200);
  const summary = await digestMessages(llm, rows.map(r => ({
    channelName: r.channel_name, userName: r.user_name, text: r.text,
  })));
  ctx.kv.set('digest_cursor', String(lastMessageId(db)));
  return { summary, count: rows.length };
}

export const slackIntegration: IntegrationManifest = {
  id: 'slack',
  name: 'Slack',
  description: 'Messages captured locally — urgency pings, digests, drafted replies.',
  icon: '<svg class="brand" viewBox="0 0 122.8 122.8"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A"/><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E"/></svg>',
  connectFields: [
    { key: 'slack_app_token', label: 'App token', placeholder: 'xapp-… app-level token', secret: true, help: 'api.slack.com → your app → Socket Mode on. Needs connections:write.' },
    { key: 'slack_bot_token', label: 'Bot token', placeholder: 'xoxb-… bot token', secret: true, help: 'Invite the bot to channels you want captured.' },
  ],

  async status() {
    return intake ? { connected: true, detail: 'socket open' } : { connected: false };
  },

  async start(ctx) {
    await this.stop();
    const { appToken, botToken } = tokens(ctx);
    if (!appToken || !botToken) throw new Error('Slack tokens missing');
    const db = ctx.db as Database;
    ensureSlackTables(db);
    const gen = ++startGen;
    const fresh = await startSlack({
      appToken, botToken,
      onMessage: m => {
        const id = insertMessage(db, m);
        if (id === null) return;
        console.log(`[${m.channelName ?? m.channel}] ${m.userName ?? m.user}: ${m.text.slice(0, 80)}`);
        ctx.broadcast({ kind: 'slack-message', message: m });
        void scoreInBackground(ctx, id, m);
      },
    });
    if (gen !== startGen || intake) {
      // a newer start() won the race (or one already landed) — discard this socket
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

    app.post('/digest', async c => {
      try { return c.json(await runDigest(ctx)); }
      catch (err) { return c.json({ error: (err as Error).message }, 503); }
    });

    app.post('/draft', async c => {
      const llm = await readyLlm(ctx);
      if (!llm) return c.json({ error: 'local AI is off — open Setup' }, 503);
      const { channel, ts } = await c.req.json<{ channel: string; ts?: string }>();
      if (!channel) return c.json({ error: 'channel required' }, 400);
      const context = channelMessages(db, channel, 15);
      const target = (ts && context.find(m => m.slack_ts === ts)) || context[context.length - 1];
      if (!target) return c.json({ error: 'no messages in channel' }, 404);
      const toLike = (r: MessageRow) => ({ channelName: r.channel_name, userName: r.user_name, text: r.text });
      const draft = await draftReply(llm, context.map(toLike), toLike(target));
      return c.json({ draft, target: { channel: target.channel, ts: target.slack_ts, threadTs: target.thread_ts } });
    });

    app.post('/send', async c => {
      const { botToken } = tokens(ctx);
      if (!botToken) return c.json({ error: 'Slack not connected — open Setup' }, 503);
      const { channel, text, threadTs } = await c.req.json<{ channel: string; text: string; threadTs?: string }>();
      if (!channel || !text) return c.json({ error: 'channel and text required' }, 400);
      const res = await new WebClient(botToken).chat.postMessage({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) });
      return c.json({ ok: res.ok, ts: res.ts });
    });

    return app;
  },
};
