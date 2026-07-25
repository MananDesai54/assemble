import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServerWebSocket } from 'bun';
import { WebClient } from '@slack/web-api';
import { Llm, scoreUrgency, digestMessages, draftReply } from '@assemble/llm';
import {
  openDb, insertMessage, recentMessages, setUrgency,
  messagesAfter, channelMessages, lastMessageId, kvGet, kvSet,
} from './db';
import { startSlack } from './slack';
import { notifyMac } from './notify';

const PORT = Number(process.env.ASSEMBLE_PORT || 4817);
const DB_PATH = process.env.ASSEMBLE_DB || 'data/assemble.db';

const db = openDb(DB_PATH);
const llm = new Llm();
const botToken = process.env.SLACK_BOT_TOKEN;
const web = botToken ? new WebClient(botToken) : null;

// llama-server reachability, refreshed lazily
let llmOk = false;
let llmCheckedAt = 0;
async function llmReady(): Promise<boolean> {
  if (Date.now() - llmCheckedAt > 30_000) {
    llmOk = await llm.healthy();
    llmCheckedAt = Date.now();
  }
  return llmOk;
}

const app = new Hono();
app.use('*', cors()); // desktop renderer runs on file:// — allow localhost calls

app.get('/health', async c => c.json({ ok: true, slack: slackConnected, llm: await llmReady() }));

app.get('/slack/recent', c => {
  const limit = Math.min(200, Number(c.req.query('limit') || 50));
  return c.json(recentMessages(db, limit));
});

app.post('/slack/digest', async c => {
  if (!(await llmReady())) return c.json({ error: 'llm offline — run scripts/start-llm.sh' }, 503);
  const cursor = Number(kvGet(db, 'digest_cursor') || 0);
  const rows = messagesAfter(db, cursor, 200);
  const summary = await digestMessages(llm, rows.map(r => ({
    channelName: r.channel_name, userName: r.user_name, text: r.text,
  })));
  kvSet(db, 'digest_cursor', String(lastMessageId(db)));
  return c.json({ summary, count: rows.length });
});

app.post('/slack/draft', async c => {
  if (!(await llmReady())) return c.json({ error: 'llm offline — run scripts/start-llm.sh' }, 503);
  const { channel, ts } = await c.req.json<{ channel: string; ts?: string }>();
  if (!channel) return c.json({ error: 'channel required' }, 400);
  const context = channelMessages(db, channel, 15);
  const target = (ts && context.find(m => m.slack_ts === ts)) || context[context.length - 1];
  if (!target) return c.json({ error: 'no messages in channel' }, 404);
  const toLike = (r: typeof target) => ({ channelName: r.channel_name, userName: r.user_name, text: r.text });
  const draft = await draftReply(llm, context.map(toLike), toLike(target));
  return c.json({ draft, target: { channel: target.channel, ts: target.slack_ts, threadTs: target.thread_ts } });
});

app.post('/slack/send', async c => {
  if (!web) return c.json({ error: 'SLACK_BOT_TOKEN missing' }, 503);
  const { channel, text, threadTs } = await c.req.json<{ channel: string; text: string; threadTs?: string }>();
  if (!channel || !text) return c.json({ error: 'channel and text required' }, 400);
  const res = await web.chat.postMessage({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) });
  return c.json({ ok: res.ok, ts: res.ts });
});

// ---- WebSocket fan-out to desktop clients ----
const clients = new Set<ServerWebSocket<unknown>>();
function broadcast(payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) ws.send(msg);
}

let slackConnected = false;

const server = Bun.serve({
  port: PORT,
  fetch(req, srv) {
    if (new URL(req.url).pathname === '/ws' && srv.upgrade(req)) return undefined as unknown as Response;
    return app.fetch(req);
  },
  websocket: {
    open(ws) { clients.add(ws); },
    close(ws) { clients.delete(ws); },
    message() {},
  },
});
console.log(`assemble server on :${server.port} (db → ${DB_PATH})`);

async function scoreInBackground(id: number, m: { channelName: string | null; userName: string | null; text: string }) {
  if (!(await llmReady())) return;
  try {
    const verdict = await scoreUrgency(llm, m);
    setUrgency(db, id, verdict.urgent, verdict.reason);
    if (verdict.urgent) {
      notifyMac(`Slack · #${m.channelName ?? '?'}`, `${m.userName ?? 'Someone'}: ${m.text.slice(0, 120)} (${verdict.reason})`);
      broadcast({ kind: 'urgent', message: m, reason: verdict.reason });
    }
  } catch (err) {
    console.error('urgency scoring failed:', (err as Error).message);
  }
}

// ---- Slack intake ----
const appToken = process.env.SLACK_APP_TOKEN;
if (!appToken || !botToken) {
  console.warn('slack: SLACK_APP_TOKEN and/or SLACK_BOT_TOKEN missing — intake disabled, API still up');
} else {
  startSlack({
    appToken,
    botToken,
    onMessage: m => {
      const id = insertMessage(db, m);
      if (id === null) return;
      console.log(`[${m.channelName ?? m.channel}] ${m.userName ?? m.user}: ${m.text.slice(0, 80)}`);
      broadcast({ kind: 'slack-message', message: m });
      void scoreInBackground(id, m);
    },
  }).then(() => { slackConnected = true; })
    .catch(err => console.error('slack: failed to start —', (err as Error).message));
}
