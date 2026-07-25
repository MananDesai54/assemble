import { ZONES, REJECT_LABEL, zoneById } from '@assemble/core';
import type { Action, AppConfig, ZoneId } from '@assemble/core';
import { fingerprint, TapClassifier, RhythmMatcher, WhistleController, BlowDetector } from '@assemble/dsp';
import type { RhythmPattern } from '@assemble/dsp';
import { createEngine, type Engine } from './engine';
import { createCamera, type Camera } from './camera';

declare global {
  interface Window {
    assemble: {
      getConfig: () => Promise<AppConfig>;
      setConfig: (p: Partial<AppConfig>) => Promise<AppConfig>;
      setArmed: (v: boolean) => Promise<boolean>;
      tap: (label: string, confidence: number, count: number) => void;
      extra: (kind: string) => void;
      whistleStep: (dir: number) => void;
      onArmedChanged: (cb: (v: boolean) => void) => void;
    };
  }
}

// UI layer: querySelector results used freely — typed as any on purpose.
const $ = (sel: string): any => document.querySelector(sel);
const TAPS_PER_ZONE = 10;
const NOISE_SECONDS = 10;
const PATTERNS = [1, 2, 3] as const;

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
  screen: 'loading' as 'loading' | 'welcome' | 'mic' | 'teach' | 'power' | 'main',
  teach: null as TeachState | null,
  micError: null as string | null,
};

const PRESET_NAMES: Record<string, string> = {
  'volume-up': 'Volume up', 'volume-down': 'Volume down', 'mute-toggle': 'Mute toggle',
  'lock-screen': 'Lock screen', 'screenshot': 'Screenshot to clipboard',
  'screenshot-region': 'Screenshot region to clipboard', 'display-sleep': 'Sleep the display',
  'record-toggle': 'Record call (start/stop)',
};
const TYPE_NAMES: Record<string, string> = { shell: 'Run', keystroke: 'Press', open: 'Open', system: '' };

void init();

async function init() {
  state.config = await window.assemble.getConfig();
  if (state.config.classifier) state.classifier = TapClassifier.fromJSON(state.config.classifier);
  applyTheme();
  $('#theme-toggle').onclick = toggleTheme;
  $('#armed').onchange = (e: any) => window.assemble.setArmed(e.target.checked);
  $('#armed').checked = state.config.armed;
  window.assemble.onArmedChanged(v => { $('#armed').checked = v; setStatus(); });

  try {
    await startEngine();
  } catch (err) {
    state.micError = (err as Error).message;
  }
  goto(state.config.onboarded ? 'main' : 'welcome');
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
  const wanted = state.config.extras.camera.enabled && state.screen === 'main';
  if (wanted && !state.camera) {
    try {
      state.camera = await createCamera({
        onWave: side => {
          logLine(`wave ${side} · ${actionSummary(state.config.extras.camera[side].action) || 'no action'}`, true);
          window.assemble.extra(`wave-${side}`);
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
  if (state.micError) { el.dataset.state = 'error'; $('#status-text').textContent = 'microphone unavailable'; return; }
  if (!state.engine) { el.dataset.state = 'off'; $('#status-text').textContent = 'starting…'; return; }
  if (state.config.armed) { el.dataset.state = 'live'; $('#status-text').textContent = 'listening'; }
  else { el.dataset.state = 'paused'; $('#status-text').textContent = 'paused'; }
}

function handleLevel(rms: number) {
  const meter = $('.meter');
  if (!meter) return;
  const bars = meter.children;
  const lit = Math.min(bars.length, Math.round(Math.pow(rms * 18, 0.5) * bars.length));
  for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < lit);
}

function handleChunk(chunk: Float32Array) {
  if (state.screen !== 'main') return;
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
      window.assemble.extra('blow');
    }
  }
}

function handleFrame(frame: Float32Array, sampleRate: number) {
  rippleDesk();
  const vec = fingerprint(frame, sampleRate);
  if (state.screen === 'teach') { teachCollect(vec); return; }
  if (state.screen !== 'main') return;
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
  window.assemble.tap(zone, state.lastConfidence, count);
}

/* ================= navigation ================= */

function goto(screen: 'welcome' | 'mic' | 'teach' | 'power' | 'main') {
  state.screen = screen;
  ({ welcome: renderWelcome, mic: renderMic, teach: renderTeach, power: renderPower, main: renderMain })[screen]();
  $('#armed-wrap').hidden = screen !== 'main';
  setStatus();
  void syncCamera();
}

/* ================= screens ================= */

function renderWelcome() {
  $('#screen').innerHTML = `
    <div class="center-col">
      <div>
        <div class="eyebrow">welcome</div>
        <h1>Your desk is the keyboard.</h1>
      </div>
      <p class="lede">assemble listens through the microphone. Tap a corner of your desk and it runs whatever you assigned there — a shortcut, a screenshot, a command.</p>
      <div class="steps-row">
        <div class="step"><b>Tap</b><span>Knock a corner of the desk</span></div>
        <div class="step"><b>Teach</b><span>Show it each corner once</span></div>
        <div class="step"><b>Trigger</b><span>Taps run your actions</span></div>
      </div>
      <button class="primary" id="cta">Set up</button>
    </div>`;
  $('#cta').onclick = () => goto('mic');
}

function renderMic() {
  $('#screen').innerHTML = `
    <div class="center-col">
      <div>
        <div class="eyebrow">step 1 of 2 · microphone</div>
        <h1>Can it hear your desk?</h1>
      </div>
      <p class="lede" id="mic-hint">Tap the desk — the meter should jump.</p>
      <div class="meter">${'<i></i>'.repeat(16)}</div>
      <label style="align-self:center; display:flex; gap:8px; align-items:center; color:var(--dim);">
        Microphone
        <select id="device"></select>
      </label>
      <button class="primary" id="cta">It jumps — continue</button>
    </div>`;
  if (state.micError) {
    $('#mic-hint').textContent = `Microphone unavailable: ${state.micError}. Allow access in System Settings → Privacy & Security → Microphone, then relaunch.`;
    $('#cta').disabled = true;
  }
  void populateDevices();
  $('#device').onchange = onDeviceChange;
  $('#cta').onclick = () => goto('teach');
}

function renderTeach() {
  state.classifier = new TapClassifier();
  state.teach = { stepIdx: 0, secondsLeft: null, timer: null };
  $('#screen').innerHTML = `
    <div class="center-col" style="max-width: 780px;">
      <div>
        <div class="eyebrow">step 2 of 2 · teach</div>
        <h1 id="teach-title"></h1>
      </div>
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
      <button class="quiet-link" id="teach-cancel">${state.config.onboarded ? 'Cancel' : 'Skip for now'}</button>
    </div>`;
  $('#teach-cancel').onclick = cancelTeach;
  renderTeachStep();
}

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
    over.onclick = () => { if (teach.timer) clearInterval(teach.timer); renderTeach(); };
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
  const teach = state.teach!;
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
  const firstRun = !state.config.onboarded;
  state.config.classifier = state.classifier.toJSON();
  state.config.onboarded = true;
  await window.assemble.setConfig({ classifier: state.config.classifier, onboarded: true });
  goto(firstRun ? 'power' : 'main');
  if (!firstRun) toast('Ready. Click a corner to choose what it does.');
}

function cancelTeach() {
  if (state.teach?.timer) clearInterval(state.teach.timer);
  state.classifier = state.config.classifier
    ? TapClassifier.fromJSON(state.config.classifier) : new TapClassifier();
  if (!state.config.onboarded) {
    state.config.onboarded = true;
    void window.assemble.setConfig({ onboarded: true });
  }
  goto('main');
}

/* ================= main screen ================= */

function renderMain() {
  $('#screen').innerHTML = `
    <div class="desk-wrap" style="flex:1;">
      <div class="desk" id="desk">
        ${ZONES.map(z => `<div class="corner" data-zone="${z.id}" tabindex="0" role="button">
            <span class="pos">${z.label}</span>
            <span class="what" id="what-${z.id}"></span>
          </div>`).join('')}
        <div class="mic-dot" title="your microphone"></div>
      </div>
      <div class="bottom">
        <label>Microphone <select id="device"></select></label>
        <label title="Left detects softer taps">Sensitivity <input type="range" id="sensitivity" min="3" max="15" step="0.5" /></label>
        <span class="spacer"></span>
        <button class="secondary" id="setup-btn">Setup</button>
        <button class="secondary" id="reteach">${isTrained() ? 'Re-teach corners' : 'Teach corners'}</button>
      </div>
      <section class="extras">
        <h2>More triggers</h2>
        <div class="extra-row">
          <label class="switch"><input type="checkbox" id="whistle-toggle" />
            <span>Whistle slides system volume — pitch up = louder</span></label>
        </div>
        <div class="extra-row" id="blow-row">
          <span class="extra-label">Blow at the mic</span>
        </div>
        <div class="extra-row">
          <label class="switch"><input type="checkbox" id="camera-toggle" />
            <span>Hand waves via camera — processed locally, nothing recorded</span></label>
        </div>
        <div class="extra-row wave-rows" id="wave-rows" hidden>
          <div><span class="extra-label">Wave on the left</span></div>
          <div><span class="extra-label">Wave on the right</span></div>
        </div>
      </section>
      <div class="activity">
        <h2>Slack
          <button class="ghost" id="digest-btn" title="Summarize unread since last digest">Digest</button>
          <span id="slack-status" class="pane-status"></span>
        </h2>
        <pre id="digest-out" class="digest" hidden></pre>
        <ul id="slack-log"></ul>
        <div id="draft-box" class="draft-box" hidden>
          <div class="editor-head"><b id="draft-title"></b><button class="ghost" id="draft-close">✕</button></div>
          <textarea id="draft-text" rows="3"></textarea>
          <div style="display:flex; gap:8px;">
            <button class="secondary" id="draft-send">Send to Slack</button>
            <button class="secondary" id="draft-again">Redraft</button>
          </div>
        </div>
      </div>
      <div class="activity">
        <h2>Calls
          <button class="ghost" id="rec-btn">● Record</button>
          <span id="rec-status" class="pane-status"></span>
        </h2>
        <ul id="rec-list"></ul>
      </div>
      <div class="activity">
        <h2>Activity</h2>
        <ul id="log"></ul>
      </div>
    </div>`;
  for (const z of ZONES) {
    updateCornerFace(z.id);
    const el = $(`.corner[data-zone="${z.id}"]`);
    el.onclick = () => openEditor(z.id);
    el.onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(z.id); }
    };
  }
  void populateDevices();
  $('#device').onchange = onDeviceChange;
  $('#sensitivity').value = state.config.sensitivity;
  $('#sensitivity').onchange = async (e: any) => {
    state.config.sensitivity = Number(e.target.value);
    await window.assemble.setConfig({ sensitivity: state.config.sensitivity });
    await startEngine();
  };
  $('#reteach').onclick = () => goto('teach');

  // extras
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

  if (!isTrained()) toast('Corners not taught yet — click "Teach corners" to start.');
  $('#digest-btn').onclick = runDigest;
  $('#draft-close').onclick = () => { $('#draft-box').hidden = true; draftTarget = null; };
  $('#draft-send').onclick = sendDraft;
  $('#draft-again').onclick = redraft;
  $('#setup-btn').onclick = () => goto('power');
  $('#rec-btn').onclick = toggleRecording;
  connectSlackFeed();
  void refreshRecordings();
}

/* ================= calls (recording) ================= */

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
    const rows: RecordingRow[] = await (await fetch(`${SERVER}/recordings?limit=8`)).json();
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
  } catch { /* server offline — slack pane already shows it */ }
}

async function onRecordingEvent(p: { state: string }) {
  recBtnState(p.state === 'started');
  const status = $('#rec-status');
  if (status) status.textContent = p.state === 'transcribing' ? 'transcribing…' : '';
  if (p.state === 'done' || p.state === 'error' || p.state === 'stopped') void refreshRecordings();
}

/* ================= slack feed (local server) ================= */

const SERVER = 'http://127.0.0.1:4817';
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
  while (log.children.length > 20) log.lastChild!.remove();
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
  fetch(`${SERVER}/slack/recent?limit=15`)
    .then(r => r.json())
    .then((rows: SlackMsg[]) => {
      if (status) status.textContent = '';
      const log = $('#slack-log');
      if (log) log.innerHTML = '';
      for (const m of rows.reverse()) slackLine(m);
      openWs();
    })
    .catch(() => {
      if (status) status.textContent = 'server offline — bun run server';
      scheduleSlackRetry();
    });
}

function scheduleSlackRetry() {
  if (state.screen !== 'main') return;
  if (slackRetry) clearTimeout(slackRetry);
  slackRetry = setTimeout(connectSlackFeed, 30_000);
}

// One WebSocket for everything the server pushes; handlers are null-safe so
// they no-op on screens that lack the target elements.
function openWs() {
  if (slackWs && slackWs.readyState <= WebSocket.OPEN) return;
  slackWs = new WebSocket('ws://127.0.0.1:4817/ws');
  slackWs.onmessage = e => {
    const payload = JSON.parse(e.data);
    if (payload.kind === 'slack-message') slackLine(payload.message);
    if (payload.kind === 'urgent') toast(`Urgent · ${payload.message.userName ?? '?'}: ${payload.message.text.slice(0, 80)}`);
    if (payload.kind === 'slack-connected') { const s = $('#slack-status'); if (s) s.textContent = ''; }
    if (payload.kind === 'setup-progress') setupProgressLine(payload);
    if (payload.kind === 'recording') void onRecordingEvent(payload);
  };
  slackWs.onclose = () => { slackWs = null; scheduleSlackRetry(); };
}

/* ================= power-ups (in-app setup) ================= */

const SETUP_ROWS = [
  { key: 'llamaCpp', step: 'llama.cpp', label: 'AI engine — llama.cpp' },
  { key: 'whisperCpp', step: 'whisper-cpp', label: 'Speech engine — whisper.cpp' },
  { key: 'whisperModel', step: 'whisper-model', label: 'Speech model — whisper medium (1.5 GB)' },
  { key: 'audiotap', step: 'audiotap', label: 'Call capture helper' },
  { key: 'llmRunning', step: 'llm-start', label: 'Local AI on — Gemma 4 12B (7 GB, first time only)' },
] as const;

function renderPower() {
  $('#screen').innerHTML = `
    <div class="center-col" style="max-width: 640px;">
      <div>
        <div class="eyebrow">power-ups · all local, all optional</div>
        <h1>Give it a brain.</h1>
      </div>
      <p class="lede">Everything below runs on this Mac. No cloud AI, nothing leaves your machine. Skip any of it — the desk buttons already work.</p>
      <div class="setup-rows" id="setup-rows">
        ${SETUP_ROWS.map(r => `
          <div class="setup-row" data-step="${r.step}">
            <span class="state todo">○</span>
            <span>${r.label}</span>
            <span class="line" hidden></span>
          </div>`).join('')}
      </div>
      <button class="primary" id="install-all">Install everything</button>
      <div class="setup-inputs">
        <b>Slack (optional)</b>
        <span class="lede" style="font-size:13px;">api.slack.com → your app → Socket Mode on. App-level token needs <code>connections:write</code>.</span>
        <input id="slack-app-token" type="password" placeholder="xapp-… app-level token" />
        <input id="slack-bot-token" type="password" placeholder="xoxb-… bot token" />
        <button class="secondary" id="slack-connect">Connect Slack</button>
        <span id="slack-setup-status" class="lede" style="font-size:13px;"></span>
      </div>
      <p class="lede" style="font-size:12.5px;">Call recording asks for Screen Recording + Microphone permission on first use. A notification fires whenever recording starts — tell the people on the call.</p>
      <button class="secondary" id="power-done">Done</button>
    </div>`;
  void refreshSetupStatus();
  $('#install-all').onclick = installEverything;
  $('#slack-connect').onclick = connectSlackTokens;
  $('#power-done').onclick = () => goto('main');
  openWs();
}

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
    if (slackStatus) {
      slackStatus.textContent = s.slackConnected ? 'Connected.' :
        s.slackConfigured ? 'Tokens saved, not connected — check Socket Mode is enabled.' : '';
    }
    return s;
  } catch {
    const rows = $('#setup-rows');
    if (rows) rows.insertAdjacentHTML('beforebegin', '<p class="lede">Local server starting… try again in a few seconds.</p>');
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

function isTrained(): boolean {
  const counts = state.classifier.counts();
  return ZONES.every(z => (counts[z.id] || 0) > 0);
}

function actionSummary(action: Action | null | undefined): string {
  if (!action || !action.type) return '';
  if (action.type === 'system') return PRESET_NAMES[action.value] || action.value;
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

/* ================= action picker + corner editor ================= */

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
    valInput.hidden = typeSel.value === 'system' || typeSel.value === '';
    valInput.placeholder = placeholders[typeSel.value] || '';
  };
  const emit = () => {
    const type = typeSel.value as Action['type'] | '';
    const value = type === 'system' ? presetSel.value : valInput.value.trim();
    onChange(type && (value || type === 'system') ? { type, value } : null);
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
  const log = $('#log');
  if (!log) return;
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.textContent = `${time}  ${text}`;
  if (hit) li.className = 'hit';
  log.prepend(li);
  while (log.children.length > 40) log.lastChild!.remove();
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
