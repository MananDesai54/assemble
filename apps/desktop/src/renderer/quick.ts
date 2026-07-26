// Quick-ask floating panel: Enter = answer inline, Cmd+Enter = open the main
// app on a fresh Talk chat seeded with the question. Esc hides.

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

q.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    const text = q.value.trim();
    if (text) assemble.quickOpenInApp(text);
    q.value = '';
    answer.classList.remove('on');
  } else if (e.key === 'Enter') {
    void ask();
  } else if (e.key === 'Escape') {
    q.value = '';
    answer.classList.remove('on');
    assemble.quickHide();
  }
});

// fresh panel every time it's summoned
window.addEventListener('focus', () => q.focus());

// window hugs the panel — no transparent dead zone below (its shadow drew a ghost border)
const panel = document.querySelector('.panel') as HTMLElement;
new ResizeObserver(() => assemble.quickResize(panel.offsetHeight + 16)).observe(panel);

export {};
