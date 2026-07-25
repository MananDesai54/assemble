import { ZONES, REJECT_LABEL, zoneById } from '../shared/zones.js';
import { fingerprint } from './audio/fingerprint.js';
import { TapClassifier } from './audio/classifier.js';
import { createEngine } from './audio/engine.js';
import { RhythmMatcher } from './audio/rhythm.js';
import { WhistleController } from './audio/whistle.js';
import { BlowDetector } from './audio/blow.js';
import { createCamera } from './audio/camera.js';

const $ = sel => document.querySelector(sel);
const TAPS_PER_ZONE = 10;
const NOISE_SECONDS = 10;
const PATTERNS = [1, 2, 3];

const state = {
  config: null,
  classifier: new TapClassifier(),
  engine: null,
  camera: null,
  whistle: null,
  blow: null,
  rhythm: new RhythmMatcher(),
  rhythmTimer: null,
  lastConfidence: 1,
  screen: 'loading',        // welcome | mic | teach | main
  teach: null,              // {stepIdx, timer, secondsLeft}
  micError: null,
};

const PRESET_NAMES = {
  'volume-up': 'Volume up', 'volume-down': 'Volume down', 'mute-toggle': 'Mute toggle',
  'lock-screen': 'Lock screen', 'screenshot': 'Screenshot to clipboard',
  'screenshot-region': 'Screenshot region to clipboard', 'display-sleep': 'Sleep the display',
};
const TYPE_NAMES = { shell: 'Run', keystroke: 'Press', open: 'Open', system: '' };

init();

async function init() {
  state.config = await window.assemble.getConfig();
  if (state.config.classifier) state.classifier = TapClassifier.fromJSON(state.config.classifier);
  applyTheme();
  $('#theme-toggle').onclick = toggleTheme;
  $('#armed').onchange = e => window.assemble.setArmed(e.target.checked);
  $('#armed').checked = state.config.armed;
  window.assemble.onArmedChanged(v => { $('#armed').checked = v; setStatus(); });

  try {
    await startEngine();
  } catch (err) {
    state.micError = err.message;
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
  window.assemble.setConfig({ theme: state.config.theme });
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
      window.assemble.setConfig({ extras: { camera: { enabled: false } } });
      const toggle = $('#camera-toggle');
      if (toggle) toggle.checked = false;
      logLine(`camera unavailable: ${err.message}`);
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

function handleLevel(rms) {
  const meter = $('.meter');
  if (!meter) return;
  const bars = meter.children;
  const lit = Math.min(bars.length, Math.round(Math.pow(rms * 18, 0.5) * bars.length));
  for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < lit);
}

function handleChunk(chunk) {
  if (state.screen !== 'main') return;
  const now = performance.now();
  if (state.config.extras.whistleVolume) {
    for (const ev of state.whistle.push(chunk, now)) {
      logLine(`whistle ${ev.dir > 0 ? 'up · volume up' : 'down · volume down'}`, true);
      window.assemble.whistleStep(ev.dir);
    }
  }
  if (state.config.extras.blow.action) {
    if (state.blow.push(chunk, now)) {
      logLine(`blow · ${actionSummary(state.config.extras.blow.action)}`, true);
      window.assemble.extra('blow');
    }
  }
}

function handleFrame(frame, sampleRate) {
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
  clearTimeout(state.rhythmTimer);
  state.rhythmTimer = setTimeout(() => {
    const d = state.rhythm.flush(performance.now());
    if (d) firePattern(d);
  }, 650);
}

function firePattern({ zone, count }) {
  const z = zoneById(zone);
  const action = state.config.zones[zone].actions?.[String(count)];
  const prefix = count > 1 ? `${count}× ` : '';
  logLine(
    `${prefix}${z.label} · ${action ? actionSummary(action) : 'no action for this pattern'} · ${(state.lastConfidence * 100).toFixed(0)}%`,
    !!action,
  );
  window.assemble.tap(zone, state.lastConfidence, count);
}

/* ================= navigation ================= */

function goto(screen) {
  state.screen = screen;
  ({ welcome: renderWelcome, mic: renderMic, teach: renderTeach, main: renderMain })[screen]();
  $('#armed-wrap').hidden = screen !== 'main';
  setStatus();
  syncCamera();
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
  populateDevices();
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

function teachSteps() {
  return ZONES.map(z => ({ kind: 'zone', zone: z })).concat([{ kind: 'noise' }]);
}

function renderTeachStep() {
  const step = teachSteps()[state.teach.stepIdx];
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
    state.teach.secondsLeft = NOISE_SECONDS;
    $('#teach-progress').innerHTML = `<span class="countdown" id="countdown">${NOISE_SECONDS}</span>`;
    state.teach.timer = setInterval(() => {
      state.teach.secondsLeft--;
      const el = $('#countdown');
      if (el) el.textContent = Math.max(0, state.teach.secondsLeft);
      if (state.teach.secondsLeft <= 0) finishTeach();
    }, 1000);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:10px; justify-content:center;';
  const redo = document.createElement('button');
  redo.className = 'secondary';
  redo.textContent = step.kind === 'zone' ? 'Redo this corner' : 'Redo this step';
  redo.onclick = () => redoStep();
  row.appendChild(redo);
  if (state.teach.stepIdx > 0) {
    const back = document.createElement('button');
    back.className = 'secondary';
    back.textContent = 'Previous corner';
    back.onclick = () => previousStep();
    row.appendChild(back);
    const over = document.createElement('button');
    over.className = 'secondary';
    over.textContent = 'Start over';
    over.onclick = () => { clearInterval(state.teach.timer); renderTeach(); };
    row.appendChild(over);
  }
  extra.appendChild(row);
}

function redoStep() {
  const step = teachSteps()[state.teach.stepIdx];
  clearInterval(state.teach.timer);
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
  clearInterval(state.teach.timer);
  const steps = teachSteps();
  const cur = steps[state.teach.stepIdx];
  state.classifier.clear(cur.kind === 'zone' ? cur.zone.id : REJECT_LABEL);
  state.teach.stepIdx--;
  const prev = steps[state.teach.stepIdx];
  state.classifier.clear(prev.zone.id);
  const countEl = $(`#count-${prev.zone.id}`);
  if (countEl) countEl.textContent = '·';
  renderTeachStep();
}

function teachCollect(vec) {
  const step = teachSteps()[state.teach.stepIdx];
  if (step.kind === 'zone') {
    state.classifier.addSample(step.zone.id, vec);
    const have = state.classifier.counts()[step.zone.id] || 0;
    const countEl = $(`#count-${step.zone.id}`);
    if (countEl) countEl.textContent = have;
    $('#teach-progress').innerHTML = `<b>${Math.min(have, TAPS_PER_ZONE)}</b> of ${TAPS_PER_ZONE}`;
    if (have >= TAPS_PER_ZONE) {
      state.teach.stepIdx++;
      renderTeachStep();
    }
  } else {
    state.classifier.addSample(REJECT_LABEL, vec);
  }
}

async function finishTeach() {
  clearInterval(state.teach.timer);
  state.config.classifier = state.classifier.toJSON();
  state.config.onboarded = true;
  await window.assemble.setConfig({ classifier: state.config.classifier, onboarded: true });
  goto('main');
  toast('Ready. Click a corner to choose what it does.');
}

function cancelTeach() {
  clearInterval(state.teach?.timer);
  state.classifier = state.config.classifier
    ? TapClassifier.fromJSON(state.config.classifier) : new TapClassifier();
  if (!state.config.onboarded) {
    state.config.onboarded = true;
    window.assemble.setConfig({ onboarded: true });
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
        <h2>Activity</h2>
        <ul id="log"></ul>
      </div>
    </div>`;
  for (const z of ZONES) {
    updateCornerFace(z.id);
    const el = $(`.corner[data-zone="${z.id}"]`);
    el.onclick = () => openEditor(z.id);
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(z.id); } };
  }
  populateDevices();
  $('#device').onchange = onDeviceChange;
  $('#sensitivity').value = state.config.sensitivity;
  $('#sensitivity').onchange = async e => {
    state.config.sensitivity = Number(e.target.value);
    await window.assemble.setConfig({ sensitivity: state.config.sensitivity });
    await startEngine();
  };
  $('#reteach').onclick = () => goto('teach');

  // extras
  $('#whistle-toggle').checked = state.config.extras.whistleVolume;
  $('#whistle-toggle').onchange = e => {
    state.config.extras.whistleVolume = e.target.checked;
    window.assemble.setConfig({ extras: { whistleVolume: e.target.checked } });
  };
  $('#blow-row').appendChild(actionPicker(state.config.extras.blow.action, action => {
    state.config.extras.blow.action = action;
    window.assemble.setConfig({ extras: { blow: { action } } });
  }));
  $('#camera-toggle').checked = state.config.extras.camera.enabled;
  $('#wave-rows').hidden = !state.config.extras.camera.enabled;
  $('#camera-toggle').onchange = e => {
    state.config.extras.camera.enabled = e.target.checked;
    $('#wave-rows').hidden = !e.target.checked;
    window.assemble.setConfig({ extras: { camera: { enabled: e.target.checked } } });
    syncCamera();
  };
  const [leftRow, rightRow] = $('#wave-rows').children;
  leftRow.appendChild(actionPicker(state.config.extras.camera.left.action, action => {
    state.config.extras.camera.left = { action };
    window.assemble.setConfig({ extras: { camera: { left: { action } } } });
  }));
  rightRow.appendChild(actionPicker(state.config.extras.camera.right.action, action => {
    state.config.extras.camera.right = { action };
    window.assemble.setConfig({ extras: { camera: { right: { action } } } });
  }));

  if (!isTrained()) toast('Corners not taught yet — click "Teach corners" to start.');
}

function isTrained() {
  const counts = state.classifier.counts();
  return ZONES.every(z => (counts[z.id] || 0) > 0);
}

function actionSummary(action) {
  if (!action || !action.type) return '';
  if (action.type === 'system') return PRESET_NAMES[action.value] || action.value;
  return `${TYPE_NAMES[action.type]} ${action.value}`.trim();
}

function updateCornerFace(zoneId) {
  const el = $(`#what-${zoneId}`);
  if (!el) return;
  const actions = state.config.zones[zoneId].actions || {};
  const parts = PATTERNS.filter(n => actions[String(n)])
    .map(n => `${n}× ${actionSummary(actions[String(n)])}`);
  el.textContent = parts.length ? parts.join('  ·  ') : 'Not set — click to assign';
  el.classList.toggle('unset', !parts.length);
}

/* ================= action picker + corner editor ================= */

// Small self-saving control: [type ▾] [preset ▾ | value input]
function actionPicker(current, onChange) {
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
  const typeSel = wrap.querySelector('.pk-type');
  const presetSel = wrap.querySelector('.pk-preset');
  const valInput = wrap.querySelector('.pk-value');
  const placeholders = { shell: 'say "hello"', keystroke: 'cmd+shift+4', open: 'https://… or /Applications/App.app' };
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
    const type = typeSel.value;
    const value = type === 'system' ? presetSel.value : valInput.value.trim();
    onChange(type && (value || type === 'system') ? { type, value } : null);
  };
  typeSel.onchange = () => { syncVisibility(); emit(); };
  presetSel.onchange = emit;
  valInput.onchange = emit;
  syncVisibility();
  return wrap;
}

function openEditor(zoneId) {
  closeEditor();
  const desk = $('#desk');
  const zone = zoneById(zoneId);
  const ed = document.createElement('div');
  ed.className = 'editor';
  ed.innerHTML = `
    <div class="editor-head">
      <b>${zone.label}</b>
      <button class="ghost ed-close" title="Close">✕</button>
    </div>
    <div class="editor-rows"></div>
    <p class="editor-hint">Taps in quick succession count as one pattern: two fast knocks = 2×.</p>`;
  const rows = ed.querySelector('.editor-rows');
  for (const n of PATTERNS) {
    const row = document.createElement('div');
    row.className = 'editor-row';
    const label = document.createElement('span');
    label.className = 'pattern-label';
    label.textContent = `${n}×`;
    row.appendChild(label);
    row.appendChild(actionPicker(state.config.zones[zoneId].actions?.[String(n)] || null, action => {
      const actions = { ...(state.config.zones[zoneId].actions || {}) };
      if (action) actions[String(n)] = action; else delete actions[String(n)];
      state.config.zones[zoneId].actions = actions;
      window.assemble.setConfig({ zones: { [zoneId]: { actions } } });
      updateCornerFace(zoneId);
    }));
    rows.appendChild(row);
  }
  ed.querySelector('.ed-close').onclick = closeEditor;
  ed.onclick = e => e.stopPropagation();
  desk.appendChild(ed);
}

function closeEditor() {
  document.querySelectorAll('.editor').forEach(e => e.remove());
}

/* ================= shared bits ================= */

async function onDeviceChange(e) {
  state.config.deviceId = e.target.value;
  await window.assemble.setConfig({ deviceId: e.target.value });
  try { await startEngine(); } catch (err) { state.micError = err.message; setStatus(); }
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

function litCorner(zoneId) {
  const el = $(`.corner[data-zone="${zoneId}"]`);
  if (!el) return;
  el.classList.add('lit');
  setTimeout(() => el.classList.remove('lit'), 450);
}

function logLine(text, hit = false) {
  const log = $('#log');
  if (!log) return;
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.textContent = `${time}  ${text}`;
  if (hit) li.className = 'hit';
  log.prepend(li);
  while (log.children.length > 40) log.lastChild.remove();
}

let toastTimer = null;
function toast(text) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), 4200);
}
