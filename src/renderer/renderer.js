import { ZONES, REJECT_LABEL } from '../shared/zones.js';
import { fingerprint } from './audio/fingerprint.js';
import { TapClassifier } from './audio/classifier.js';
import { createEngine } from './audio/engine.js';

const $ = sel => document.querySelector(sel);
const state = {
  config: null,
  classifier: new TapClassifier(),
  engine: null,
  mode: 'live',              // 'live' | 'calibrating'
  wizard: null,              // {steps, stepIndex}
};

const TAPS_PER_ZONE = 10;
const AMBIENT_SECONDS = 5;

init();

async function init() {
  state.config = await window.assemble.getConfig();
  if (state.config.classifier) state.classifier = TapClassifier.fromJSON(state.config.classifier);
  renderZoneCards();
  bindControls();
  window.assemble.onArmedChanged(v => { $('#armed').checked = v; });
  $('#armed').checked = state.config.armed;
  updateCalibrationStatus();
  try {
    await restartEngine();          // this getUserMedia also unlocks device labels
    await populateDevices();
    logLine('Listening.');
  } catch (err) {
    logLine(`Microphone unavailable: ${err.message}`);
  }
}

function renderZoneCards() {
  $('#zones').innerHTML = '';
  for (const z of ZONES) {
    const card = document.createElement('div');
    card.className = 'zone-card';
    card.id = `zone-${z.id}`;
    card.style.setProperty('--zone-color', z.color);
    const action = state.config.zones[z.id].action;
    card.innerHTML = `
      <h3>${z.avenger}</h3>
      <div class="position">${z.position}</div>
      <select class="action-type">
        <option value="">No action</option>
        <option value="shell">Shell command</option>
        <option value="keystroke">Keystroke</option>
        <option value="open">Open app / URL</option>
        <option value="system">System (screenshot, volume, lock…)</option>
      </select>
      <input class="action-value" placeholder="value" />
      <select class="system-preset" hidden>
        <option value="volume-up">Volume up</option>
        <option value="volume-down">Volume down</option>
        <option value="mute-toggle">Mute toggle</option>
        <option value="lock-screen">Lock screen</option>
        <option value="screenshot">Screenshot (full screen)</option>
        <option value="screenshot-region">Screenshot (select region)</option>
      </select>`;
    const typeSel = card.querySelector('.action-type');
    const valInput = card.querySelector('.action-value');
    const presetSel = card.querySelector('.system-preset');
    if (action) {
      typeSel.value = action.type;
      if (action.type === 'system') presetSel.value = action.value;
      else valInput.value = action.value;
    }
    const placeholders = { shell: 'say "assemble"', keystroke: 'cmd+shift+4', open: 'https://… or /Applications/App.app', system: '' };
    const sync = () => {
      const type = typeSel.value;
      presetSel.hidden = type !== 'system';
      valInput.hidden = type === 'system' || type === '';
      valInput.placeholder = placeholders[type] || 'value';
      const value = type === 'system' ? presetSel.value : valInput.value;
      const actionObj = type ? { type, value } : null;
      state.config.zones[z.id].action = actionObj;
      window.assemble.setConfig({ zones: { [z.id]: { action: actionObj } } });
    };
    typeSel.onchange = sync; valInput.onchange = sync; presetSel.onchange = sync;
    presetSel.hidden = (action?.type ?? '') !== 'system';
    valInput.hidden = !action || action.type === 'system';
    $('#zones').appendChild(card);
  }
}

function bindControls() {
  $('#armed').onchange = e => window.assemble.setArmed(e.target.checked);
  $('#sensitivity').value = state.config.sensitivity;
  $('#sensitivity').onchange = async e => {
    await window.assemble.setConfig({ sensitivity: Number(e.target.value) });
    state.config.sensitivity = Number(e.target.value);
    await restartEngine();
  };
  $('#device').onchange = async e => {
    await window.assemble.setConfig({ deviceId: e.target.value });
    state.config.deviceId = e.target.value;
    await restartEngine();
  };
  $('#calibrate').onclick = startWizard;
  $('#wizard-cancel').onclick = cancelWizard;
}

async function populateDevices() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  const sel = $('#device');
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

async function restartEngine() {
  if (state.engine) state.engine.stop();
  state.engine = await createEngine({
    deviceId: state.config.deviceId,
    sensitivity: state.config.sensitivity,
    onFrame: handleFrame,
  });
}

function handleFrame(frame, sampleRate) {
  pulseReactor();
  const vec = fingerprint(frame, sampleRate);
  if (state.mode === 'calibrating') { wizardCollect(vec); return; }
  const r = state.classifier.classify(vec);
  if (r.label === REJECT_LABEL) {
    if (Number.isFinite(r.distance)) logLine(`Ultron rejected (d=${r.distance.toFixed(2)})`);
    return;
  }
  const zone = ZONES.find(z => z.id === r.label);
  logLine(`${zone.avenger.toUpperCase()}! confidence ${(r.confidence * 100).toFixed(0)}%`, true);
  flashCard(r.label);
  window.assemble.tap(r.label, r.confidence);
}

/* ---------- Training Room ---------- */

function startWizard() {
  const steps = ZONES.map(z => ({ kind: 'zone', zone: z, needed: TAPS_PER_ZONE }))
    .concat([{ kind: 'ambient' }]);
  state.wizard = { steps, stepIndex: 0 };
  state.classifier = new TapClassifier();
  state.mode = 'calibrating';
  $('#wizard').hidden = false;
  renderWizardStep();
}

function renderWizardStep() {
  const step = state.wizard.steps[state.wizard.stepIndex];
  $('#wizard-progress').innerHTML = '';
  if (step.kind === 'zone') {
    $('#wizard-title').textContent = `Summon ${step.zone.avenger}`;
    $('#wizard-instruction').textContent =
      `Tap the ${step.zone.position.toLowerCase()} area of your desk, ${step.needed} times. Vary strength a little.`;
  } else {
    $('#wizard-title').textContent = 'Trap Ultron';
    $('#wizard-instruction').textContent =
      `Now make NON-tap noise for ~${AMBIENT_SECONDS}s: type, click, set a mug down, clap once. ` +
      `Anything loud that is NOT a desk tap. Click Done when finished.`;
    const done = document.createElement('button');
    done.textContent = 'Done';
    done.onclick = finishWizard;
    $('#wizard-progress').append('0 Ultron samples captured ', done);
  }
  updateWizardProgress();
}

function wizardCollect(vec) {
  const step = state.wizard.steps[state.wizard.stepIndex];
  if (step.kind === 'zone') {
    state.classifier.addSample(step.zone.id, vec);
    const have = state.classifier.counts()[step.zone.id] || 0;
    updateWizardProgress();
    if (have >= step.needed) {
      state.wizard.stepIndex++;
      renderWizardStep();
    }
  } else {
    state.classifier.addSample(REJECT_LABEL, vec);
    updateWizardProgress();
  }
}

function updateWizardProgress() {
  const step = state.wizard.steps[state.wizard.stepIndex];
  const counts = state.classifier.counts();
  if (step.kind === 'zone') {
    $('#wizard-progress').textContent = `${counts[step.zone.id] || 0} / ${step.needed}`;
  } else {
    const n = counts[REJECT_LABEL] || 0;
    $('#wizard-progress').firstChild.textContent = `${n} Ultron samples captured `;
  }
}

async function finishWizard() {
  state.config.classifier = state.classifier.toJSON();
  await window.assemble.setConfig({ classifier: state.config.classifier });
  state.mode = 'live';
  state.wizard = null;
  $('#wizard').hidden = true;
  $('#wizard-progress').innerHTML = '';
  updateCalibrationStatus();
  logLine('Training complete. Avengers ready.');
}

function cancelWizard() {
  state.mode = 'live';
  state.wizard = null;
  $('#wizard').hidden = true;
  $('#wizard-progress').innerHTML = '';
  state.classifier = state.config.classifier
    ? TapClassifier.fromJSON(state.config.classifier) : new TapClassifier();
}

/* ---------- UI feedback ---------- */

function pulseReactor() {
  const r = $('#reactor');
  r.classList.add('pulse');
  setTimeout(() => r.classList.remove('pulse'), 120);
}

function flashCard(zoneId) {
  const card = $(`#zone-${zoneId}`);
  card.classList.add('fired');
  setTimeout(() => card.classList.remove('fired'), 400);
}

function logLine(text, hit = false) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} ${text}`;
  if (hit) li.className = 'hit';
  const log = $('#log');
  log.prepend(li);
  while (log.children.length > 50) log.lastChild.remove();
}

function updateCalibrationStatus() {
  const counts = state.classifier.counts();
  const trained = ZONES.every(z => (counts[z.id] || 0) > 0);
  $('#calibration-status').textContent = trained
    ? `Calibrated (${Object.values(counts).reduce((a, b) => a + b, 0)} samples)`
    : 'Not calibrated — enter Training Room';
}
