import { motion } from 'motion/react';
import { app, emit } from '../store';
import { setMode } from '../controller';
import { Button } from '../components/ui/button';

const CHIPS = ['knock the desk', 'whistle · blow · wave', 'speak commands', 'local AI, zero cloud'];

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.2, 0.8, 0.2, 1] as const },
});

export function Landing() {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <motion.div {...rise(0)}>
          <svg viewBox="0 0 400 400" role="img" aria-label="assemble logo"
            className="block size-24 rounded-[22px] shadow-[0_0_60px_var(--glow),0_12px_40px_rgba(0,0,0,0.35)]">
            <defs>
              <linearGradient id="logo-g1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366F1" /><stop offset="100%" stopColor="#A855F7" />
              </linearGradient>
              <linearGradient id="logo-g2" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#06B6D4" /><stop offset="100%" stopColor="#3B82F6" />
              </linearGradient>
            </defs>
            <rect width="400" height="400" rx="40" fill="#0F172A" />
            <g transform="translate(100, 100)">
              <path d="M 30 190 L 80 80 L 110 80 L 60 190 Z" fill="url(#logo-g1)" />
              <path d="M 170 190 L 120 80 L 90 80 L 140 190 Z" fill="url(#logo-g2)" />
              <path d="M 100 30 L 135 90 L 65 90 Z" fill="#6366F1" />
              <polygon points="65,130 135,130 150,155 50,155" fill="url(#logo-g2)" opacity="0.9" />
            </g>
          </svg>
        </motion.div>
        <motion.div {...rise(0.05)} className="text-grad font-bold lowercase tracking-[0.24em] text-[clamp(48px,10vw,96px)] leading-none">
          assemble
        </motion.div>
        <motion.p {...rise(0.12)} className="text-lg text-dim">Your desk is the input device.</motion.p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {CHIPS.map((c, i) => (
            <motion.span key={c} {...rise(0.15 + i * 0.12)}
              className="glass rounded-full border border-line px-3.5 py-1.5 text-[13px] text-dim">
              {c}
            </motion.span>
          ))}
        </div>
        <motion.div {...rise(0.5)} className="flex flex-col items-center gap-3">
          <Button size="lg" onClick={() => { app.setupStep = 0; emit(); setMode('setup'); }}>Get started</Button>
          <Button variant="link" onClick={async () => {
            app.config.onboarded = true;
            await window.assemble.setConfig({ onboarded: true });
            setMode('app');
          }}>
            Skip — explore first
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
