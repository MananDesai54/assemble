// Audio-reactive canvas background: drifting waveform ribbons + slow particles.
// Amplitude follows the live mic level. Theme-aware, reduced-motion aware.

export interface Bg {
  setLevel(rms: number): void;
  setBoost(on: boolean): void;
}

interface Particle { x: number; y: number; vx: number; vy: number; r: number; tw: number }

export function startBackground(canvas: HTMLCanvasElement): Bg {
  const ctx = canvas.getContext('2d')!;
  let level = 0;         // smoothed mic rms
  let target = 0;
  let boost = false;     // landing/setup screens draw stronger
  let w = 0, h = 0, dpr = 1;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let acc = '#a78bfa', acc2 = '#c084fc', dim = '#8f89ab';
  const readTheme = () => {
    const s = getComputedStyle(document.documentElement);
    acc = s.getPropertyValue('--acc').trim() || acc;
    acc2 = s.getPropertyValue('--acc-2').trim() || acc2;
    dim = s.getPropertyValue('--dim').trim() || dim;
  };
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', resize);
  resize();
  readTheme();

  const particles: Particle[] = Array.from({ length: 42 }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.1,
    r: 0.8 + Math.random() * 1.6, tw: Math.random() * Math.PI * 2,
  }));

  const RIBBONS = [
    { yFrac: 0.28, speed: 0.00045, wl: 0.9, hue: () => acc },
    { yFrac: 0.55, speed: 0.00032, wl: 1.4, hue: () => acc2 },
    { yFrac: 0.78, speed: 0.00058, wl: 0.7, hue: () => acc },
  ];

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = h * 0.55 + Math.sin(x / 140) * 24;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function frame(t: number) {
    level += (target - level) * 0.08;
    ctx.clearRect(0, 0, w, h);
    const strength = boost ? 1 : 0.45;

    // ribbons
    for (const r of RIBBONS) {
      const baseY = h * r.yFrac;
      const amp = (10 + Math.min(0.35, level) * 260) * strength;
      ctx.globalAlpha = 0.10 * strength + Math.min(0.2, level * 1.2);
      ctx.strokeStyle = r.hue();
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 5) {
        const y = baseY
          + Math.sin(x / (90 * r.wl) + t * r.speed) * amp
          + Math.sin(x / (37 * r.wl) + t * r.speed * 1.9) * amp * 0.35;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // particles
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.tw += 0.02;
      if (p.x < -5) p.x = w + 5; if (p.x > w + 5) p.x = -5;
      if (p.y < -5) p.y = h + 5; if (p.y > h + 5) p.y = -5;
      ctx.globalAlpha = (0.10 + 0.08 * Math.sin(p.tw)) * strength;
      ctx.fillStyle = dim;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  if (reduced) drawStatic();
  else requestAnimationFrame(frame);

  return {
    setLevel: rms => { target = Math.min(1, rms * 6); },
    setBoost: on => { boost = on; if (reduced) drawStatic(); },
  };
}
