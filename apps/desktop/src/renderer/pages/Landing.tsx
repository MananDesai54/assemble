import { motion } from 'motion/react';
import { app, emit } from '../store';
import { setMode } from '../controller';
import { Button } from '../components/ui/button';
import { LogoMark } from '../components/Logo';

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
          <LogoMark className="size-24 rounded-[22px] shadow-[0_0_60px_var(--glow),0_12px_40px_rgba(0,0,0,0.35)]" />
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
