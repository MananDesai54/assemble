import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServerWebSocket } from 'bun';
import { openDb, insertMessage, recentMessages } from './db';
import { startSlack } from './slack';

const PORT = Number(process.env.ASSEMBLE_PORT || 4817);
const DB_PATH = process.env.ASSEMBLE_DB || 'data/assemble.db';

const db = openDb(DB_PATH);
const app = new Hono();
app.use('*', cors()); // desktop renderer runs on file:// — allow localhost calls

app.get('/health', c => c.json({ ok: true, slack: slackConnected }));
app.get('/slack/recent', c => {
  const limit = Math.min(200, Number(c.req.query('limit') || 50));
  return c.json(recentMessages(db, limit));
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

// ---- Slack intake ----
const appToken = process.env.SLACK_APP_TOKEN;
const botToken = process.env.SLACK_BOT_TOKEN;
if (!appToken || !botToken) {
  console.warn('slack: SLACK_APP_TOKEN and/or SLACK_BOT_TOKEN missing — intake disabled, API still up');
} else {
  startSlack({
    appToken,
    botToken,
    onMessage: m => {
      const fresh = insertMessage(db, m);
      if (!fresh) return;
      console.log(`[${m.channelName ?? m.channel}] ${m.userName ?? m.user}: ${m.text.slice(0, 80)}`);
      broadcast({ kind: 'slack-message', message: m });
    },
  }).then(() => { slackConnected = true; })
    .catch(err => console.error('slack: failed to start —', (err as Error).message));
}
