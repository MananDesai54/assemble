import { ZONES, REJECT_LABEL, zoneById } from '../shared/zones.js';
import { fingerprint } from './audio/fingerprint.js';
import { TapClassifier } from './audio/classifier.js';
import { createEngine } from './audio/engine.js';

const $ = sel => document.querySelector(sel);
const TAPS_PER_ZONE = 10;
const NOISE_SECONDS = 10;

const state = {
  config: null,
  classifier: new TapClassifier(),
  engine: null,
  screen: 'loading',        // welcome | mic | teach | main
  teach: null,              // {stepIdx, timer, secondsLeft}
  openEditor: null,         // zone id with editor open
  micError: null,
};

const PRESET_NAMES = {
  'volume-up': 'Volume up', 'volume-down': 'Volume down', 'mute-toggle': 'Mute toggle',
  'lock-screen': 'Lock screen', 'screenshot': 'Screenshot to clipboard',
  'screenshot-region': 'Screenshot region to clipboard',
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

/* ================= engine ================= */

async function startEngine() {
  if (state.engine) state.engine.stop();
  state.engine = await createEngine({
    deviceId: state.config.deviceId,
    sensitivity: state.config.sensitivity,
    onFrame: handleFrame,
    onLevel: handleLevel,
  });
  state.micError = null;
  setStatus();
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
  const zone = zoneById(r.label);
  logLine(`${zone.label} · ${actionSummary(state.config.zones[r.label].action)} · ${(r.confidence * 100).toFixed(0)}%`, true);
  litCorner(r.label);
  window.assemble.tap(r.label, r.confidence);
}

/* ================= navigation ================= */

function goto(screen) {
  state.screen = screen;
  state.openEditor = null;
  ({ welcome: renderWelcome, mic: renderMic, teach: renderTeach, main: renderMain })[screen]();
  $('#armed-wrap').hidden = screen !== 'main';
  setStatus();
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
  $('#device').onchange = async e => {
    state.config.deviceId = e.target.value;
    await window.assemble.setConfig({ deviceId: e.target.value });
    try { await startEngine(); } catch (err) { state.micError = err.message; setStatus(); }
  };
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
  // retry controls
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
  // wipe current step's partial samples, then the previous corner's, and redo it
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
        ${ZONES.map(z => `<div class="corner" data-zone="${z.id}" tabindex="0" role="button"
            aria-label="${z.label}: ${actionSummary(state.config.zones[z.id].action)}">
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
  $('#device').onchange = async e => {
    state.config.deviceId = e.target.value;
    await window.assemble.setConfig({ deviceId: e.target.value });
    try { await startEngine(); } catch (err) { state.micError = err.message; setStatus(); }
  };
  $('#sensitivity').value = state.config.sensitivity;
  $('#sensitivity').onchange = async e => {
    state.config.sensitivity = Number(e.target.value);
    await window.assemble.setConfig({ sensitivity: state.config.sensitivity });
    await startEngine();
  };
  $('#reteach').onclick = () => goto('teach');
  if (!isTrained()) toast('Corners not taught yet — click "Teach corners" to start.');
}

function isTrained() {
  const counts = state.classifier.counts();
  return ZONES.every(z => (counts[z.id] || 0) > 0);
}

function actionSummary(action) {
  if (!action || !action.type) return 'Not set — click to assign';
  if (action.type === 'system') return PRESET_NAMES[action.value] || action.value;
  return `${TYPE_NAMES[action.type]} ${action.value}`.trim();
}

function updateCornerFace(zoneId) {
  const el = $(`#what-${zoneId}`);
  if (!el) return;
  const action = state.config.zones[zoneId].action;
  el.textContent = actionSummary(action);
  el.classList.toggle('unset', !action);
}

function openEditor(zoneId) {
  if (state.openEditor) closeEditor();
  state.openEditor = zoneId;
  const corner = $(`.corner[data-zone="${zoneId}"]`);
  const action = state.config.zones[zoneId].action;
  const ed = document.createElement('div');
  ed.className = 'editor';
  ed.innerHTML = `
    <select class="ed-type">
      <option value="">Does nothing</option>
      <option value="system">System action</option>
      <option value="shell">Run a command</option>
      <option value="keystroke">Press a shortcut</option>
      <option value="open">Open app or link</option>
    </select>
    <select class="ed-preset" hidden>
      ${Object.entries(PRESET_NAMES).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}
    </select>
    <input class="ed-value" hidden />
    <div class="row">
      <button class="secondary ed-save">Save</button>
      <button class="secondary ed-close">Close</button>
    </div>`;
  corner.appendChild(ed);
  const typeSel = ed.querySelector('.ed-type');
  const presetSel = ed.querySelector('.ed-preset');
  const valInput = ed.querySelector('.ed-value');
  const placeholders = { shell: 'say "hello"', keystroke: 'cmd+shift+4', open: 'https://… or /Applications/App.app' };
  if (action) {
    typeSel.value = action.type;
    if (action.type === 'system') presetSel.value = action.value;
    else valInput.value = action.value;
  }
  const syncVisibility = () => {
    presetSel.hidden = typeSel.value !== 'system';
    valInput.hidden = typeSel.value === 'system' || typeSel.value === '';
    valInput.placeholder = placeholders[typeSel.value] || '';
  };
  typeSel.onchange = syncVisibility;
  syncVisibility();
  ed.querySelector('.ed-save').onclick = async e => {
    e.stopPropagation();
    const type = typeSel.value;
    const value = type === 'system' ? presetSel.value : valInput.value.trim();
    const actionObj = type && (value || type === 'system') ? { type, value } : null;
    state.config.zones[zoneId].action = actionObj;
    await window.assemble.setConfig({ zones: { [zoneId]: { action: actionObj } } });
    closeEditor();
  };
  ed.querySelector('.ed-close').onclick = e => { e.stopPropagation(); closeEditor(); };
  ed.onclick = e => e.stopPropagation();
}

function closeEditor() {
  document.querySelectorAll('.editor').forEach(e => e.remove());
  const id = state.openEditor;
  state.openEditor = null;
  if (id) updateCornerFace(id);
}

/* ================= shared bits ================= */

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
