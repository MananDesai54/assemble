import { AnimatePresence, motion } from 'motion/react';
import { app, useApp } from '../store';

export function Toast() {
  useApp();
  return (
    <AnimatePresence>
      {app.toast && (
        <motion.div
          key={app.toast.key}
          initial={{ opacity: 0, y: 12, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 8, x: '-50%' }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
          className="glass fixed bottom-[22px] left-1/2 z-50 rounded-xl border border-line px-4.5 py-2.5 text-[13.5px] text-ink shadow-[0_8px_24px_var(--shadow)]"
        >
          {app.toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
