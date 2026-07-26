// Quick-ask floating panel: Enter = answer inline, Cmd+Enter = open the main
// app on a fresh Talk chat seeded with the question, mic = dictate. Esc hides.
import { encodeWav16k } from '@assemble/dsp';

// The full preload API is typed in renderer.ts — this window only needs a few calls.
const assemble = (window as any).assemble as {
  quickOpenInApp: (text: string) => void;
  quickHide: () => void;
  quickResize: (h: number) => void;
};

const SERVER = 'http://127.0.0.1:4817';
const q = document.getElementById('q') as HTMLInputElement;
const answer = document.getElementById('answer')!;
const dot = document.getElementById('dot')!;
const mic = document.getElementById('mic')!;

let busy = false;

async function ask() {
  const text = q.value.trim();
  if (!text || busy) return;
  busy = true;
  dot.classList.add('busy');
  answer.classList.add('on');
  answer.textContent = '…';
  try {
    const r = await fetch(`${SERVER}/talk/quick`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const data = await r.json();
    answer.textContent = r.ok ? data.reply : (data.error || 'failed');
  } catch {
    answer.textContent = 'local server unreachable — is assemble running?';
  } finally {
    busy = false;
    dot.classList.remove('busy');
  }
}

/* ---- dictation: click mic → record, click again → transcribe into the input ---- */
const WORKLET_SRC = `
class Forwarder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('forwarder', Forwarder);
`;

let rec: { stop: () => void; sampleRate: number; chunks: Float32Array[] } | null = null;

async function startRec() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(ctx, 'forwarder');
  const chunks: Float32Array[] = [];
  node.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);
  ctx.createMediaStreamSource(stream).connect(node);
  // worklet needs a sink to run; zero-gain so nothing is audible
  const mute = ctx.createGain(); mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  rec = {
    chunks,
    sampleRate: ctx.sampleRate,
    stop: () => { stream.getTracks().forEach(t => t.stop()); void ctx.close(); },
  };
  mic.classList.add('rec');
  q.placeholder = 'listening — click mic to stop';
}

function cancelRec() {
  if (!rec) return;
  rec.stop();
  rec = null;
  mic.classList.remove('rec');
  q.placeholder = 'Ask assemble anything…';
}

async function stopRecAndTranscribe() {
  if (!rec) return;
  const { chunks, sampleRate } = rec;
  cancelRec();
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total < 4000) return; // blip — nothing worth transcribing
  const all = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  dot.classList.add('busy');
  q.placeholder = 'transcribing…';
  try {
    const r = await fetch(`${SERVER}/stt`, { method: 'POST', body: encodeWav16k(all, sampleRate) });
    const data = await r.json();
    if (r.ok) {
      q.value = q.value ? `${q.value.trim()} ${data.transcript}` : data.transcript;
    } else {
      answer.classList.add('on');
      answer.textContent = data.error || 'transcription failed';
    }
  } catch {
    answer.classList.add('on');
    answer.textContent = 'local server unreachable — is assemble running?';
  } finally {
    dot.classList.remove('busy');
    q.placeholder = 'Ask assemble anything…';
    q.focus();
  }
}

mic.addEventListener('click', () => {
  if (rec) { void stopRecAndTranscribe(); return; }
  startRec().catch(() => {
    answer.classList.add('on');
    answer.textContent = 'microphone unavailable — check permissions';
  });
});

q.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    const text = q.value.trim();
    if (text) assemble.quickOpenInApp(text);
    q.value = '';
    answer.classList.remove('on');
  } else if (e.key === 'Enter') {
    void ask();
  } else if (e.key === 'Escape') {
    if (rec) { cancelRec(); return; } // first esc stops the mic, second hides
    q.value = '';
    answer.classList.remove('on');
    assemble.quickHide();
  }
});

// fresh panel every time it's summoned
window.addEventListener('focus', () => q.focus());
// panel hidden while recording (blur) — don't leave the mic running unseen
window.addEventListener('blur', cancelRec);

// window hugs the panel — no transparent dead zone below (its shadow drew a ghost border)
const panel = document.querySelector('.panel') as HTMLElement;
new ResizeObserver(() => assemble.quickResize(panel.offsetHeight + 16)).observe(panel);

export {};
