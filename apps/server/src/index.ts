import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServerWebSocket } from 'bun';
import type { Hono as HonoApp } from 'hono';
import type { IntegrationContext } from '@assemble/core';
import { Llm, summarizeCall, parseIntent } from '@assemble/llm';
import { transcribe } from '@assemble/stt';
import { executeAction } from '@assemble/actions';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  openDb, kvGet, kvSet, kvDel,
  insertRecording, updateRecording, listRecordings, getRecording,
} from './db';
import { runDigest } from '@assemble/integration-slack';
import { registry, listIntegrations, connectIntegration, disconnectIntegration, startConfigured, stopAll } from './integrations';
import { AgentRunner, initAgentTables, listSessions, getSession, expandDir } from './agent';
import { existsSync, rmSync } from 'node:fs';
import { notifyMac } from './notify';
import { Recorder } from './recorder';
import { LlmRuntime } from './llm-runtime';
import {
  toolStatus, runSetupStep, SETUP_STEPS, AUDIOTAP_BIN, KEYWATCH_BIN,
  WHISPER_MODELS, LLM_MODELS, DEFAULT_WHISPER, DEFAULT_LLM,
  whisperPath, whisperUrl, llmModel, type SetupStep,
} from './setup';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DATA_DIR, RECORDINGS_DIR, VOICE_DIR, migrateRepoLocalStorage } from './paths';

const PORT = Number(process.env.ASSEMBLE_PORT || 4817);
const DB_PATH = process.env.ASSEMBLE_DB || join(DATA_DIR, 'assemble.db');

migrateRepoLocalStorage();
const db = openDb(DB_PATH);
initAgentTables(db);

// Brain source: local llama-server by default; BYOK = any OpenAI-compatible
// endpoint with the user's own key (content then leaves the machine).
const byokConfig = () => ({
  source: (kvGet(db, 'llm_source') || 'local') as 'local' | 'byok',
  url: kvGet(db, 'byok_url') || 'https://api.openai.com',
  key: kvGet(db, 'byok_key') || '',
  model: kvGet(db, 'byok_model') || '',
});
function buildLlm(): Llm {
  const b = byokConfig();
  if (b.source === 'byok' && b.key) return new Llm({ url: b.url, apiKey: b.key, model: b.model || 'gpt-5-mini' });
  return new Llm();
}
let llm = buildLlm();
const llmRuntime = new LlmRuntime();
const recorder = new Recorder({ binPath: AUDIOTAP_BIN, dir: RECORDINGS_DIR });
const agents = new AgentRunner();
const selectedWhisper = () => kvGet(db, 'whisper_model') || DEFAULT_WHISPER;
const selectedLlm = () => kvGet(db, 'llm_model') || DEFAULT_LLM;
const activeWhisperPath = () => whisperPath(selectedWhisper());

const ctx: IntegrationContext = {
  kv: { get: k => kvGet(db, k), set: (k, v) => kvSet(db, k, v), del: k => kvDel(db, k) },
  db,
  broadcast,
  llm: async () => ((await llmReady()) ? llm : null),
  notify: notifyMac,
};

// llama-server reachability, refreshed lazily
let llmOk = false;
let llmCheckedAt = 0;
async function llmReady(): Promise<boolean> {
  const b = byokConfig();
  if (b.source === 'byok') return Boolean(b.key); // no health endpoint guarantee — errors surface per call
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
  llm: await llmReady(),
  recording: recorder.active !== null,
}));

/* ================= setup ================= */

app.get('/setup/status', async c => {
  return c.json({
    ...toolStatus(activeWhisperPath()),
    llmRunning: await llmReady(),
    claudeCli: Bun.which('claude') !== null,
    steps: SETUP_STEPS,
  });
});

app.get('/setup/models', c => {
  const b = byokConfig();
  return c.json({
    whisper: { options: WHISPER_MODELS, selected: selectedWhisper() },
    llm: { options: LLM_MODELS, selected: selectedLlm() },
    byok: { source: b.source, url: b.url, model: b.model, hasKey: Boolean(b.key) },
  });
});

app.post('/setup/byok', async c => {
  const { source, url, key, model } = await c.req.json<{ source?: string; url?: string; key?: string; model?: string }>();
  if (source === 'local' || source === 'byok') kvSet(db, 'llm_source', source);
  if (url !== undefined) kvSet(db, 'byok_url', url.trim().replace(/\/$/, ''));
  if (key) kvSet(db, 'byok_key', key.trim());
  if (model !== undefined) kvSet(db, 'byok_model', model.trim());
  llm = buildLlm();
  llmCheckedAt = 0;
  const b = byokConfig();
  if (b.source === 'byok') {
    // byok only sticks when the key actually works — otherwise fall back to
    // local so status/setup rows never report a brain that can't answer.
    const fallBack = () => { kvSet(db, 'llm_source', 'local'); llm = buildLlm(); };
    if (!b.key) { fallBack(); return c.json({ ok: false, error: 'API key required' }); }
    try {
      const out = await llm.chat([{ role: 'user', content: 'Reply with the single word: ok' }], { maxTokens: 10 });
      return c.json({ ok: true, sample: out.slice(0, 40) });
    } catch (err) {
      fallBack();
      return c.json({ ok: false, error: (err as Error).message });
    }
  }
  return c.json({ ok: true });
});

app.post('/setup/models', async c => {
  const { whisper, llm: llmId } = await c.req.json<{ whisper?: string; llm?: string }>();
  if (whisper && WHISPER_MODELS.some(m => m.id === whisper)) kvSet(db, 'whisper_model', whisper);
  if (llmId && LLM_MODELS.some(m => m.id === llmId)) {
    kvSet(db, 'llm_model', llmId);
    if (llmRuntime.running) {
      llmRuntime.start(line => broadcast({ kind: 'setup-progress', step: 'llm-start', line }), llmModel(llmId).hf);
      llmCheckedAt = 0;
    }
  }
  return c.json({ whisper: selectedWhisper(), llm: selectedLlm() });
});

let setupRunning = false;
app.post('/setup/run', async c => {
  const { step } = await c.req.json<{ step: SetupStep | 'llm-start' }>();
  if (setupRunning) return c.json({ error: 'a setup step is already running' }, 409);
  const emit = (line: string) => broadcast({ kind: 'setup-progress', step, line });
  setupRunning = true;
  try {
    if (step === 'llm-start') {
      llmRuntime.start(emit, llmModel(selectedLlm()).hf);
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
      await runSetupStep(step, emit, {
        whisperModelPath: activeWhisperPath(),
        whisperModelUrl: whisperUrl(selectedWhisper()),
      });
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

app.post('/reset', async c => {
  if (recorder.active) { try { await recorder.stop(); } catch { /* best effort */ } }
  db.exec(`DELETE FROM messages; DELETE FROM recordings; DELETE FROM agent_sessions; DELETE FROM kv;`);
  for (const dir of [RECORDINGS_DIR, VOICE_DIR]) rmSync(dir, { recursive: true, force: true });
  await stopAll(); // tokens gone → intake stops
  broadcast({ kind: 'reset' });
  return c.json({ ok: true });
});

/* ================= integrations ================= */

app.get('/integrations', async c => c.json(await listIntegrations(ctx)));

app.post('/integrations/:id/connect', async c => {
  const id = c.req.param('id');
  try {
    const status = await connectIntegration(ctx, id, await c.req.json<Record<string, string>>());
    broadcast({ kind: 'integration-changed', id, connected: status.connected });
    return c.json(status);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post('/integrations/:id/disconnect', async c => {
  const id = c.req.param('id');
  try {
    await disconnectIntegration(ctx, id);
    broadcast({ kind: 'integration-changed', id, connected: false });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

for (const m of registry) app.route(`/integrations/${m.id}`, m.routes(ctx) as HonoApp);

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
    const transcript = await transcribe(wavPath, { modelPath: activeWhisperPath() });
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

/* ================= claude code sessions ================= */

app.get('/agent/sessions', c => c.json(listSessions(db, Math.min(50, Number(c.req.query('limit') || 20)))));
app.get('/agent/sessions/:id', c => {
  const row = getSession(db, Number(c.req.param('id')));
  return row ? c.json(row) : c.json({ error: 'not found' }, 404);
});

app.get('/agent/dirs', c => {
  const dirs: string[] = JSON.parse(kvGet(db, 'work_dirs') || '[]');
  return c.json(dirs.filter(d => existsSync(expandDir(d))));
});

app.post('/agent/run', async c => {
  const { cwd, prompt, skipPermissions } = await c.req.json<{ cwd: string; prompt: string; skipPermissions?: boolean }>();
  if (!cwd || !prompt?.trim()) return c.json({ error: 'cwd and prompt required' }, 400);
  try {
    const id = agents.run(db, { cwd, prompt: prompt.trim(), skipPermissions },
      p => broadcast({ kind: 'agent', ...p }));
    const dirs: string[] = JSON.parse(kvGet(db, 'work_dirs') || '[]');
    kvSet(db, 'work_dirs', JSON.stringify([cwd, ...dirs.filter(d => d !== cwd)].slice(0, 8)));
    return c.json({ ok: true, id });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post('/agent/stop', async c => {
  const { id } = await c.req.json<{ id: number }>();
  const stopped = agents.stop(db, id);
  if (stopped) broadcast({ kind: 'agent', id, state: 'stopped' });
  return c.json({ ok: stopped });
});

/* ================= voice commands ================= */

app.post('/voice', async c => {
  const body = await c.req.arrayBuffer();
  if (body.byteLength < 1000) return c.json({ error: 'no audio' }, 400);
  mkdirSync(VOICE_DIR, { recursive: true });
  const wavPath = join(VOICE_DIR, `cmd-${Date.now()}.wav`);
  writeFileSync(wavPath, Buffer.from(body));

  let transcript: string;
  try {
    transcript = await transcribe(wavPath, { modelPath: activeWhisperPath() });
  } catch (err) {
    return c.json({ error: `transcription failed: ${(err as Error).message} — open Setup` }, 503);
  }
  if (!(await llmReady())) return c.json({ transcript, intent: { kind: 'none', reason: 'local AI off' }, result: null });

  const intent = await parseIntent(llm, transcript);
  let result: string | null = null;
  try {
    switch (intent.kind) {
      case 'digest': {
        const d = await runDigest(ctx);
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

void startConfigured(ctx);

// resume the local LLM if the user enabled it before
if (kvGet(db, 'llm_enabled') === '1' && Bun.which('llama-server')) {
  llmRuntime.start(line => broadcast({ kind: 'setup-progress', step: 'llm-start', line }), llmModel(selectedLlm()).hf);
}

// global double-space hotkey (listen-only event tap; needs Input Monitoring)
if (existsSync(KEYWATCH_BIN)) {
  const kw = spawn(KEYWATCH_BIN, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  kw.stdout.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      if (line.trim() === 'voice-chord') broadcast({ kind: 'voice-hotkey' });
    }
  });
  kw.stderr.on('data', (buf: Buffer) => console.warn(buf.toString().trim()));
  kw.on('exit', code => console.warn(`keywatch exited (${code}) — double-space hotkey off`));
}
