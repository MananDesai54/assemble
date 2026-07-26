// All imperative logic: sensors, voice, websocket, talk session, teach flow.
// Mutates the store and emits; React renders. No DOM access in here beyond
// the background canvas and audio elements.

import { ZONES, REJECT_LABEL, zoneById } from '@assemble/core';
import type { Action, ZoneId } from '@assemble/core';
import { fingerprint, TapClassifier, WhistleController, BlowDetector, encodeWav16k } from '@assemble/dsp';
import type { RhythmPattern } from '@assemble/dsp';
import { createEngine } from './engine';
import { createCamera } from './camera';
import { startBackground } from './background';
import {
  app, talk, bg, setBg, emit, bus, fire, toast, logLine, fetchIntegrations,
  SERVER, type Mode,
} from './store';

declare global {
  interface Window {
    assemble: {
      getConfig: () => Promise<import('@assemble/core').AppConfig>;
      setConfig: (p: Partial<import('@assemble/core').AppConfig>) => Promise<import('@assemble/core').AppConfig>;
      setArmed: (v: boolean) => Promise<boolean>;
      resetAll: () => Promise<import('@assemble/core').AppConfig>;
      tap: (label: string, confidence: number, count: number) => void;
      extra: (kind: string) => void;
      whistleStep: (dir: number) => void;
      onArmedChanged: (cb: (v: boolean) => void) => void;
      onVoiceToggle: (cb: () => void) => void;
      quickOpenInApp: (text: string) => void;
      quickHide: () => void;
      quickToggle: () => void;
      onOpenTalk: (cb: (text: string) => void) => void;
    };
  }
}

export const TAPS_PER_ZONE = 10;
export const NOISE_SECONDS = 10;
export const PATTERNS = [1, 2, 3] as const;

export const PRESET_NAMES: Record<string, string> = {
  'volume-up': 'Volume up', 'volume-down': 'Volume down', 'mute-toggle': 'Mute toggle',
  'lock-screen': 'Lock screen', 'screenshot': 'Screenshot to clipboard',
  'screenshot-region': 'Screenshot region to clipboard', 'display-sleep': 'Sleep the display',
  'record-toggle': 'Record call (start/stop)',
};
const TYPE_NAMES: Record<string, string> = { shell: 'Run', keystroke: 'Press', open: 'Open', system: '' };

export const SETUP_ROWS = [
  { key: 'llamaCpp', step: 'llama.cpp', label: 'AI engine — llama.cpp' },
  { key: 'whisperCpp', step: 'whisper-cpp', label: 'Speech engine — whisper.cpp' },
  { key: 'whisperModel', step: 'whisper-model', label: 'Speech model downloaded (your selection above)' },
  { key: 'kokoroModel', step: 'kokoro', label: 'Voice — Kokoro neural TTS (~90 MB)' },
  { key: 'audiotap', step: 'audiotap', label: 'Call capture + hotkey helpers' },
  { key: 'llmRunning', step: 'llm-start', label: 'Brain running (downloads your selection on first start)' },
] as const;

/* ================= boot ================= */

export async function init() {
  setBg(startBackground(document.querySelector('#bg') as HTMLElement));
  app.config = await window.assemble.getConfig();
  if (app.config.classifier) app.classifier = TapClassifier.fromJSON(app.config.classifier);
  applyTheme();
  // Single path for renderer- and tray-initiated changes (main echoes both):
  // off = sensors fully released (mic indicator goes away), on = restart.
  window.assemble.onArmedChanged(v => {
    app.config.armed = v;
    if (!v) stopSensors();
    else if (!app.engine && app.mode === 'app') void startSensors();
    emit();
  });
  window.assemble.onVoiceToggle(() => voiceToggle());
  // quick panel → "continue in app": fresh Talk chat seeded with the question
  window.assemble.onOpenTalk(async text => {
    if (app.mode !== 'app') return;
    setPage('talk');
    await newTalkChat();
    void talkSendText(text);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((app.config?.theme || 'system') === 'system') applyTheme();
  });
  openWs();
  await fetchIntegrations();
  // Sensors never auto-start: mic begins in the setup flow (user-initiated) or
  // after the consent prompt on the app screen.
  setMode(app.config.onboarded ? 'app' : 'landing');
}

/* ================= theme ================= */

export function applyTheme() {
  const pref = app.config?.theme || 'system';
  const dark = pref === 'dark' ||
    (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  emit();
}
export function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  app.config.theme = dark ? 'light' : 'dark';
  void window.assemble.setConfig({ theme: app.config.theme });
  applyTheme();
}
export function setTheme(theme: string) {
  app.config.theme = theme as typeof app.config.theme;
  void window.assemble.setConfig({ theme: app.config.theme });
  applyTheme();
}

/* ================= mode / page router ================= */

export function setMode(mode: Mode) {
  app.mode = mode;
  bg?.setBoost(mode !== 'app');
  if (mode === 'app' && !app.engine && !app.micError) app.consentOpen = true;
  emit();
  void syncCamera();
}

export function setPage(page: string) {
  if (app.page === 'talk' && page !== 'talk') talkLeave(); // stop tts + session when navigating away
  app.page = page;
  emit();
}

/* ================= sensors ================= */

export async function startSensors() {
  try {
    await startEngine();
    await syncCamera();
  } catch (err) {
    app.micError = (err as Error).message;
    emit();
  }
}

export function stopSensors() {
  if (app.engine) { app.engine.stop(); app.engine = null; }
  if (app.camera) { app.camera.stop(); app.camera = null; }
  app.whistle = null;
  app.blow = null;
  bg?.setLevel(0);
  emit();
}

export async function startEngine() {
  if (app.engine) app.engine.stop();
  app.engine = await createEngine({
    deviceId: app.config.deviceId,
    sensitivity: app.config.sensitivity,
    onFrame: handleFrame,
    onLevel: handleLevel,
    onChunk: handleChunk,
  });
  app.whistle = new WhistleController({ sampleRate: app.engine.sampleRate });
  app.blow = new BlowDetector({ sampleRate: app.engine.sampleRate });
  app.micError = null;
  emit();
}

export async function syncCamera() {
  const wanted = app.config?.extras.camera.enabled && app.mode === 'app' && app.engine !== null;
  if (wanted && !app.camera) {
    try {
      app.camera = await createCamera({
        onWave: side => {
          const action = app.config.extras.camera[side].action;
          logLine(`wave ${side} · ${actionSummary(action) || 'no action'}`, true);
          if (action?.type === 'voice') voiceToggle();
          else window.assemble.extra(`wave-${side}`);
        },
      });
    } catch (err) {
      app.config.extras.camera.enabled = false;
      void window.assemble.setConfig({ extras: { ...app.config.extras, camera: { ...app.config.extras.camera, enabled: false } } });
      logLine(`camera unavailable: ${(err as Error).message}`);
    }
  } else if (!wanted && app.camera) {
    app.camera.stop();
    app.camera = null;
  }
  emit();
}

export async function setArmed(v: boolean) { await window.assemble.setArmed(v); }

export async function setDevice(deviceId: string) {
  app.config.deviceId = deviceId;
  await window.assemble.setConfig({ deviceId });
  try { await startEngine(); } catch (err) { app.micError = (err as Error).message; emit(); }
}

export async function listAudioInputs(): Promise<{ id: string; label: string }[]> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  const out = [{ id: 'default', label: 'Built-in / default' }];
  for (const d of devices) {
    if (d.deviceId === 'default') continue;
    out.push({ id: d.deviceId, label: d.label || 'Microphone' });
  }
  return out;
}

function handleLevel(rms: number) {
  bg?.setLevel(rms);
  fire('level', rms);
}

function handleChunk(chunk: Float32Array) {
  if (voiceSess.active) voiceCollect(chunk);
  if (talk.phase === 'listening') talkCollect(chunk);
  if (app.mode !== 'app') return;
  const now = performance.now();
  if (app.config.extras.whistleVolume && app.whistle) {
    for (const ev of app.whistle.push(chunk, now)) {
      logLine(`whistle ${ev.dir > 0 ? 'up · volume up' : 'down · volume down'}`, true);
      window.assemble.whistleStep(ev.dir);
    }
  }
  if (app.config.extras.blow.action && app.blow) {
    if (app.blow.push(chunk, now)) {
      logLine(`blow · ${actionSummary(app.config.extras.blow.action)}`, true);
      if (app.config.extras.blow.action.type === 'voice') voiceToggle();
      else window.assemble.extra('blow');
    }
  }
}

function handleFrame(frame: Float32Array, sampleRate: number) {
  fire('ripple');
  const vec = fingerprint(frame, sampleRate);
  if (app.mode === 'setup' && app.setupStep === 1) { teachCollect(vec); return; }
  if (app.mode !== 'app') return;
  const r = app.classifier.classify(vec);
  if (r.label === REJECT_LABEL) {
    if (Number.isFinite(r.distance)) logLine('ignored a sound');
    return;
  }
  app.lastConfidence = r.confidence;
  fire('lit', r.label);
  const done = app.rhythm.push(r.label, performance.now());
  if (done) firePattern(done);
  if (app.rhythmTimer) clearTimeout(app.rhythmTimer);
  app.rhythmTimer = setTimeout(() => {
    const d = app.rhythm.flush(performance.now());
    if (d) firePattern(d);
  }, 650);
}

function firePattern({ zone, count }: RhythmPattern) {
  const z = zoneById(zone)!;
  const action = app.config.zones[zone as ZoneId].actions?.[String(count) as '1' | '2' | '3'];
  const prefix = count > 1 ? `${count}× ` : '';
  logLine(
    `${prefix}${z.label} · ${action ? actionSummary(action) : 'no action for this pattern'} · ${(app.lastConfidence * 100).toFixed(0)}%`,
    !!action,
  );
  if (action?.type === 'voice') { voiceToggle(); return; } // voice runs here, not in main
  window.assemble.tap(zone, app.lastConfidence, count);
}

/* ================= voice commands ================= */

const voiceSess = {
  active: false,
  chunks: [] as Float32Array[],
  sawSpeech: false,
  silentMs: 0,
  maxTimer: null as ReturnType<typeof setTimeout> | null,
};

export const voiceActive = () => voiceSess.active;

export function voiceToggle() {
  if (voiceSess.active) { void voiceStop(); return; }
  if (!app.engine) {
    if (app.mode === 'app') { app.consentOpen = true; emit(); }
    else toast('Microphone not running.');
    return;
  }
  voiceSess.active = true;
  voiceSess.chunks = [];
  voiceSess.sawSpeech = false;
  voiceSess.silentMs = 0;
  voiceSess.maxTimer = setTimeout(() => void voiceStop(), 15_000);
  emit();
  toast('Listening — speak a command…');
}

function voiceCollect(chunk: Float32Array) {
  voiceSess.chunks.push(chunk.slice());
  let s = 0;
  for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
  const rms = Math.sqrt(s / chunk.length);
  const sr = app.engine?.sampleRate ?? 44100;
  if (rms > 0.02) { voiceSess.sawSpeech = true; voiceSess.silentMs = 0; }
  else voiceSess.silentMs += (chunk.length / sr) * 1000;
  if (voiceSess.sawSpeech && voiceSess.silentMs > 1200) void voiceStop();
}

async function voiceStop() {
  if (!voiceSess.active) return;
  voiceSess.active = false;
  if (voiceSess.maxTimer) clearTimeout(voiceSess.maxTimer);
  emit();
  const total = voiceSess.chunks.reduce((n, c) => n + c.length, 0);
  if (!voiceSess.sawSpeech || total < 4000) { toast('Heard nothing.'); return; }
  const all = new Float32Array(total);
  let off = 0;
  for (const c of voiceSess.chunks) { all.set(c, off); off += c.length; }
  voiceSess.chunks = [];
  toast('Working on it…');
  try {
    const wav = encodeWav16k(all, app.engine?.sampleRate ?? 44100);
    const r = await fetch(`${SERVER}/voice`, { method: 'POST', body: wav });
    const data = await r.json();
    if (!r.ok) { toast(data.error || 'voice failed'); return; }
    const heard = `"${(data.transcript || '').slice(0, 60)}"`;
    if (data.intent?.kind === 'none') {
      toast(`Heard ${heard} — no command matched.`);
      logLine(`voice · ${heard} · no match`);
    } else {
      toast(`${heard} → ${data.result ?? data.intent.kind}`);
      logLine(`voice · ${heard} · ${data.result ?? data.intent.kind}`, true);
    }
  } catch {
    toast('Local server unreachable.');
  }
}

/* ================= websocket ================= */

let ws: WebSocket | null = null;
let wsRetry: ReturnType<typeof setTimeout> | null = null;

export function openWs() {
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  ws = new WebSocket('ws://127.0.0.1:4817/ws');
  // The server may have booted (and connected integrations) after our first
  // status fetch — every successful WS open re-syncs integration state.
  ws.onopen = () => { void fetchIntegrations(); };
  ws.onmessage = e => {
    const payload = JSON.parse(e.data);
    if (payload.kind === 'slack-message') fire('slack-message', payload.message);
    if (payload.kind === 'voice-hotkey') voiceToggle();
    if (payload.kind === 'quick-hotkey') window.assemble.quickToggle();
    if (payload.kind === 'ptt-down' && app.page === 'talk' && app.mode === 'app') talkListen();
    if (payload.kind === 'ptt-up' && talk.phase === 'listening') void talkSend();
    if (payload.kind === 'ptt-cancel' && talk.phase === 'listening') talkInterrupt();
    if (payload.kind === 'setup-progress') {
      app.setupLines[payload.step] = payload.error ? `failed: ${payload.error}` : payload.done ? 'done' : (payload.line ?? '');
      if (payload.done) void refreshSetupStatus();
      emit();
    }
    if (payload.kind === 'recording') {
      if (payload.state === 'live-transcript') {
        // rolling tail of what whisper heard so far — recording is still on
        app.recStatus = `…${(payload.text ?? '').slice(-90)}`;
      } else {
        app.recording = payload.state === 'started';
        app.recStatus =
          payload.state === 'transcribing' ? 'transcribing…' :
          payload.state === 'summarizing' ? 'summarizing…' : '';
        if (payload.state === 'done' || payload.state === 'error' || payload.state === 'stopped') fire('recordings-changed');
      }
      emit();
    }
    if (payload.kind === 'agent') {
      if (payload.state !== 'running') toast(`Claude Code session #${payload.id}: ${payload.state}`);
      fire('agent-changed');
    }
    if (payload.kind === 'integration-changed') void fetchIntegrations();
  };
  ws.onclose = () => {
    ws = null;
    if (wsRetry) clearTimeout(wsRetry);
    wsRetry = setTimeout(openWs, 5_000);
  };
}

export async function refreshSetupStatus(): Promise<Record<string, boolean>> {
  try {
    const s = await (await fetch(`${SERVER}/setup/status`)).json();
    app.setupStatus = s;
    emit();
    return s;
  } catch {
    return {};
  }
}

/* ================= talk — chat + push-to-talk, stt → llm → tts ================= */

export async function refreshTalkChats() {
  try { talk.chats = await (await fetch(`${SERVER}/talk/chats`)).json(); }
  catch { talk.chats = []; }
  emit();
}

export async function newTalkChat() {
  try {
    const chat = await (await fetch(`${SERVER}/talk/chats`, { method: 'POST' })).json();
    talk.chatId = chat.id;
    localStorage.setItem('talk-chat', String(chat.id));
    talk.msgs = [];
    await refreshTalkChats();
    talkStatus('new chat — hold fn and speak, or type');
  } catch { talkStatus('local server unreachable'); }
}

export async function loadTalkChat(id: number) {
  talk.chatId = id;
  localStorage.setItem('talk-chat', String(id));
  try {
    const msgs: { role: 'user' | 'assistant'; content: string }[] =
      await (await fetch(`${SERVER}/talk/chats/${id}/messages`)).json();
    talk.msgs = msgs.map(m => ({ role: m.role, content: m.content }));
    emit();
    void refreshTalkChats();
  } catch { talkStatus('local server unreachable'); }
}

export async function deleteTalkChat(id: number) {
  await fetch(`${SERVER}/talk/chats/${id}`, { method: 'DELETE' }).catch(() => {});
  if (talk.chatId === id) { talk.chatId = null; talk.msgs = []; }
  await refreshTalkChats();
  if (!talk.chatId && talk.chats.length) void loadTalkChat(talk.chats[0].id);
}

function talkStatus(text: string) {
  talk.status = text;
  emit();
}

function talkSetPhase(phase: typeof talk.phase, status: string) {
  talk.phase = phase;
  talk.status = status;
  emit();
}

export function talkListen() {
  if (talk.phase === 'thinking') return; // wait for the reply
  if (!app.engine) {
    if (app.mode === 'app' && app.config.armed) { app.consentOpen = true; emit(); }
    else talkStatus('microphone off — flip Listening on');
    return;
  }
  speechSynthesis.cancel(); // barge-in: talking over the reply stops it
  stopTalkAudio();
  talk.chunks = [];
  talk.levels = [];
  talk.sawSpeech = false;
  talkSetPhase('listening', 'listening — release fn to send');
}

function talkCollect(chunk: Float32Array) {
  talk.chunks.push(chunk.slice());
  let s = 0;
  for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
  const rms = Math.sqrt(s / chunk.length);
  talk.level = talk.level * 0.7 + rms * 0.3;
  talk.levels.push(talk.level);
  if (talk.levels.length > 160) talk.levels.shift();
  if (rms > 0.02) talk.sawSpeech = true;
}

export async function talkSend() {
  if (talk.phase !== 'listening') return;
  const total = talk.chunks.reduce((n, c) => n + c.length, 0);
  if (!talk.sawSpeech || total < 4000) { talkSetPhase('idle', 'heard nothing — hold fn and speak'); return; }
  const all = new Float32Array(total);
  let off = 0;
  for (const c of talk.chunks) { all.set(c, off); off += c.length; }
  talk.chunks = [];
  talkSetPhase('thinking', 'thinking…');
  try {
    const wav = encodeWav16k(all, app.engine?.sampleRate ?? 44100);
    const r = await fetch(`${SERVER}/talk/chats/${talk.chatId}/audio`, { method: 'POST', body: wav });
    const data = await r.json();
    if (data.transcript) { talk.msgs.push({ role: 'user', content: data.transcript }); emit(); }
    if (!r.ok) { talkSetPhase('idle', data.error || 'failed — try again'); return; }
    talk.msgs.push({ role: 'assistant', content: data.reply });
    emit();
    void refreshTalkChats(); // title may have been set by the first message
    talkSpeak(data.reply, true);
  } catch {
    talkSetPhase('idle', 'local server unreachable');
  }
}

export async function talkSendText(text: string) {
  if (!text || !talk.chatId || talk.phase === 'thinking') return;
  talk.msgs.push({ role: 'user', content: text });
  talkSetPhase('thinking', 'thinking…');
  try {
    const r = await fetch(`${SERVER}/talk/chats/${talk.chatId}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) { talkSetPhase('idle', data.error || 'failed — try again'); return; }
    talk.msgs.push({ role: 'assistant', content: data.reply });
    void refreshTalkChats();
    talkSetPhase('idle', 'hold fn and speak, or type'); // typed replies stay silent — 🔊 reads them
  } catch {
    talkSetPhase('idle', 'local server unreachable');
  }
}

/* ---- speech out ---- */

export const VOICE_PREVIEW_TEXT = 'Hey Manan — this is how I sound. Nice to meet you.';
let previewAudio: HTMLAudioElement | null = null;

export function stopPreview() {
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  speechSynthesis.cancel();
}

export async function previewVoice(value: string): Promise<boolean> {
  stopPreview();
  try {
    const r = await fetch(`${SERVER}/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: VOICE_PREVIEW_TEXT, voice: value.replace(/^k:/, '') }),
    });
    if (!r.ok) { toast('Voice preview failed — model still downloading?'); return false; }
    const url = URL.createObjectURL(await r.blob());
    return await new Promise<boolean>(resolve => {
      previewAudio = new Audio(url);
      previewAudio.onended = () => { URL.revokeObjectURL(url); resolve(true); };
      previewAudio.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      void previewAudio!.play();
    });
  } catch { toast('Local server unreachable.'); return false; }
}

let talkAudio: HTMLAudioElement | null = null;

export function talkSpeak(text: string, partOfTurn: boolean) {
  const chosen = localStorage.getItem('talk-voice') ?? 'k:af_heart';
  const isHindi = /[ऀ-ॿ]/.test(text);
  // Kokoro is English-only — Devanagari replies route to the system Hindi voice
  if (chosen.startsWith('k:') && !isHindi) { void kokoroSpeak(text, chosen.slice(2), partOfTurn); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (chosen.startsWith('s:')) {
    const v = speechSynthesis.getVoices().find(x => x.name === chosen.slice(2));
    if (v) u.voice = v;
  } else if (/[\u0900-\u097F]/.test(text)) {
    u.lang = 'hi-IN'; // Devanagari → Hindi system voice
  }
  u.rate = 1.05;
  u.onstart = () => talkSetPhase('speaking', 'speaking — Esc interrupts, fn talks over it');
  u.onend = () => { if (talk.phase === 'speaking') talkSetPhase('idle', 'hold fn and speak, or type'); };
  u.onerror = () => { if (partOfTurn) talkSetPhase('idle', 'hold fn and speak, or type'); };
  speechSynthesis.speak(u);
}

async function kokoroSpeak(text: string, voice: string, partOfTurn: boolean) {
  stopTalkAudio();
  talkStatus('voicing…');
  try {
    const r = await fetch(`${SERVER}/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }),
    });
    if (!r.ok) {
      const data: any = await r.json().catch(() => ({}));
      toast(`Kokoro failed (${data.error ?? r.status}) — using system voice`);
      localStorage.setItem('talk-voice', '');
      talkSpeak(text, partOfTurn);
      return;
    }
    const url = URL.createObjectURL(await r.blob());
    talkAudio = new Audio(url);
    talkAudio.onplay = () => talkSetPhase('speaking', 'speaking — Esc interrupts, fn talks over it');
    talkAudio.onended = () => {
      URL.revokeObjectURL(url);
      talkAudio = null;
      if (talk.phase === 'speaking') talkSetPhase('idle', 'hold fn and speak, or type');
    };
    void talkAudio.play();
  } catch {
    talkSetPhase('idle', 'local server unreachable');
  }
}

function stopTalkAudio() {
  if (talkAudio) { talkAudio.pause(); talkAudio = null; }
}

export function talkInterrupt() {
  speechSynthesis.cancel();
  stopTalkAudio();
  talk.chunks = [];
  talkSetPhase('idle', 'hold fn and speak, or type');
}

export function talkLeave() {
  if (talk.phase !== 'idle') talkInterrupt();
}

/* ================= teach ================= */

export type TeachStep = { kind: 'zone'; zone: (typeof ZONES)[number] } | { kind: 'noise' };

export function teachSteps(): TeachStep[] {
  return (ZONES.map(z => ({ kind: 'zone', zone: z })) as TeachStep[]).concat([{ kind: 'noise' }]);
}

export function startTeach() {
  app.classifier = new TapClassifier();
  if (app.teach?.timer) clearInterval(app.teach.timer);
  app.teach = { stepIdx: 0, secondsLeft: null, timer: null };
  emit();
}

export function enterTeachStep() {
  const teach = app.teach;
  if (!teach) return;
  const step = teachSteps()[teach.stepIdx];
  if (step.kind === 'noise') {
    teach.secondsLeft = NOISE_SECONDS;
    teach.timer = setInterval(() => {
      teach.secondsLeft = (teach.secondsLeft ?? 0) - 1;
      emit();
      if (teach.secondsLeft <= 0) void finishTeach();
    }, 1000);
  }
  emit();
}

function teachCollect(vec: Float64Array) {
  const teach = app.teach;
  if (!teach) return;
  const step = teachSteps()[teach.stepIdx];
  if (step.kind === 'zone') {
    app.classifier.addSample(step.zone.id, vec);
    const have = app.classifier.counts()[step.zone.id] || 0;
    emit();
    if (have >= TAPS_PER_ZONE) {
      teach.stepIdx++;
      enterTeachStep();
    }
  } else {
    app.classifier.addSample(REJECT_LABEL, vec);
  }
}

export function redoTeachStep() {
  const teach = app.teach!;
  const step = teachSteps()[teach.stepIdx];
  if (teach.timer) clearInterval(teach.timer);
  teach.timer = null;
  if (step.kind === 'zone') app.classifier.clear(step.zone.id);
  else app.classifier.clear(REJECT_LABEL);
  enterTeachStep();
}

export function previousTeachStep() {
  const teach = app.teach!;
  if (teach.timer) clearInterval(teach.timer);
  teach.timer = null;
  const steps = teachSteps();
  const cur = steps[teach.stepIdx];
  app.classifier.clear(cur.kind === 'zone' ? cur.zone.id : REJECT_LABEL);
  teach.stepIdx--;
  const prev = steps[teach.stepIdx];
  if (prev.kind === 'zone') app.classifier.clear(prev.zone.id);
  enterTeachStep();
}

async function finishTeach() {
  const teach = app.teach!;
  if (teach.timer) clearInterval(teach.timer);
  app.teach = null;
  app.config.classifier = app.classifier.toJSON();
  await window.assemble.setConfig({ classifier: app.config.classifier });
  toast('Corners learned.');
  setupNext();
}

export function cancelTeach() {
  if (app.teach?.timer) clearInterval(app.teach.timer);
  app.teach = null;
  app.classifier = app.config.classifier
    ? TapClassifier.fromJSON(app.config.classifier) : new TapClassifier();
  setupNext();
}

export function toastAfterEnter() {
  toast('Click a corner to choose what it does.');
}

export function setupNext() {
  if (app.setupReturn) { app.setupReturn = false; setMode('app'); return; }
  app.setupStep = Math.min(4, app.setupStep + 1);
  emit();
}

/* ================= misc shared ================= */

export function isTrained(): boolean {
  const counts = app.classifier.counts();
  return ZONES.every(z => (counts[z.id] || 0) > 0);
}

export function actionSummary(action: Action | null | undefined): string {
  if (!action || !action.type) return '';
  if (action.type === 'system') return PRESET_NAMES[action.value] || action.value;
  if (action.type === 'voice') return '🎙 Voice command';
  return `${TYPE_NAMES[action.type]} ${action.value}`.trim();
}

export async function saveZoneActions(zoneId: ZoneId, actions: NonNullable<import('@assemble/core').AppConfig['zones'][ZoneId]['actions']>) {
  app.config.zones[zoneId].actions = actions;
  await window.assemble.setConfig({ zones: { ...app.config.zones, [zoneId]: { actions } } });
  emit();
}

export async function wipeEverything(): Promise<boolean> {
  const sure = confirm(
    'Wipe everything?\n\nCalibration, corner actions, integration tokens, captured messages, call recordings, and Claude Code session history will be deleted. This cannot be undone.',
  );
  if (!sure) return false;
  try { await fetch(`${SERVER}/reset`, { method: 'POST' }); } catch { /* server offline — local reset still proceeds */ }
  app.config = await window.assemble.resetAll();
  app.classifier = new TapClassifier();
  app.activity = [];
  localStorage.clear(); // voice pick, current chat
  talk.chatId = null;
  talk.chats = [];
  talk.msgs = [];
  if (app.camera) { app.camera.stop(); app.camera = null; }
  applyTheme();
  toast('Everything wiped. Starting fresh.');
  setMode('landing');
  return true;
}
