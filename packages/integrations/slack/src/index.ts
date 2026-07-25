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
  icon: '<svg viewBox="0 0 16 16"><path d="M6 1v6M10 9v6M1 10h6M9 6h6" stroke-width="2" stroke-linecap="round"/></svg>',
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
    intake = await startSlack({
      appToken, botToken,
      onMessage: m => {
        const id = insertMessage(db, m);
        if (id === null) return;
        console.log(`[${m.channelName ?? m.channel}] ${m.userName ?? m.user}: ${m.text.slice(0, 80)}`);
        ctx.broadcast({ kind: 'slack-message', message: m });
        void scoreInBackground(ctx, id, m);
      },
    });
    ctx.broadcast({ kind: 'slack-connected' });
  },

  async stop() {
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
