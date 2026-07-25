import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServerWebSocket } from 'bun';
import { WebClient } from '@slack/web-api';
import { Llm, scoreUrgency, digestMessages, draftReply, summarizeCall, parseIntent } from '@assemble/llm';
import { transcribe } from '@assemble/stt';
import { executeAction } from '@assemble/actions';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  openDb, insertMessage, recentMessages, setUrgency,
  messagesAfter, channelMessages, lastMessageId, kvGet, kvSet,
  insertRecording, updateRecording, listRecordings, getRecording,
} from './db';
import { startSlack, type SlackIntake } from './slack';
import { notifyMac } from './notify';
import { Recorder } from './recorder';
import { LlmRuntime } from './llm-runtime';
import { toolStatus, runSetupStep, SETUP_STEPS, WHISPER_MODEL_PATH, AUDIOTAP_BIN, type SetupStep } from './setup';

const PORT = Number(process.env.ASSEMBLE_PORT || 4817);
const DB_PATH = process.env.ASSEMBLE_DB || 'data/assemble.db';

const db = openDb(DB_PATH);
const llm = new Llm();
const llmRuntime = new LlmRuntime();
const recorder = new Recorder({ binPath: AUDIOTAP_BIN });

// ---- slack tokens: UI-saved (kv) wins over .env ----
const slackTokens = () => ({
  appToken: kvGet(db, 'slack_app_token') || process.env.SLACK_APP_TOKEN || '',
  botToken: kvGet(db, 'slack_bot_token') || process.env.SLACK_BOT_TOKEN || '',
});
let slackConnected = false;
let slackIntake: SlackIntake | null = null;
const webClient = () => {
  const { botToken } = slackTokens();
  return botToken ? new WebClient(botToken) : null;
};

// llama-server reachability, refreshed lazily
let llmOk = false;
let llmCheckedAt = 0;
async function llmReady(): Promise<boolean> {
  if (Date.now() - llmCheckedAt > 15_000) {
    llmOk = await llm.healthy();
    llmCheckedAt = Date.now();
  }
  return llmOk;
}

const app = new Hono();
app.use('*', cors()); // desktop renderer runs on file:// — allow localhost calls

app.get('/health', async c => c.json({
  ok: true,
  slack: slackConnected,
  llm: await llmReady(),
  recording: recorder.active !== null,
}));

/* ================= setup ================= */

app.get('/setup/status', async c => {
  const { appToken, botToken } = slackTokens();
  return c.json({
    ...toolStatus(),
    llmRunning: await llmReady(),
    slackConfigured: Boolean(appToken && botToken),
    slackConnected,
    steps: SETUP_STEPS,
  });
});

let setupRunning = false;
app.post('/setup/run', async c => {
  const { step } = await c.req.json<{ step: SetupStep | 'llm-start' }>();
  if (setupRunning) return c.json({ error: 'a setup step is already running' }, 409);
  const emit = (line: string) => broadcast({ kind: 'setup-progress', step, line });
  setupRunning = true;
  try {
    if (step === 'llm-start') {
      llmRuntime.start(emit);
      kvSet(db, 'llm_enabled', '1');
      // wait for health (model may be downloading — poll up to 30 min)
      const deadline = Date.now() + 30 * 60_000;
      while (Date.now() < deadline) {
        if (await llm.healthy()) break;
        if (!llmRuntime.running) throw new Error('llm exited during startup');
        await Bun.sleep(3000);
      }
      llmCheckedAt = 0;
      if (!(await llmReady())) throw new Error('llm did not become healthy');
    } else {
      await runSetupStep(step, emit);
    }
    broadcast({ kind: 'setup-progress', step, done: true });
    return c.json({ ok: true });
  } catch (err) {
    const message = (err as Error).message;
    broadcast({ kind: 'setup-progress', step, error: message });
    return c.json({ error: message }, 500);
  } finally {
    setupRunning = false;
  }
});

app.post('/setup/slack', async c => {
  const { appToken, botToken } = await c.req.json<{ appToken?: string; botToken?: string }>();
  if (appToken) kvSet(db, 'slack_app_token', appToken.trim());
  if (botToken) kvSet(db, 'slack_bot_token', botToken.trim());
  await restartSlack();
  return c.json({ connected: slackConnected });
});

/* ================= slack ================= */

app.get('/slack/recent', c => {
  const limit = Math.min(200, Number(c.req.query('limit') || 50));
  return c.json(recentMessages(db, limit));
});

async function runDigest(): Promise<{ summary: string; count: number }> {
  const cursor = Number(kvGet(db, 'digest_cursor') || 0);
  const rows = messagesAfter(db, cursor, 200);
  const summary = await digestMessages(llm, rows.map(r => ({
    channelName: r.channel_name, userName: r.user_name, text: r.text,
  })));
  kvSet(db, 'digest_cursor', String(lastMessageId(db)));
  return { summary, count: rows.length };
}

app.post('/slack/digest', async c => {
  if (!(await llmReady())) return c.json({ error: 'local AI is off — open Setup' }, 503);
  return c.json(await runDigest());
});

app.post('/slack/draft', async c => {
  if (!(await llmReady())) return c.json({ error: 'local AI is off — open Setup' }, 503);
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
  const web = webClient();
  if (!web) return c.json({ error: 'Slack not connected — open Setup' }, 503);
  const { channel, text, threadTs } = await c.req.json<{ channel: string; text: string; threadTs?: string }>();
  if (!channel || !text) return c.json({ error: 'channel and text required' }, 400);
  const res = await web.chat.postMessage({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) });
  return c.json({ ok: res.ok, ts: res.ts });
});

/* ================= recordings ================= */

app.get('/recordings', c => c.json(listRecordings(db, Math.min(100, Number(c.req.query('limit') || 20)))));
app.get('/recordings/:id', c => {
  const row = getRecording(db, Number(c.req.param('id')));
  return row ? c.json(row) : c.json({ error: 'not found' }, 404);
});

app.post('/record/toggle', async c => {
  if (recorder.active) return stopRecording(c);
  return startRecording(c);
});
app.post('/record/start', c => startRecording(c));
app.post('/record/stop', c => stopRecording(c));

function startRecording(c: any) {
  try {
    const rec = recorder.start();
    const id = insertRecording(db, rec.wavPath, rec.startedAt);
    notifyMac('assemble', 'Recording started — participants should know.');
    broadcast({ kind: 'recording', state: 'started', id });
    return c.json({ ok: true, id, state: 'recording' });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
}

async function stopRecording(c: any) {
  try {
    const rec = await recorder.stop();
    const row = listRecordings(db, 1).find(r => r.wav_path === rec.wavPath);
    const id = row?.id;
    if (id) {
      updateRecording(db, id, { ended_at: new Date().toISOString(), status: 'transcribing' });
      broadcast({ kind: 'recording', state: 'transcribing', id });
      void processRecording(id, rec.wavPath);
    }
    return c.json({ ok: true, id, state: 'transcribing' });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
}

async function processRecording(id: number, wavPath: string) {
  try {
    const transcript = await transcribe(wavPath, { modelPath: WHISPER_MODEL_PATH });
    updateRecording(db, id, { transcript });
    let summary: string | null = null;
    if (await llmReady()) summary = await summarizeCall(llm, transcript);
    updateRecording(db, id, { summary, status: 'done' });
    broadcast({ kind: 'recording', state: 'done', id });
    notifyMac('assemble', summary ? `Call summarized: ${summary.slice(0, 100)}` : 'Call transcribed.');
  } catch (err) {
    updateRecording(db, id, { status: 'error', summary: (err as Error).message });
    broadcast({ kind: 'recording', state: 'error', id });
    console.error('recording pipeline failed:', (err as Error).message);
  }
}

/* ================= voice commands ================= */

app.post('/voice', async c => {
  const body = await c.req.arrayBuffer();
  if (body.byteLength < 1000) return c.json({ error: 'no audio' }, 400);
  mkdirSync('data/voice', { recursive: true });
  const wavPath = `data/voice/cmd-${Date.now()}.wav`;
  writeFileSync(wavPath, Buffer.from(body));

  let transcript: string;
  try {
    transcript = await transcribe(wavPath, { modelPath: WHISPER_MODEL_PATH });
  } catch (err) {
    return c.json({ error: `transcription failed: ${(err as Error).message} — open Setup` }, 503);
  }
  if (!(await llmReady())) return c.json({ transcript, intent: { kind: 'none', reason: 'local AI off' }, result: null });

  const intent = await parseIntent(llm, transcript);
  let result: string | null = null;
  try {
    switch (intent.kind) {
      case 'digest': {
        const d = await runDigest();
        notifyMac('Slack digest', d.summary.slice(0, 180));
        result = d.summary;
        break;
      }
      case 'record-toggle': {
        if (recorder.active) {
          const rec = await recorder.stop();
          const row = listRecordings(db, 1).find(r => r.wav_path === rec.wavPath);
          if (row) {
            updateRecording(db, row.id, { ended_at: new Date().toISOString(), status: 'transcribing' });
            broadcast({ kind: 'recording', state: 'transcribing', id: row.id });
            void processRecording(row.id, rec.wavPath);
          }
          result = 'recording stopped';
        } else {
          const rec = recorder.start();
          const id = insertRecording(db, rec.wavPath, rec.startedAt);
          notifyMac('assemble', 'Recording started — participants should know.');
          broadcast({ kind: 'recording', state: 'started', id });
          result = 'recording started';
        }
        break;
      }
      case 'system':
        await executeAction({ type: 'system', value: intent.value });
        result = intent.value;
        break;
      case 'open':
        await executeAction({ type: 'open', value: intent.value });
        result = `opened ${intent.value}`;
        break;
      case 'none':
        result = null;
        break;
    }
  } catch (err) {
    return c.json({ transcript, intent, error: (err as Error).message }, 500);
  }
  return c.json({ transcript, intent, result });
});

/* ================= websocket + boot ================= */

const clients = new Set<ServerWebSocket<unknown>>();
function broadcast(payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) ws.send(msg);
}

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

async function restartSlack() {
  if (slackIntake) { await slackIntake.stop().catch(() => {}); slackIntake = null; }
  slackConnected = false;
  const { appToken, botToken } = slackTokens();
  if (!appToken || !botToken) {
    console.warn('slack: tokens missing — intake disabled, API still up');
    return;
  }
  try {
    slackIntake = await startSlack({
      appToken,
      botToken,
      onMessage: m => {
        const id = insertMessage(db, m);
        if (id === null) return;
        console.log(`[${m.channelName ?? m.channel}] ${m.userName ?? m.user}: ${m.text.slice(0, 80)}`);
        broadcast({ kind: 'slack-message', message: m });
        void scoreInBackground(id, m);
      },
    });
    slackConnected = true;
    broadcast({ kind: 'slack-connected' });
  } catch (err) {
    console.error('slack: failed to start —', (err as Error).message);
  }
}
void restartSlack();

// resume the local LLM if the user enabled it before
if (kvGet(db, 'llm_enabled') === '1' && Bun.which('llama-server')) {
  llmRuntime.start(line => broadcast({ kind: 'setup-progress', step: 'llm-start', line }));
}
