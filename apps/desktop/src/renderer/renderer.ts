import { ZONES, REJECT_LABEL, zoneById } from '@assemble/core';
import type { Action, AppConfig, ZoneId } from '@assemble/core';
import { fingerprint, TapClassifier, RhythmMatcher, WhistleController, BlowDetector, encodeWav16k } from '@assemble/dsp';
import type { RhythmPattern } from '@assemble/dsp';
import { createEngine, type Engine } from './engine';
import { createCamera, type Camera } from './camera';
import { startBackground, type Bg } from './background';

declare global {
  interface Window {
    assemble: {
      getConfig: () => Promise<AppConfig>;
      setConfig: (p: Partial<AppConfig>) => Promise<AppConfig>;
      setArmed: (v: boolean) => Promise<boolean>;
      resetAll: () => Promise<AppConfig>;
      tap: (label: string, confidence: number, count: number) => void;
      extra: (kind: string) => void;
      whistleStep: (dir: number) => void;
      onArmedChanged: (cb: (v: boolean) => void) => void;
      onVoiceToggle: (cb: () => void) => void;
    };
  }
}

// UI layer: querySelector results used freely — typed as any on purpose.
const $ = (sel: string): any => document.querySelector(sel);
const SERVER = 'http://127.0.0.1:4817';
const TAPS_PER_ZONE = 10;
const NOISE_SECONDS = 10;
const PATTERNS = [1, 2, 3] as const;

type Mode = 'loading' | 'landing' | 'setup' | 'app';
type Page = 'desk' | 'slack' | 'calls' | 'work' | 'activity' | 'settings';
type SettingsTab = 'general' | 'gestures' | 'connections' | 'ai';

interface TeachState {
  stepIdx: number;
  secondsLeft: number | null;
  timer: ReturnType<typeof setInterval> | null;
}

const state = {
  config: null as unknown as AppConfig,
  classifier: new TapClassifier(),
  engine: null as Engine | null,
  camera: null as Camera | null,
  whistle: null as WhistleController | null,
  blow: null as BlowDetector | null,
  rhythm: new RhythmMatcher(),
  rhythmTimer: null as ReturnType<typeof setTimeout> | null,
  lastConfidence: 1,
  mode: 'loading' as Mode,
  page: 'desk' as Page,
  settingsTab: 'general' as SettingsTab,
  setupStep: 0,
  setupReturn: false,     // re-teach launched from the app → return to app after
  teach: null as TeachState | null,
  micError: null as string | null,
  activity: [] as { time: string; text: string; hit: boolean }[],
};

let bg: Bg;

const PRESET_NAMES: Record<string, string> = {
  'volume-up': 'Volume up', 'volume-down': 'Volume down', 'mute-toggle': 'Mute toggle',
  'lock-screen': 'Lock screen', 'screenshot': 'Screenshot to clipboard',
  'screenshot-region': 'Screenshot region to clipboard', 'display-sleep': 'Sleep the display',
  'record-toggle': 'Record call (start/stop)',
};
const TYPE_NAMES: Record<string, string> = { shell: 'Run', keystroke: 'Press', open: 'Open', system: '' };

void init();

async function init() {
  bg = startBackground($('#bg'));
  state.config = await window.assemble.getConfig();
  if (state.config.classifier) state.classifier = TapClassifier.fromJSON(state.config.classifier);
  applyTheme();
  $('#theme-toggle').onclick = toggleTheme;
  $('#armed').onchange = (e: any) => window.assemble.setArmed(e.target.checked);
  $('#armed').checked = state.config.armed;
  window.assemble.onArmedChanged(v => { $('#armed').checked = v; setStatus(); });
  window.assemble.onVoiceToggle(() => voiceToggle());

  // Sensors never auto-start: mic begins in the setup flow (user-initiated) or
  // after the consent prompt on the app screen.
  $('#status').onclick = () => { if (!state.engine && state.mode === 'app') showSensorConsent(); };
  openWs();
  setMode(state.config.onboarded ? 'app' : 'landing');
}

async function startSensors() {
  try {
    await startEngine();
    await syncCamera();
  } catch (err) {
    state.micError = (err as Error).message;
    setStatus();
  }
}

function showSensorConsent() {
  document.querySelectorAll('.consent-overlay').forEach(e => e.remove());
  const wantsCamera = state.config.extras.camera.enabled;
  const ov = document.createElement('div');
  ov.className = 'consent-overlay';
  ov.innerHTML = `
    <div class="consent-card">
      <h3>Start listening?</h3>
      <p class="hint">assemble needs the <b>microphone</b> to hear desk taps, whistles, and voice commands.${wantsCamera ? '<br/>The <b>camera</b> will also start — hand-wave gestures are enabled.' : ''}<br/>Nothing is recorded or sent anywhere.</p>
      <div class="consent-actions">
        <button class="primary" id="consent-start">Start${wantsCamera ? ' mic + camera' : ' microphone'}</button>
        <button class="quiet-link" id="consent-later">Not now</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  $('#consent-start').onclick = async () => { ov.remove(); await startSensors(); };
  $('#consent-later').onclick = () => { ov.remove(); toast('Sensors off — click the status dot to start.'); };
}

/* ================= theme ================= */

function applyTheme() {
  const pref = state.config.theme || 'system';
  const dark = pref === 'dark' ||
    (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme-toggle').textContent = dark ? '☾' : '☀';
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  state.config.theme = dark ? 'light' : 'dark';
  void window.assemble.setConfig({ theme: state.config.theme });
  applyTheme();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((state.config?.theme || 'system') === 'system') applyTheme();
});

/* ================= engines ================= */

async function startEngine() {
  if (state.engine) state.engine.stop();
  state.engine = await createEngine({
    deviceId: state.config.deviceId,
    sensitivity: state.config.sensitivity,
    onFrame: handleFrame,
    onLevel: handleLevel,
    onChunk: handleChunk,
  });
  state.whistle = new WhistleController({ sampleRate: state.engine.sampleRate });
  state.blow = new BlowDetector({ sampleRate: state.engine.sampleRate });
  state.micError = null;
  setStatus();
}

async function syncCamera() {
  const wanted = state.config.extras.camera.enabled && state.mode === 'app' && state.engine !== null;
  if (wanted && !state.camera) {
    try {
      state.camera = await createCamera({
        onWave: side => {
          const action = state.config.extras.camera[side].action;
          logLine(`wave ${side} · ${actionSummary(action) || 'no action'}`, true);
          if (action?.type === 'voice') voiceToggle();
          else window.assemble.extra(`wave-${side}`);
        },
      });
    } catch (err) {
      state.config.extras.camera.enabled = false;
      void window.assemble.setConfig({ extras: { ...state.config.extras, camera: { ...state.config.extras.camera, enabled: false } } });
      const toggle = $('#camera-toggle');
      if (toggle) toggle.checked = false;
      logLine(`camera unavailable: ${(err as Error).message}`);
    }
  } else if (!wanted && state.camera) {
    state.camera.stop();
    state.camera = null;
  }
}

function setStatus() {
  const el = $('#status');
  if (!el) return;
  if (state.micError) { el.dataset.state = 'error'; $('#status-text').textContent = 'microphone unavailable'; return; }
  if (!state.engine) {
    el.dataset.state = 'off';
    $('#status-text').textContent = state.mode === 'app' ? 'sensors off — click to start' : 'sensors off';
    return;
  }
  if (state.config.armed) { el.dataset.state = 'live'; $('#status-text').textContent = 'listening'; }
  else { el.dataset.state = 'paused'; $('#status-text').textContent = 'paused'; }
}

function handleLevel(rms: number) {
  bg?.setLevel(rms);
  const meter = $('.meter');
  if (!meter) return;
  const bars = meter.children;
  const lit = Math.min(bars.length, Math.round(Math.pow(rms * 18, 0.5) * bars.length));
  for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < lit);
}

function handleChunk(chunk: Float32Array) {
  if (voiceSess.active) voiceCollect(chunk);
  if (state.mode !== 'app') return;
  const now = performance.now();
  if (state.config.extras.whistleVolume && state.whistle) {
    for (const ev of state.whistle.push(chunk, now)) {
      logLine(`whistle ${ev.dir > 0 ? 'up · volume up' : 'down · volume down'}`, true);
      window.assemble.whistleStep(ev.dir);
    }
  }
  if (state.config.extras.blow.action && state.blow) {
    if (state.blow.push(chunk, now)) {
      logLine(`blow · ${actionSummary(state.config.extras.blow.action)}`, true);
      if (state.config.extras.blow.action.type === 'voice') voiceToggle();
      else window.assemble.extra('blow');
    }
  }
}

function handleFrame(frame: Float32Array, sampleRate: number) {
  rippleDesk();
  const vec = fingerprint(frame, sampleRate);
  if (state.mode === 'setup' && state.setupStep === 1) { teachCollect(vec); return; }
  if (state.mode !== 'app') return;
  const r = state.classifier.classify(vec);
  if (r.label === REJECT_LABEL) {
    if (Number.isFinite(r.distance)) logLine('ignored a sound');
    return;
  }
  state.lastConfidence = r.confidence;
  litCorner(r.label);
  const done = state.rhythm.push(r.label, performance.now());
  if (done) firePattern(done);
  if (state.rhythmTimer) clearTimeout(state.rhythmTimer);
  state.rhythmTimer = setTimeout(() => {
    const d = state.rhythm.flush(performance.now());
    if (d) firePattern(d);
  }, 650);
}

function firePattern({ zone, count }: RhythmPattern) {
  const z = zoneById(zone)!;
  const action = state.config.zones[zone as ZoneId].actions?.[String(count) as '1' | '2' | '3'];
  const prefix = count > 1 ? `${count}× ` : '';
  logLine(
    `${prefix}${z.label} · ${action ? actionSummary(action) : 'no action for this pattern'} · ${(state.lastConfidence * 100).toFixed(0)}%`,
    !!action,
  );
  if (action?.type === 'voice') { voiceToggle(); return; } // voice runs here, not in main
  window.assemble.tap(zone, state.lastConfidence, count);
}

/* ================= voice ================= */

const voiceSess = {
  active: false,
  chunks: [] as Float32Array[],
  sawSpeech: false,
  silentMs: 0,
  maxTimer: null as ReturnType<typeof setTimeout> | null,
};

function voiceToggle() {
  if (voiceSess.active) { void voiceStop(); return; }
  if (!state.engine) {
    if (state.mode === 'app') showSensorConsent();
    else toast('Microphone not running.');
    return;
  }
  voiceSess.active = true;
  voiceSess.chunks = [];
  voiceSess.sawSpeech = false;
  voiceSess.silentMs = 0;
  voiceSess.maxTimer = setTimeout(() => void voiceStop(), 15_000);
  $('#voice-dot').hidden = false;
  toast('Listening — speak a command…');
}

function voiceCollect(chunk: Float32Array) {
  voiceSess.chunks.push(chunk.slice());
  let s = 0;
  for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
  const rms = Math.sqrt(s / chunk.length);
  const sr = state.engine?.sampleRate ?? 44100;
  if (rms > 0.02) { voiceSess.sawSpeech = true; voiceSess.silentMs = 0; }
  else voiceSess.silentMs += (chunk.length / sr) * 1000;
  if (voiceSess.sawSpeech && voiceSess.silentMs > 1200) void voiceStop();
}

async function voiceStop() {
  if (!voiceSess.active) return;
  voiceSess.active = false;
  if (voiceSess.maxTimer) clearTimeout(voiceSess.maxTimer);
  $('#voice-dot').hidden = true;
  const total = voiceSess.chunks.reduce((n, c) => n + c.length, 0);
  if (!voiceSess.sawSpeech || total < 4000) { toast('Heard nothing.'); return; }
  const all = new Float32Array(total);
  let off = 0;
  for (const c of voiceSess.chunks) { all.set(c, off); off += c.length; }
  voiceSess.chunks = [];
  toast('Working on it…');
  try {
    const wav = encodeWav16k(all, state.engine?.sampleRate ?? 44100);
    const r = await fetch(`${SERVER}/voice`, { method: 'POST', body: wav });
    const data = await r.json();
    if (!r.ok) { toast(data.error || 'voice failed'); return; }
    const heard = `"${(data.transcript || '').slice(0, 60)}"`;
    if (data.intent?.kind === 'none') {
      toast(`Heard ${heard} — no command matched.`);
      logLine(`voice · ${heard} · no match`);
    } else if (data.intent?.kind === 'digest' && data.result) {
      if (state.page === 'slack') { const out = $('#digest-out'); if (out) { out.hidden = false; out.textContent = data.result; } }
      toast('Digest ready — Slack page.');
      logLine(`voice · ${heard} · digest`, true);
    } else {
      toast(`${heard} → ${data.result ?? data.intent.kind}`);
      logLine(`voice · ${heard} · ${data.result ?? data.intent.kind}`, true);
    }
  } catch {
    toast('Local server unreachable.');
  }
}

/* ================= mode router ================= */

function setMode(mode: Mode) {
  state.mode = mode;
  $('#topbar').hidden = mode === 'landing';
  $('#armed-wrap').hidden = mode !== 'app';
  bg?.setBoost(mode !== 'app');
  if (mode === 'landing') renderLanding();
  if (mode === 'setup') renderSetup();
  if (mode === 'app') {
    renderApp();
    if (!state.engine && !state.micError) showSensorConsent();
  }
  setStatus();
  void syncCamera();
}

/* ================= landing ================= */

function renderLanding() {
  $('#screen').innerHTML = `
    <div class="landing">
      <div class="landing-inner">
        <div class="hero-word">assemble</div>
        <p class="hero-tag">Your desk is the input device.</p>
        <div class="hero-chips">
          <span class="chip" style="animation-delay:.15s">knock the desk</span>
          <span class="chip" style="animation-delay:.3s">whistle · blow · wave</span>
          <span class="chip" style="animation-delay:.45s">speak commands</span>
          <span class="chip" style="animation-delay:.6s">local AI, zero cloud</span>
        </div>
        <div class="hero-cta">
          <button class="primary big" id="get-started">Get started</button>
          <button class="quiet-link" id="skip-landing">Skip — explore first</button>
        </div>
      </div>
    </div>`;
  $('#get-started').onclick = () => { state.setupStep = 0; setMode('setup'); };
  $('#skip-landing').onclick = async () => {
    state.config.onboarded = true;
    await window.assemble.setConfig({ onboarded: true });
    setMode('app');
  };
}

/* ================= setup wizard ================= */

const SETUP_LABELS = ['Microphone', 'Teach', 'Brain', 'Connect', 'Ready'];

function renderSetup() {
  $('#screen').innerHTML = `
    <div class="setup-shell">
      <div class="stepper">
        ${SETUP_LABELS.map((l, i) => `
          <div class="step-dot ${i < state.setupStep ? 'done' : ''} ${i === state.setupStep ? 'now' : ''}">
            <i>${i < state.setupStep ? '✓' : i + 1}</i><span>${l}</span>
          </div>${i < SETUP_LABELS.length - 1 ? '<div class="step-line"></div>' : ''}`).join('')}
      </div>
      <div class="setup-body" id="setup-body"></div>
    </div>`;
  [stepMic, stepTeach, stepBrain, stepConnect, stepReady][state.setupStep]();
}

function setupNext() {
  if (state.setupReturn) { state.setupReturn = false; setMode('app'); return; }
  state.setupStep = Math.min(SETUP_LABELS.length - 1, state.setupStep + 1);
  renderSetup();
}

function stepFooter(body: HTMLElement, { next = 'Continue', skippable = true }: { next?: string; skippable?: boolean } = {}) {
  const row = document.createElement('div');
  row.className = 'setup-footer';
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.textContent = next;
  btn.onclick = setupNext;
  row.appendChild(btn);
  if (skippable) {
    const skip = document.createElement('button');
    skip.className = 'quiet-link';
    skip.textContent = 'Skip for now';
    skip.onclick = setupNext;
    row.appendChild(skip);
  }
  body.appendChild(row);
}

function stepMic() {
  if (!state.engine) void startSensors(); // user clicked into setup — that's the consent
  const body = $('#setup-body');
  body.innerHTML = `
    <div class="eyebrow">step 1 · microphone</div>
    <h1>Can it hear your desk?</h1>
    <p class="lede" id="mic-hint">Tap the desk — the meter should jump.</p>
    <div class="meter">${'<i></i>'.repeat(16)}</div>
    <label class="inline-label">Microphone <select id="device"></select></label>`;
  if (state.micError) {
    $('#mic-hint').textContent = `Microphone unavailable: ${state.micError}. Allow access in System Settings → Privacy & Security → Microphone, then relaunch.`;
  }
  void populateDevices();
  $('#device').onchange = onDeviceChange;
  stepFooter(body, { next: 'It jumps — continue' });
}

function stepTeach() {
  state.classifier = new TapClassifier();
  state.teach = { stepIdx: 0, secondsLeft: null, timer: null };
  const body = $('#setup-body');
  body.innerHTML = `
    <div class="eyebrow">step 2 · teach</div>
    <h1 id="teach-title"></h1>
    <p class="lede" id="teach-hint"></p>
    <div class="desk-wrap">
      <div class="desk" id="desk">
        ${ZONES.map(z => `<div class="corner" data-zone="${z.id}">
            <span class="pos">${z.label}</span>
            <span class="count" id="count-${z.id}">·</span>
          </div>`).join('')}
        <div class="mic-dot" title="your microphone"></div>
      </div>
    </div>
    <div class="progress-line" id="teach-progress"></div>
    <div id="teach-extra"></div>
    <div class="setup-footer"><button class="quiet-link" id="teach-cancel">Skip for now</button></div>`;
  $('#teach-cancel').onclick = cancelTeach;
  renderTeachStep();
}

function stepBrain() {
  const body = $('#setup-body');
  body.innerHTML = `
    <div class="eyebrow">step 3 · brain</div>
    <h1>Give it a brain.</h1>
    <p class="lede">Everything installs and runs on this Mac — no cloud AI, nothing leaves your machine. Powers Slack triage, digests, drafts, call summaries, and voice commands.</p>
    <div class="setup-rows" id="setup-rows">
      ${SETUP_ROWS.map(r => `
        <div class="setup-row" data-step="${r.step}">
          <span class="state todo">○</span>
          <span>${r.label}</span>
          <span class="line" hidden></span>
        </div>`).join('')}
    </div>
    <button class="primary" id="install-all">Install everything</button>`;
  void refreshSetupStatus();
  $('#install-all').onclick = installEverything;
  stepFooter(body);
}

function stepConnect() {
  const body = $('#setup-body');
  body.innerHTML = `
    <div class="eyebrow">step 4 · connect</div>
    <h1>Wire in your work.</h1>
    <div class="setup-inputs">
      <b>Slack</b>
      <span class="hint">api.slack.com → your app → Socket Mode on. App token needs <code>connections:write</code>.</span>
      <input id="slack-app-token" type="password" placeholder="xapp-… app-level token" />
      <input id="slack-bot-token" type="password" placeholder="xoxb-… bot token" />
      <button class="secondary" id="slack-connect">Connect Slack</button>
      <span id="slack-setup-status" class="hint"></span>
    </div>
    <div class="setup-inputs">
      <b>Linear</b>
      <span class="hint">linear.app → Settings → API → personal key. Issues become one-click Claude Code sessions.</span>
      <input id="linear-key" type="password" placeholder="lin_api_…" />
      <button class="secondary" id="linear-connect">Connect Linear</button>
      <span id="linear-setup-status" class="hint"></span>
    </div>`;
  $('#slack-connect').onclick = connectSlackTokens;
  $('#linear-connect').onclick = connectLinearKey;
  void refreshSetupStatus();
  stepFooter(body);
}

function stepReady() {
  const body = $('#setup-body');
  body.innerHTML = `
    <div class="ready-mark">✓</div>
    <h1>Assembled.</h1>
    <p class="lede">Knock a desk corner to trigger it. Hold nothing — just knuckles, whistles, and words.<br/>
    Everything lives in the sidebar; every knob is in Settings.</p>
    <div class="setup-footer"><button class="primary big" id="enter-app">Open assemble</button></div>`;
  $('#enter-app').onclick = async () => {
    state.config.onboarded = true;
    await window.assemble.setConfig({ onboarded: true });
    setMode('app');
    toast('Click a corner to choose what it does.');
  };
}

/* ================= app shell ================= */

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: 'desk', label: 'Desk', icon: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>' },
  { page: 'slack', label: 'Slack', icon: '<svg viewBox="0 0 16 16"><path d="M6 1v6M10 9v6M1 10h6M9 6h6" stroke-width="2" stroke-linecap="round"/></svg>' },
  { page: 'calls', label: 'Calls', icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke-width="1.6"/><circle cx="8" cy="8" r="2"/></svg>' },
  { page: 'work', label: 'Work', icon: '<svg viewBox="0 0 16 16"><path d="M2 4l4 4-4 4M8 12h6" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { page: 'activity', label: 'Activity', icon: '<svg viewBox="0 0 16 16"><path d="M1 8h3l2-5 4 10 2-5h3" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { page: 'settings', label: 'Settings', icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.4" fill="none" stroke-width="1.6"/><path d="M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15M3 3l1.7 1.7M11.3 11.3L13 13M13 3l-1.7 1.7M4.7 11.3L3 13" stroke-width="1.6" stroke-linecap="round"/></svg>' },
];

function renderApp() {
  $('#screen').innerHTML = `
    <div class="shell">
      <nav class="sidenav">
        ${NAV.map(n => `
          <button class="nav-item" data-page="${n.page}">
            ${n.icon}<span>${n.label}</span>
          </button>`).join('')}
      </nav>
      <main class="page" id="page"></main>
    </div>`;
  document.querySelectorAll('.nav-item').forEach(el => {
    (el as HTMLElement).onclick = () => setPage((el as HTMLElement).dataset.page as Page);
  });
  setPage(state.page);
}

function setPage(page: Page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', (el as HTMLElement).dataset.page === page));
  const el = $('#page');
  el.classList.remove('page-in');
  void el.offsetWidth;
  el.classList.add('page-in');
  ({ desk: pageDesk, slack: pageSlack, calls: pageCalls, work: pageWork, activity: pageActivity, settings: pageSettings })[page]();
}

/* ================= page: desk ================= */

function pageDesk() {
  $('#page').innerHTML = `
    <div class="page-head">
      <h2>Desk</h2>
      <p>Four corners × three knock patterns. Click a corner to assign its actions.</p>
    </div>
    <div class="desk-wrap">
      <div class="desk" id="desk">
        ${ZONES.map(z => `<div class="corner" data-zone="${z.id}" tabindex="0" role="button">
            <span class="pos">${z.label}</span>
            <span class="what" id="what-${z.id}"></span>
          </div>`).join('')}
        <div class="mic-dot" title="your microphone"></div>
      </div>
    </div>
    <div class="bottom">
      <span class="hint">${isTrained() ? 'Calibrated.' : 'Not taught yet — corners can’t be told apart.'}</span>
      <span class="spacer"></span>
      <button class="secondary" id="reteach">${isTrained() ? 'Re-teach corners' : 'Teach corners'}</button>
    </div>`;
  for (const z of ZONES) {
    updateCornerFace(z.id);
    const el = $(`.corner[data-zone="${z.id}"]`);
    el.onclick = () => openEditor(z.id);
    el.onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(z.id); }
    };
  }
  $('#reteach').onclick = () => { state.setupReturn = true; state.setupStep = 1; setMode('setup'); };
}

/* ================= page: slack ================= */

function pageSlack() {
  $('#page').innerHTML = `
    <div class="page-head">
      <h2>Slack</h2>
      <p>Everything captured locally. Click a message to draft a reply — nothing sends without you.</p>
    </div>
    <div class="pane">
      <div class="pane-toolbar">
        <button class="secondary" id="digest-btn" title="Summarize unread since last digest">Digest</button>
        <span id="slack-status" class="pane-status"></span>
      </div>
      <pre id="digest-out" class="digest" hidden></pre>
      <ul id="slack-log" class="feed"></ul>
      <div id="draft-box" class="draft-box" hidden>
        <div class="editor-head"><b id="draft-title"></b><button class="ghost" id="draft-close">✕</button></div>
        <textarea id="draft-text" rows="3"></textarea>
        <div style="display:flex; gap:8px;">
          <button class="secondary" id="draft-send">Send to Slack</button>
          <button class="secondary" id="draft-again">Redraft</button>
        </div>
      </div>
    </div>`;
  $('#digest-btn').onclick = runDigest;
  $('#draft-close').onclick = () => { $('#draft-box').hidden = true; draftTarget = null; };
  $('#draft-send').onclick = sendDraft;
  $('#draft-again').onclick = redraft;
  connectSlackFeed();
}

/* ================= page: calls ================= */

function pageCalls() {
  $('#page').innerHTML = `
    <div class="page-head">
      <h2>Calls</h2>
      <p>Records both sides: your mic + system audio. Everyone on the call should know.</p>
    </div>
    <div class="pane">
      <div class="pane-toolbar">
        <button class="secondary" id="rec-btn">● Record</button>
        <span id="rec-status" class="pane-status"></span>
      </div>
      <ul id="rec-list" class="feed"></ul>
    </div>`;
  $('#rec-btn').onclick = toggleRecording;
  void refreshRecordings();
}

/* ================= page: work ================= */

function pageWork() {
  $('#page').innerHTML = `
    <div class="page-head">
      <h2>Work</h2>
      <p>Claude Code sessions in any repo. Pick the directory per run — recents remembered.</p>
    </div>
    <div class="pane">
      <div class="work-form">
        <div class="work-row">
          <input id="work-dir" list="work-dirs" placeholder="~/midgard/…  (working directory)" />
          <datalist id="work-dirs"></datalist>
        </div>
        <textarea id="work-prompt" rows="2" placeholder="What should Claude Code do?"></textarea>
        <div class="work-row">
          <label class="switch"><input type="checkbox" id="work-skip" />
            <span>Skip permission prompts (full autonomy in that repo)</span></label>
          <span class="spacer"></span>
          <button class="secondary" id="work-run">Run Claude Code</button>
        </div>
        <span id="work-status" class="pane-status"></span>
      </div>
      <ul id="work-list" class="feed"></ul>
    </div>
    <div class="pane">
      <div class="pane-toolbar"><b class="pane-title">Linear</b><span id="linear-status" class="pane-status"></span></div>
      <ul id="linear-list" class="feed"></ul>
    </div>`;
  $('#work-run').onclick = runAgent;
  void refreshWork();
  void refreshLinear();
}

/* ================= page: activity ================= */

function pageActivity() {
  $('#page').innerHTML = `
    <div class="page-head">
      <h2>Activity</h2>
      <p>Every gesture, voice command, and rejection — most recent first.</p>
    </div>
    <div class="pane"><ul id="log" class="feed"></ul></div>`;
  const log = $('#log');
  for (const a of state.activity) {
    const li = document.createElement('li');
    li.textContent = `${a.time}  ${a.text}`;
    if (a.hit) li.className = 'hit';
    log.appendChild(li);
  }
}

/* ================= page: settings ================= */

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'gestures', label: 'Gestures' },
  { id: 'connections', label: 'Connections' },
  { id: 'ai', label: 'Local AI' },
];

function pageSettings() {
  $('#page').innerHTML = `
    <div class="page-head"><h2>Settings</h2></div>
    <div class="tabs">
      ${TABS.map(t => `<button class="tab" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div class="pane" id="tab-body"></div>`;
  document.querySelectorAll('.tab').forEach(el => {
    (el as HTMLElement).onclick = () => {
      state.settingsTab = (el as HTMLElement).dataset.tab as SettingsTab;
      renderSettingsTab();
    };
  });
  renderSettingsTab();
}

function renderSettingsTab() {
  document.querySelectorAll('.tab').forEach(el =>
    el.classList.toggle('active', (el as HTMLElement).dataset.tab === state.settingsTab));
  const body = $('#tab-body');
  if (state.settingsTab === 'general') {
    body.innerHTML = `
      <div class="setting-row">
        <label>Theme</label>
        <select id="theme-sel">
          <option value="system">Follow system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div class="setting-row">
        <label>Microphone</label>
        <select id="device"></select>
      </div>
      <div class="setting-row">
        <label>Sensitivity <span class="hint">left = softer taps register</span></label>
        <input type="range" id="sensitivity" min="3" max="15" step="0.5" />
      </div>
      <div class="setting-row danger-zone">
        <label>Start over</label>
        <span class="hint">Wipes everything: calibration, actions, Slack/Linear tokens, captured messages, call recordings, Claude Code session history. Back to the intro screen.</span>
        <button class="secondary danger" id="wipe-btn">Wipe everything…</button>
      </div>`;
    $('#theme-sel').value = state.config.theme || 'system';
    $('#theme-sel').onchange = async (e: any) => {
      state.config.theme = e.target.value;
      await window.assemble.setConfig({ theme: state.config.theme });
      applyTheme();
    };
    void populateDevices();
    $('#device').onchange = onDeviceChange;
    $('#sensitivity').value = state.config.sensitivity;
    $('#sensitivity').onchange = async (e: any) => {
      state.config.sensitivity = Number(e.target.value);
      await window.assemble.setConfig({ sensitivity: state.config.sensitivity });
      await startEngine();
    };
    $('#wipe-btn').onclick = wipeEverything;
  }
  if (state.settingsTab === 'gestures') {
    body.innerHTML = `
      <div class="setting-row">
        <label class="switch"><input type="checkbox" id="whistle-toggle" />
          <span>Whistle slides system volume — pitch up = louder</span></label>
      </div>
      <div class="setting-row" id="blow-row">
        <label>Blow at the mic</label>
      </div>
      <div class="setting-row">
        <label class="switch"><input type="checkbox" id="camera-toggle" />
          <span>Hand waves via camera — processed locally, nothing recorded</span></label>
      </div>
      <div class="setting-row wave-rows" id="wave-rows" hidden>
        <div><label>Wave on the left</label></div>
        <div><label>Wave on the right</label></div>
      </div>
      <p class="hint">Corner knock patterns are edited on the Desk page. Voice hotkey: press and release <b>Cmd+Shift</b> alone, anywhere (needs Input Monitoring permission; Ctrl+Shift+Space works as fallback).</p>`;
    $('#whistle-toggle').checked = state.config.extras.whistleVolume;
    $('#whistle-toggle').onchange = (e: any) => {
      state.config.extras.whistleVolume = e.target.checked;
      void window.assemble.setConfig({ extras: { ...state.config.extras, whistleVolume: e.target.checked } });
    };
    $('#blow-row').appendChild(actionPicker(state.config.extras.blow.action, action => {
      state.config.extras.blow.action = action;
      void window.assemble.setConfig({ extras: { ...state.config.extras, blow: { action } } });
    }));
    $('#camera-toggle').checked = state.config.extras.camera.enabled;
    $('#wave-rows').hidden = !state.config.extras.camera.enabled;
    $('#camera-toggle').onchange = (e: any) => {
      state.config.extras.camera.enabled = e.target.checked;
      $('#wave-rows').hidden = !e.target.checked;
      void window.assemble.setConfig({ extras: { ...state.config.extras, camera: { ...state.config.extras.camera, enabled: e.target.checked } } });
      void syncCamera();
    };
    const [leftRow, rightRow] = $('#wave-rows').children;
    leftRow.appendChild(actionPicker(state.config.extras.camera.left.action, action => {
      state.config.extras.camera.left = { action };
      void window.assemble.setConfig({ extras: { ...state.config.extras, camera: { ...state.config.extras.camera, left: { action } } } });
    }));
    rightRow.appendChild(actionPicker(state.config.extras.camera.right.action, action => {
      state.config.extras.camera.right = { action };
      void window.assemble.setConfig({ extras: { ...state.config.extras, camera: { ...state.config.extras.camera, right: { action } } } });
    }));
  }
  if (state.settingsTab === 'connections') {
    body.innerHTML = `
      <div class="setup-inputs">
        <b>Slack</b>
        <span class="hint">Socket Mode on; app token needs <code>connections:write</code>.</span>
        <input id="slack-app-token" type="password" placeholder="xapp-… app-level token" />
        <input id="slack-bot-token" type="password" placeholder="xoxb-… bot token" />
        <button class="secondary" id="slack-connect">Connect Slack</button>
        <span id="slack-setup-status" class="hint"></span>
      </div>
      <div class="setup-inputs">
        <b>Linear</b>
        <input id="linear-key" type="password" placeholder="lin_api_…" />
        <button class="secondary" id="linear-connect">Connect Linear</button>
        <span id="linear-setup-status" class="hint"></span>
      </div>`;
    $('#slack-connect').onclick = connectSlackTokens;
    $('#linear-connect').onclick = connectLinearKey;
    void refreshSetupStatus();
  }
  if (state.settingsTab === 'ai') {
    body.innerHTML = `
      <p class="hint">All local — llama.cpp + whisper.cpp, Gemma 4 12B. Nothing leaves this Mac.</p>
      <div class="setup-rows" id="setup-rows">
        ${SETUP_ROWS.map(r => `
          <div class="setup-row" data-step="${r.step}">
            <span class="state todo">○</span>
            <span>${r.label}</span>
            <span class="line" hidden></span>
          </div>`).join('')}
      </div>
      <button class="primary" id="install-all">Install everything</button>`;
    void refreshSetupStatus();
    $('#install-all').onclick = installEverything;
  }
}

async function wipeEverything() {
  const sure = confirm(
    'Wipe everything?\n\nCalibration, corner actions, Slack & Linear tokens, captured messages, call recordings, and Claude Code session history will be deleted. This cannot be undone.',
  );
  if (!sure) return;
  try { await fetch(`${SERVER}/reset`, { method: 'POST' }); } catch { /* server offline — local reset still proceeds */ }
  state.config = await window.assemble.resetAll();
  state.classifier = new TapClassifier();
  state.activity = [];
  if (state.camera) { state.camera.stop(); state.camera = null; }
  applyTheme();
  $('#armed').checked = state.config.armed;
  toast('Everything wiped. Starting fresh.');
  setMode('landing');
}

/* ================= teach logic ================= */

type TeachStep = { kind: 'zone'; zone: (typeof ZONES)[number] } | { kind: 'noise' };

function teachSteps(): TeachStep[] {
  return (ZONES.map(z => ({ kind: 'zone', zone: z })) as TeachStep[]).concat([{ kind: 'noise' }]);
}

function renderTeachStep() {
  const teach = state.teach!;
  const step = teachSteps()[teach.stepIdx];
  document.querySelectorAll('.corner').forEach(c => c.classList.remove('teach'));
  const extra = $('#teach-extra');
  extra.innerHTML = '';
  if (step.kind === 'zone') {
    $('#teach-title').textContent = `Tap the ${step.zone.label.toLowerCase()} corner`;
    $('#teach-hint').textContent = `Knock the ${step.zone.label.toLowerCase()} of your desk ${TAPS_PER_ZONE} times with a knuckle. Directly on the desk, not the laptop. Vary the strength a little.`;
    $(`.corner[data-zone="${step.zone.id}"]`).classList.add('teach');
    const have = state.classifier.counts()[step.zone.id] || 0;
    $('#teach-progress').innerHTML = `<b>${have}</b> of ${TAPS_PER_ZONE}`;
  } else {
    $('#teach-title').textContent = 'Now teach it what to ignore';
    $('#teach-hint').textContent = 'For ten seconds: type, click your mouse, clap, set something down. Every sound that is NOT a desk tap.';
    teach.secondsLeft = NOISE_SECONDS;
    $('#teach-progress').innerHTML = `<span class="countdown" id="countdown">${NOISE_SECONDS}</span>`;
    teach.timer = setInterval(() => {
      teach.secondsLeft = (teach.secondsLeft ?? 0) - 1;
      const el = $('#countdown');
      if (el) el.textContent = String(Math.max(0, teach.secondsLeft));
      if (teach.secondsLeft <= 0) void finishTeach();
    }, 1000);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:10px; justify-content:center;';
  const redo = document.createElement('button');
  redo.className = 'secondary';
  redo.textContent = step.kind === 'zone' ? 'Redo this corner' : 'Redo this step';
  redo.onclick = () => redoStep();
  row.appendChild(redo);
  if (teach.stepIdx > 0) {
    const back = document.createElement('button');
    back.className = 'secondary';
    back.textContent = 'Previous corner';
    back.onclick = () => previousStep();
    row.appendChild(back);
    const over = document.createElement('button');
    over.className = 'secondary';
    over.textContent = 'Start over';
    over.onclick = () => { if (teach.timer) clearInterval(teach.timer); stepTeach(); };
    row.appendChild(over);
  }
  extra.appendChild(row);
}

function redoStep() {
  const teach = state.teach!;
  const step = teachSteps()[teach.stepIdx];
  if (teach.timer) clearInterval(teach.timer);
  if (step.kind === 'zone') {
    state.classifier.clear(step.zone.id);
    const countEl = $(`#count-${step.zone.id}`);
    if (countEl) countEl.textContent = '·';
  } else {
    state.classifier.clear(REJECT_LABEL);
  }
  renderTeachStep();
}

function previousStep() {
  const teach = state.teach!;
  if (teach.timer) clearInterval(teach.timer);
  const steps = teachSteps();
  const cur = steps[teach.stepIdx];
  state.classifier.clear(cur.kind === 'zone' ? cur.zone.id : REJECT_LABEL);
  teach.stepIdx--;
  const prev = steps[teach.stepIdx];
  if (prev.kind === 'zone') {
    state.classifier.clear(prev.zone.id);
    const countEl = $(`#count-${prev.zone.id}`);
    if (countEl) countEl.textContent = '·';
  }
  renderTeachStep();
}

function teachCollect(vec: Float64Array) {
  const teach = state.teach;
  if (!teach) return;
  const step = teachSteps()[teach.stepIdx];
  if (step.kind === 'zone') {
    state.classifier.addSample(step.zone.id, vec);
    const have = state.classifier.counts()[step.zone.id] || 0;
    const countEl = $(`#count-${step.zone.id}`);
    if (countEl) countEl.textContent = String(have);
    $('#teach-progress').innerHTML = `<b>${Math.min(have, TAPS_PER_ZONE)}</b> of ${TAPS_PER_ZONE}`;
    if (have >= TAPS_PER_ZONE) {
      teach.stepIdx++;
      renderTeachStep();
    }
  } else {
    state.classifier.addSample(REJECT_LABEL, vec);
  }
}

async function finishTeach() {
  const teach = state.teach!;
  if (teach.timer) clearInterval(teach.timer);
  state.teach = null;
  state.config.classifier = state.classifier.toJSON();
  await window.assemble.setConfig({ classifier: state.config.classifier });
  toast('Corners learned.');
  setupNext();
}

function cancelTeach() {
  if (state.teach?.timer) clearInterval(state.teach.timer);
  state.teach = null;
  state.classifier = state.config.classifier
    ? TapClassifier.fromJSON(state.config.classifier) : new TapClassifier();
  setupNext();
}

/* ================= setup helpers (shared with settings) ================= */

const SETUP_ROWS = [
  { key: 'llamaCpp', step: 'llama.cpp', label: 'AI engine — llama.cpp' },
  { key: 'whisperCpp', step: 'whisper-cpp', label: 'Speech engine — whisper.cpp' },
  { key: 'whisperModel', step: 'whisper-model', label: 'Speech model — whisper large-v3-turbo (1.6 GB, English + Hindi + Gujarati)' },
  { key: 'audiotap', step: 'audiotap', label: 'Call capture helper' },
  { key: 'llmRunning', step: 'llm-start', label: 'Local AI on — Gemma 4 12B (7 GB, first time only)' },
] as const;

async function refreshSetupStatus(): Promise<Record<string, boolean>> {
  try {
    const s = await (await fetch(`${SERVER}/setup/status`)).json();
    for (const r of SETUP_ROWS) {
      const el = $(`.setup-row[data-step="${r.step}"] .state`);
      if (!el) continue;
      el.textContent = s[r.key] ? '✓' : '○';
      el.className = `state ${s[r.key] ? 'ok' : 'todo'}`;
    }
    const slackStatus = $('#slack-setup-status');
    if (slackStatus && !slackStatus.textContent) {
      slackStatus.textContent = s.slackConnected ? 'Connected.' :
        s.slackConfigured ? 'Tokens saved, not connected — check Socket Mode.' : '';
    }
    const linearStatus = $('#linear-setup-status');
    if (linearStatus && !linearStatus.textContent) {
      linearStatus.textContent = s.linearConfigured ? 'Key saved.' : '';
    }
    return s;
  } catch {
    return {};
  }
}

function setupProgressLine(p: { step: string; line?: string; done?: boolean; error?: string }) {
  const line = $(`.setup-row[data-step="${p.step}"] .line`);
  if (!line) return;
  line.hidden = false;
  if (p.error) line.textContent = `failed: ${p.error}`;
  else if (p.done) { line.textContent = 'done'; void refreshSetupStatus(); }
  else if (p.line) line.textContent = p.line;
}

async function installEverything() {
  const btn = $('#install-all');
  btn.disabled = true; btn.textContent = 'Installing…';
  const status = await refreshSetupStatus();
  for (const r of SETUP_ROWS) {
    if (status[r.key]) continue;
    try {
      const res = await fetch(`${SERVER}/setup/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: r.step }),
      });
      if (!res.ok) break; // error line already shown via WS
    } catch { break; }
  }
  await refreshSetupStatus();
  btn.disabled = false; btn.textContent = 'Install everything';
}

async function connectSlackTokens() {
  const appToken = $('#slack-app-token').value.trim();
  const botToken = $('#slack-bot-token').value.trim();
  const status = $('#slack-setup-status');
  if (!appToken && !botToken) { status.textContent = 'Paste at least the xapp- token.'; return; }
  status.textContent = 'Connecting…';
  try {
    const r = await fetch(`${SERVER}/setup/slack`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appToken: appToken || undefined, botToken: botToken || undefined }),
    });
    const data = await r.json();
    status.textContent = data.connected ? 'Connected.' : 'Saved, but not connected — check tokens + Socket Mode.';
  } catch {
    status.textContent = 'Local server unreachable.';
  }
}

async function connectLinearKey() {
  const apiKey = $('#linear-key').value.trim();
  const status = $('#linear-setup-status');
  if (!apiKey) { status.textContent = 'Paste a lin_api_ key.'; return; }
  status.textContent = 'Checking…';
  try {
    const r = await fetch(`${SERVER}/setup/linear`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    const data = await r.json();
    status.textContent = data.connected ? `Connected — ${data.count} open issues.` : `Failed: ${data.error}`;
  } catch {
    status.textContent = 'Local server unreachable.';
  }
}

/* ================= slack feed ================= */

let slackWs: WebSocket | null = null;
let slackRetry: ReturnType<typeof setTimeout> | null = null;

interface SlackMsg {
  channelName?: string | null; channel_name?: string | null; channel: string;
  userName?: string | null; user_name?: string | null; user?: string | null;
  slackTs?: string; slack_ts?: string; threadTs?: string | null; thread_ts?: string | null;
  text: string;
}

let draftTarget: { channel: string; ts?: string; threadTs?: string | null } | null = null;

function slackLine(m: SlackMsg) {
  const log = $('#slack-log');
  if (!log) return;
  const chan = m.channelName ?? m.channel_name ?? m.channel;
  const who = m.userName ?? m.user_name ?? m.user ?? '?';
  const li = document.createElement('li');
  li.textContent = `#${chan}  ${who}: ${m.text}`;
  li.title = 'Click to draft a reply';
  li.style.cursor = 'pointer';
  li.onclick = () => openDraft(m);
  log.prepend(li);
  while (log.children.length > 25) log.lastChild!.remove();
}

async function openDraft(m: SlackMsg) {
  const box = $('#draft-box');
  const ts = m.slackTs ?? m.slack_ts;
  draftTarget = { channel: m.channel, ts, threadTs: m.threadTs ?? m.thread_ts ?? ts };
  box.hidden = false;
  $('#draft-title').textContent = `Reply to ${m.userName ?? m.user_name ?? m.user ?? '?'}`;
  $('#draft-text').value = 'drafting…';
  await redraft();
}

async function redraft() {
  if (!draftTarget) return;
  try {
    const r = await fetch(`${SERVER}/slack/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: draftTarget.channel, ts: draftTarget.ts }),
    });
    const data = await r.json();
    $('#draft-text').value = r.ok ? data.draft : (data.error || 'draft failed');
  } catch {
    $('#draft-text').value = 'server offline';
  }
}

async function sendDraft() {
  if (!draftTarget) return;
  const text = $('#draft-text').value.trim();
  if (!text) return;
  try {
    const r = await fetch(`${SERVER}/slack/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: draftTarget.channel, text, threadTs: draftTarget.threadTs }),
    });
    const data = await r.json();
    if (r.ok && data.ok) { toast('Sent.'); $('#draft-box').hidden = true; draftTarget = null; }
    else toast(`Send failed: ${data.error || 'unknown'}`);
  } catch {
    toast('Send failed: server offline');
  }
}

async function runDigest() {
  const btn = $('#digest-btn');
  const out = $('#digest-out');
  btn.disabled = true; btn.textContent = 'Digesting…';
  try {
    const r = await fetch(`${SERVER}/slack/digest`, { method: 'POST' });
    const data = await r.json();
    out.hidden = false;
    out.textContent = r.ok ? `${data.summary}\n\n(${data.count} messages)` : (data.error || 'digest failed');
  } catch {
    out.hidden = false;
    out.textContent = 'server offline';
  }
  btn.disabled = false; btn.textContent = 'Digest';
}

function connectSlackFeed() {
  const status = $('#slack-status');
  if (slackRetry) clearTimeout(slackRetry);
  fetch(`${SERVER}/slack/recent?limit=20`)
    .then(r => r.json())
    .then((rows: SlackMsg[]) => {
      if (status) status.textContent = '';
      const log = $('#slack-log');
      if (log) log.innerHTML = '';
      for (const m of rows.reverse()) slackLine(m);
      openWs();
    })
    .catch(() => {
      if (status) status.textContent = 'local server offline';
      scheduleSlackRetry();
    });
}

function scheduleSlackRetry() {
  if (slackRetry) clearTimeout(slackRetry);
  slackRetry = setTimeout(() => { if (state.page === 'slack') connectSlackFeed(); else openWs(); }, 30_000);
}

// One WebSocket for everything the server pushes; handlers are null-safe so
// they no-op on pages that lack the target elements.
function openWs() {
  if (slackWs && slackWs.readyState <= WebSocket.OPEN) return;
  slackWs = new WebSocket('ws://127.0.0.1:4817/ws');
  slackWs.onmessage = e => {
    const payload = JSON.parse(e.data);
    if (payload.kind === 'slack-message') slackLine(payload.message);
    if (payload.kind === 'urgent') toast(`Urgent · ${payload.message.userName ?? '?'}: ${payload.message.text.slice(0, 80)}`);
    if (payload.kind === 'slack-connected') { const s = $('#slack-status'); if (s) s.textContent = ''; }
    if (payload.kind === 'voice-hotkey') voiceToggle();
    if (payload.kind === 'setup-progress') setupProgressLine(payload);
    if (payload.kind === 'recording') void onRecordingEvent(payload);
    if (payload.kind === 'agent') {
      if (payload.state !== 'running') toast(`Claude Code session #${payload.id}: ${payload.state}`);
      void refreshWork();
    }
  };
  slackWs.onclose = () => { slackWs = null; scheduleSlackRetry(); };
}

/* ================= calls ================= */

interface RecordingRow {
  id: number; started_at: string; ended_at: string | null;
  transcript: string | null; summary: string | null; status: string;
}

function recBtnState(recording: boolean) {
  const btn = $('#rec-btn');
  if (btn) btn.textContent = recording ? '■ Stop' : '● Record';
  $('#rec-dot').hidden = !recording;
}

async function toggleRecording() {
  try {
    const r = await fetch(`${SERVER}/record/toggle`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) { toast(`Recording: ${data.error}`); return; }
    recBtnState(data.state === 'recording');
  } catch {
    toast('Local server unreachable.');
  }
}

async function refreshRecordings() {
  try {
    const health = await (await fetch(`${SERVER}/health`)).json();
    recBtnState(Boolean(health.recording));
    const rows: RecordingRow[] = await (await fetch(`${SERVER}/recordings?limit=10`)).json();
    const list = $('#rec-list');
    if (!list) return;
    list.innerHTML = '';
    for (const rec of rows) {
      const li = document.createElement('li');
      li.className = 'rec-item';
      const when = new Date(rec.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const label = rec.status === 'done'
        ? (rec.summary ?? rec.transcript ?? '').split('\n')[0].slice(0, 90)
        : rec.status;
      li.textContent = `${when} · ${label}`;
      if (rec.status === 'done') {
        li.style.cursor = 'pointer';
        li.title = 'Click for summary + transcript';
        li.onclick = () => {
          const open = li.querySelector('.rec-detail');
          if (open) { open.remove(); return; }
          const d = document.createElement('div');
          d.className = 'rec-detail';
          d.textContent = `${rec.summary ?? ''}\n\n— transcript —\n${rec.transcript ?? ''}`;
          li.appendChild(d);
        };
      }
      list.appendChild(li);
    }
  } catch { /* server offline */ }
}

async function onRecordingEvent(p: { state: string }) {
  recBtnState(p.state === 'started');
  const status = $('#rec-status');
  if (status) status.textContent = p.state === 'transcribing' ? 'transcribing…' : '';
  if (p.state === 'done' || p.state === 'error' || p.state === 'stopped') void refreshRecordings();
}

/* ================= work + linear ================= */

interface AgentSession {
  id: number; cwd: string; prompt: string; status: string;
  output: string | null; created_at: string;
}

async function refreshWork() {
  try {
    const dirs: string[] = await (await fetch(`${SERVER}/agent/dirs`)).json();
    const dl = $('#work-dirs');
    if (dl) dl.innerHTML = dirs.map(d => `<option value="${d}"></option>`).join('');
    const dirInput = $('#work-dir');
    if (dirInput && !dirInput.value) dirInput.value = dirs[0] ?? '~/midgard';
    const rows: AgentSession[] = await (await fetch(`${SERVER}/agent/sessions?limit=8`)).json();
    const list = $('#work-list');
    if (!list) return;
    list.innerHTML = '';
    for (const s of rows) {
      const li = document.createElement('li');
      li.className = 'rec-item';
      const when = new Date(s.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const icon = s.status === 'running' ? '◌' : s.status === 'done' ? '✓' : s.status === 'stopped' ? '■' : '✗';
      li.textContent = `${when} ${icon} ${s.cwd.split('/').slice(-2).join('/')} · ${s.prompt.slice(0, 60)}`;
      li.style.cursor = 'pointer';
      li.onclick = async () => {
        const open = li.querySelector('.rec-detail');
        if (open) { open.remove(); return; }
        const d = document.createElement('div');
        d.className = 'rec-detail';
        if (s.status === 'running') {
          const stop = document.createElement('button');
          stop.className = 'secondary';
          stop.textContent = 'Stop session';
          stop.onclick = async e => {
            e.stopPropagation();
            await fetch(`${SERVER}/agent/stop`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: s.id }),
            });
          };
          d.append('running…  ', stop);
        } else {
          const full: AgentSession = await (await fetch(`${SERVER}/agent/sessions/${s.id}`)).json();
          d.textContent = full.output || '(no output)';
        }
        li.appendChild(d);
      };
      list.appendChild(li);
    }
  } catch { /* server offline */ }
}

async function runAgent() {
  const cwd = $('#work-dir').value.trim();
  const prompt = $('#work-prompt').value.trim();
  const status = $('#work-status');
  if (!cwd || !prompt) { status.textContent = 'directory + prompt required'; return; }
  status.textContent = 'starting…';
  try {
    const r = await fetch(`${SERVER}/agent/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, prompt, skipPermissions: $('#work-skip').checked }),
    });
    const data = await r.json();
    status.textContent = r.ok ? '' : data.error;
    if (r.ok) { $('#work-prompt').value = ''; void refreshWork(); }
  } catch {
    status.textContent = 'server offline';
  }
}

interface LinearIssueUi { identifier: string; title: string; state: string; url: string; description: string | null }

async function refreshLinear() {
  const status = $('#linear-status');
  try {
    const r = await fetch(`${SERVER}/linear/issues`);
    const data = await r.json();
    if (!r.ok) { if (status) status.textContent = data.error; return; }
    if (status) status.textContent = '';
    const list = $('#linear-list');
    if (!list) return;
    list.innerHTML = '';
    for (const issue of data as LinearIssueUi[]) {
      const li = document.createElement('li');
      li.className = 'rec-item';
      li.textContent = `${issue.identifier} · ${issue.state} · ${issue.title}`;
      li.style.cursor = 'pointer';
      li.title = 'Click to prefill a Claude Code session for this issue';
      li.onclick = () => {
        $('#work-prompt').value =
          `Work on Linear issue ${issue.identifier}: ${issue.title}.\n${(issue.description ?? '').slice(0, 500)}`;
        $('#work-prompt').scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('#work-prompt').focus();
      };
      list.appendChild(li);
    }
  } catch { /* server offline */ }
}

/* ================= pickers + corner editor ================= */

function isTrained(): boolean {
  const counts = state.classifier.counts();
  return ZONES.every(z => (counts[z.id] || 0) > 0);
}

function actionSummary(action: Action | null | undefined): string {
  if (!action || !action.type) return '';
  if (action.type === 'system') return PRESET_NAMES[action.value] || action.value;
  if (action.type === 'voice') return '🎙 Voice command';
  return `${TYPE_NAMES[action.type]} ${action.value}`.trim();
}

function updateCornerFace(zoneId: ZoneId) {
  const el = $(`#what-${zoneId}`);
  if (!el) return;
  const actions = state.config.zones[zoneId].actions || {};
  const parts = PATTERNS.filter(n => actions[String(n) as '1' | '2' | '3'])
    .map(n => `${n}× ${actionSummary(actions[String(n) as '1' | '2' | '3'])}`);
  el.textContent = parts.length ? parts.join('  ·  ') : 'Not set — click to assign';
  el.classList.toggle('unset', !parts.length);
}

// Small self-saving control: [type ▾] [preset ▾ | value input]
function actionPicker(current: Action | null | undefined, onChange: (a: Action | null) => void): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'picker';
  wrap.innerHTML = `
    <select class="pk-type">
      <option value="">Does nothing</option>
      <option value="system">System action</option>
      <option value="shell">Run a command</option>
      <option value="keystroke">Press a shortcut</option>
      <option value="open">Open app or link</option>
      <option value="voice">🎙 Voice command</option>
    </select>
    <select class="pk-preset" hidden>
      ${Object.entries(PRESET_NAMES).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}
    </select>
    <input class="pk-value" hidden />`;
  const typeSel = wrap.querySelector('.pk-type') as HTMLSelectElement;
  const presetSel = wrap.querySelector('.pk-preset') as HTMLSelectElement;
  const valInput = wrap.querySelector('.pk-value') as HTMLInputElement;
  const placeholders: Record<string, string> = { shell: 'say "hello"', keystroke: 'cmd+shift+4', open: 'https://… or /Applications/App.app' };
  if (current) {
    typeSel.value = current.type;
    if (current.type === 'system') presetSel.value = current.value;
    else valInput.value = current.value;
  }
  const syncVisibility = () => {
    presetSel.hidden = typeSel.value !== 'system';
    valInput.hidden = typeSel.value === 'system' || typeSel.value === 'voice' || typeSel.value === '';
    valInput.placeholder = placeholders[typeSel.value] || '';
  };
  const emit = () => {
    const type = typeSel.value as Action['type'] | '';
    const value = type === 'system' ? presetSel.value : type === 'voice' ? 'listen' : valInput.value.trim();
    onChange(type && (value || type === 'system' || type === 'voice') ? { type, value } : null);
  };
  typeSel.onchange = () => { syncVisibility(); emit(); };
  presetSel.onchange = emit;
  valInput.onchange = emit;
  syncVisibility();
  return wrap;
}

function openEditor(zoneId: ZoneId) {
  closeEditor();
  const desk = $('#desk');
  const zone = zoneById(zoneId)!;
  const ed = document.createElement('div');
  ed.className = 'editor';
  ed.innerHTML = `
    <div class="editor-head">
      <b>${zone.label}</b>
      <button class="ghost ed-close" title="Close">✕</button>
    </div>
    <div class="editor-rows"></div>
    <p class="editor-hint">Taps in quick succession count as one pattern: two fast knocks = 2×.</p>`;
  const rows = ed.querySelector('.editor-rows')!;
  for (const n of PATTERNS) {
    const key = String(n) as '1' | '2' | '3';
    const row = document.createElement('div');
    row.className = 'editor-row';
    const label = document.createElement('span');
    label.className = 'pattern-label';
    label.textContent = `${n}×`;
    row.appendChild(label);
    row.appendChild(actionPicker(state.config.zones[zoneId].actions?.[key] || null, action => {
      const actions = { ...(state.config.zones[zoneId].actions || {}) };
      if (action) actions[key] = action; else delete actions[key];
      state.config.zones[zoneId].actions = actions;
      void window.assemble.setConfig({ zones: { ...state.config.zones, [zoneId]: { actions } } });
      updateCornerFace(zoneId);
    }));
    rows.appendChild(row);
  }
  (ed.querySelector('.ed-close') as HTMLElement).onclick = closeEditor;
  ed.onclick = e => e.stopPropagation();
  desk.appendChild(ed);
}

function closeEditor() {
  document.querySelectorAll('.editor').forEach(e => e.remove());
}

/* ================= shared bits ================= */

async function onDeviceChange(e: any) {
  state.config.deviceId = e.target.value;
  await window.assemble.setConfig({ deviceId: e.target.value });
  try { await startEngine(); } catch (err) { state.micError = (err as Error).message; setStatus(); }
}

async function populateDevices() {
  const sel = $('#device');
  if (!sel) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  sel.innerHTML = '<option value="default">Built-in / default</option>';
  for (const d of devices) {
    if (d.deviceId === 'default') continue;
    const o = document.createElement('option');
    o.value = d.deviceId; o.textContent = d.label || 'Microphone';
    sel.appendChild(o);
  }
  sel.value = state.config.deviceId || 'default';
  if (sel.selectedIndex === -1) sel.value = 'default';
}

function rippleDesk() {
  const desk = $('#desk');
  if (!desk) return;
  desk.classList.remove('ripple');
  void desk.offsetWidth; // restart animation
  desk.classList.add('ripple');
}

function litCorner(zoneId: string) {
  const el = $(`.corner[data-zone="${zoneId}"]`);
  if (!el) return;
  el.classList.add('lit');
  setTimeout(() => el.classList.remove('lit'), 450);
}

function logLine(text: string, hit = false) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.activity.unshift({ time, text, hit });
  if (state.activity.length > 100) state.activity.pop();
  const log = $('#log');
  if (!log) return;
  const li = document.createElement('li');
  li.textContent = `${time}  ${text}`;
  if (hit) li.className = 'hit';
  log.prepend(li);
  while (log.children.length > 100) log.lastChild!.remove();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(text: string) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  if (toastTimer) clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), 4200);
}
