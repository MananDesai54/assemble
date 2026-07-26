// Scene-based ambient canvas. One engine, one scene per feature:
//   aurora — landing / setup / talk (voice = light in motion)
//   sonar  — desk gestures (taps ripple outward)
//   ridge  — recordings (sound as terrain)
//   flow   — workflows (data streaming through lanes)
//   drift  — activity / settings (quiet dust)
// Audio-reactive via setLevel. Theme-aware, reduced-motion aware.

export type Scene = 'aurora' | 'sonar' | 'ridge' | 'flow' | 'drift';

export interface Bg {
  setLevel(rms: number): void;
  setBoost(on: boolean): void;
  setScene(s: Scene): void;
}

interface Mote { x: number; y: number; vx: number; vy: number; r: number; tw: number; hue: number }

export function startBackground(canvas: HTMLCanvasElement): Bg {
  const ctx = canvas.getContext('2d')!;
  let level = 0;
  let target = 0;
  let boost = false;
  let scene: Scene = 'aurora';
  let fade = 0; // 0→1 after each scene switch
  let w = 0, h = 0, dpr = 1;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let acc = '#8b9aff', acc2 = '#4fd8e8', ok = '#45d69a', dim = '#8891b8';
  let dark = true;
  const readTheme = () => {
    const s = getComputedStyle(document.documentElement);
    acc = s.getPropertyValue('--acc').trim() || acc;
    acc2 = s.getPropertyValue('--acc2').trim() || acc2;
    ok = s.getPropertyValue('--ok').trim() || ok;
    dim = s.getPropertyValue('--dim').trim() || dim;
    dark = document.documentElement.dataset.theme !== 'light';
    if (reduced) drawStatic();
  };
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduced) drawStatic();
  };
  window.addEventListener('resize', resize);
  resize();
  readTheme();

  const motes: Mote[] = Array.from({ length: 90 }, (_, i) => ({
    x: Math.random() * 1600, y: Math.random() * 1000,
    vx: 0.2 + Math.random() * 0.6, vy: -(0.05 + Math.random() * 0.18),
    r: 0.7 + Math.random() * 1.8, tw: Math.random() * Math.PI * 2,
    hue: i % 3,
  }));
  const pick = (m: Mote) => (m.hue === 0 ? acc : m.hue === 1 ? acc2 : dim);

  /* ---- aurora: huge soft blobs orbiting slowly ---- */
  const BLOBS = [
    { cx: 0.22, cy: 0.28, r: 0.55, sp: 0.000041, ph: 0.0, c: () => acc },
    { cx: 0.80, cy: 0.22, r: 0.48, sp: 0.000053, ph: 2.1, c: () => acc2 },
    { cx: 0.55, cy: 0.85, r: 0.60, sp: 0.000034, ph: 4.2, c: () => acc },
    { cx: 0.12, cy: 0.85, r: 0.42, sp: 0.000047, ph: 1.1, c: () => ok },
  ];
  function drawAurora(t: number, a: number) {
    const strength = (boost ? 1 : 0.55) * a;
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    for (const b of BLOBS) {
      const x = w * b.cx + Math.sin(t * b.sp + b.ph) * w * 0.10;
      const y = h * b.cy + Math.cos(t * b.sp * 1.3 + b.ph) * h * 0.12;
      const r = Math.max(w, h) * b.r * (1 + level * 0.25);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const alpha = (dark ? 0.07 : 0.05) * strength + level * 0.05;
      g.addColorStop(0, b.c());
      g.addColorStop(1, 'transparent');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    // faint drifting dust on top
    for (let i = 0; i < 40; i++) {
      const m = motes[i];
      m.tw += 0.015;
      ctx.globalAlpha = (0.06 + 0.05 * Math.sin(m.tw)) * strength;
      ctx.fillStyle = pick(m);
      ctx.beginPath();
      ctx.arc((m.x + t * 0.004 * m.vx) % (w + 10), (m.y * h) / 1000 % h, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- sonar: rings expanding from center over a dot grid ---- */
  function drawSonar(t: number, a: number) {
    const cx = w / 2, cy = h / 2;
    const gap = 46;
    ctx.fillStyle = dim;
    for (let x = gap / 2; x < w; x += gap) {
      for (let y = gap / 2; y < h; y += gap) {
        const d = Math.hypot(x - cx, y - cy);
        const pulse = Math.sin(d * 0.02 - t * 0.0016);
        ctx.globalAlpha = (0.035 + Math.max(0, pulse) * 0.05 * (0.4 + level * 2)) * a;
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // three staggered rings, forever expanding
    const period = 3400;
    for (let k = 0; k < 3; k++) {
      const p = ((t + k * (period / 3)) % period) / period;
      const r = p * Math.max(w, h) * 0.75;
      ctx.globalAlpha = (1 - p) * 0.14 * a * (0.6 + level * 2);
      ctx.strokeStyle = k === 1 ? acc2 : acc;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- ridge: layered sound-terrain along the bottom ---- */
  function drawRidge(t: number, a: number) {
    const layers = [
      { y: 0.68, amp: 26, sp: 0.00006, wl: 260, c: () => acc, al: 0.05 },
      { y: 0.78, amp: 34, sp: 0.00010, wl: 180, c: () => acc2, al: 0.06 },
      { y: 0.88, amp: 44, sp: 0.00015, wl: 120, c: () => acc, al: 0.08 },
    ];
    for (const L of layers) {
      const baseY = h * L.y;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const y = baseY
          + Math.sin((x + t * L.sp * 1000) / L.wl) * L.amp * (1 + level * 1.5)
          + Math.sin((x * 2.7 + t * L.sp * 1600) / L.wl) * L.amp * 0.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, h * L.y - 60, 0, h);
      g.addColorStop(0, L.c());
      g.addColorStop(1, 'transparent');
      ctx.globalAlpha = L.al * a;
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- flow: particles streaming through sine lanes ---- */
  function drawFlow(t: number, a: number) {
    for (const m of motes) {
      m.x += m.vx * 2.2;
      if (m.x > w + 20) { m.x = -20; m.y = Math.random() * 1000; }
      const lane = h * (0.15 + (m.y / 1000) * 0.7);
      const y = lane + Math.sin(m.x * 0.006 + m.y) * 26;
      const py = lane + Math.sin((m.x - 14) * 0.006 + m.y) * 26;
      ctx.globalAlpha = (0.10 + 0.10 * Math.sin(m.tw += 0.02)) * a;
      ctx.strokeStyle = pick(m);
      ctx.lineWidth = m.r;
      ctx.beginPath();
      ctx.moveTo(m.x - 14, py);
      ctx.lineTo(m.x, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- drift: sparse dust rising ---- */
  function drawDrift(t: number, a: number) {
    for (let i = 0; i < 55; i++) {
      const m = motes[i];
      m.y += m.vy * 4;
      if (m.y < -10) { m.y = 1010; m.x = Math.random() * 1600; }
      m.tw += 0.012;
      ctx.globalAlpha = (0.07 + 0.06 * Math.sin(m.tw)) * a;
      ctx.fillStyle = pick(m);
      ctx.beginPath();
      ctx.arc((m.x / 1600) * w, (m.y / 1000) * h, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const DRAW: Record<Scene, (t: number, a: number) => void> = {
    aurora: drawAurora, sonar: drawSonar, ridge: drawRidge, flow: drawFlow, drift: drawDrift,
  };

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    DRAW[scene](1200, 1);
  }

  function frame(t: number) {
    level += (target - level) * 0.08;
    if (fade < 1) fade = Math.min(1, fade + 0.03);
    ctx.clearRect(0, 0, w, h);
    DRAW[scene](t, fade);
    requestAnimationFrame(frame);
  }

  if (reduced) drawStatic();
  else requestAnimationFrame(frame);

  return {
    setLevel: rms => { target = Math.min(1, rms * 6); },
    setBoost: on => { boost = on; if (reduced) drawStatic(); },
    setScene: s => {
      if (s === scene) return;
      scene = s; fade = 0;
      if (reduced) drawStatic();
    },
  };
}
