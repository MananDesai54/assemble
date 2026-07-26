import { AnimatePresence, motion } from 'motion/react';
import { app, emit, useApp, toast } from '../store';
import { startSensors } from '../controller';
import { Button } from './ui/button';

export function ConsentDialog() {
  useApp();
  const wantsCamera = app.config?.extras.camera.enabled;
  const close = () => { app.consentOpen = false; emit(); };
  return (
    <AnimatePresence>
      {app.consentOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 grid place-items-center bg-bg/55 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', duration: 0.45, bounce: 0.3 }}
            className="flex max-w-[420px] flex-col gap-3.5 rounded-2xl border border-line bg-panel p-7 text-center shadow-[0_18px_50px_var(--shadow)]"
          >
            <h3 className="text-xl font-bold tracking-tight">Start listening?</h3>
            <p className="text-[12.5px] text-dim">
              assemble needs the <b>microphone</b> to hear desk taps, whistles, and voice commands.
              {wantsCamera && <><br />The <b>camera</b> will also start — hand-wave gestures are enabled.</>}
              <br />Nothing is recorded or sent anywhere.
            </p>
            <div className="flex flex-col items-center gap-2.5">
              <Button onClick={async () => { close(); await startSensors(); }}>
                Start{wantsCamera ? ' mic + camera' : ' microphone'}
              </Button>
              <Button variant="link" onClick={async () => {
                close();
                await window.assemble.setArmed(false); // revert the switch — consent declined
                toast('Listening stays off.');
              }}>
                Not now
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
