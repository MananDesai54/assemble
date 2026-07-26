// The onboarding wizard: Microphone → Teach → Brain → Connect → Ready.
// Every step re-checks live state, so revisiting doubles as a health pass.
import { useEffect, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { app, useApp, emit } from '../store';
import {
  startSensors, setupNext, setMode, startTeach, enterTeachStep, cancelTeach,
  redoTeachStep, previousTeachStep, teachSteps, TAPS_PER_ZONE, NOISE_SECONDS, toastAfterEnter,
} from '../controller';
import { Meter } from '../components/Meter';
import { DeviceSelect } from '../components/DeviceSelect';
import { DeskGrid } from '../components/DeskGrid';
import { ModelSelectors } from '../components/ModelSelectors';
import { SetupRows, InstallButton, allInstalled } from '../components/SetupRows';
import { IntegrationsCatalog } from '../components/IntegrationsCatalog';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

const SETUP_LABELS = ['Microphone', 'Teach', 'Brain', 'Connect', 'Ready'];

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-acc-2">{children}</div>;
}

function Footer({ next = 'Continue', skippable = true, show = true }: { next?: string; skippable?: boolean; show?: boolean }) {
  return (
    <div className="mt-1.5 flex flex-col items-center gap-2.5">
      {show && <Button onClick={setupNext}>{next}</Button>}
      {skippable && <Button variant="link" onClick={setupNext}>Skip for now</Button>}
    </div>
  );
}

function StepMic() {
  useApp();
  useEffect(() => { if (!app.engine) void startSensors(); }, []); // user clicked into setup — that's the consent
  return (
    <>
      <Eyebrow>step 1 · microphone</Eyebrow>
      <h1 className="text-3xl font-bold tracking-tight">Can it hear your desk?</h1>
      <p className="text-[15px] text-dim">
        {app.micError
          ? `Microphone unavailable: ${app.micError}. Allow access in System Settings → Privacy & Security → Microphone, then relaunch.`
          : 'Tap the desk — the meter should jump.'}
      </p>
      <Meter />
      <label className="flex items-center justify-center gap-2 text-dim">Microphone <DeviceSelect /></label>
      <Footer next="It jumps — continue" />
    </>
  );
}

function StepTeach() {
  useApp();
  useEffect(() => { startTeach(); enterTeachStep(); }, []);
  const teach = app.teach;
  if (!teach) return null;
  const steps = teachSteps();
  const step = steps[teach.stepIdx];
  const counts = app.classifier.counts();
  return (
    <>
      <Eyebrow>step 2 · teach</Eyebrow>
      {step.kind === 'zone' ? (
        <>
          <h1 className="text-3xl font-bold tracking-tight">Tap the {step.zone.label.toLowerCase()} corner</h1>
          <p className="text-[15px] text-dim">
            Knock the {step.zone.label.toLowerCase()} of your desk {TAPS_PER_ZONE} times with a knuckle.
            Directly on the desk, not the laptop. Vary the strength a little.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold tracking-tight">Now teach it what to ignore</h1>
          <p className="text-[15px] text-dim">
            For ten seconds: type, click your mouse, clap, set something down. Every sound that is NOT a desk tap.
          </p>
        </>
      )}
      <div className="flex w-full flex-col items-center gap-4.5">
        <DeskGrid
          teachZone={step.kind === 'zone' ? step.zone.id : null}
          corner={z => <span className="font-mono text-[22px] text-acc">{counts[z.id] || '·'}</span>}
        />
      </div>
      {step.kind === 'zone' ? (
        <div className="text-sm text-dim">
          <b className="font-mono text-lg font-normal text-acc">{Math.min(counts[step.zone.id] || 0, TAPS_PER_ZONE)}</b> of {TAPS_PER_ZONE}
        </div>
      ) : (
        <div className="font-mono text-[34px] text-acc">{Math.max(0, teach.secondsLeft ?? NOISE_SECONDS)}</div>
      )}
      <div className="flex justify-center gap-2.5">
        <Button variant="secondary" onClick={redoTeachStep}>{step.kind === 'zone' ? 'Redo this corner' : 'Redo this step'}</Button>
        {teach.stepIdx > 0 && (
          <>
            <Button variant="secondary" onClick={previousTeachStep}>Previous corner</Button>
            <Button variant="secondary" onClick={() => { startTeach(); enterTeachStep(); }}>Start over</Button>
          </>
        )}
      </div>
      <div className="mt-1.5"><Button variant="link" onClick={cancelTeach}>Skip for now</Button></div>
    </>
  );
}

function StepBrain() {
  useApp();
  return (
    <>
      <Eyebrow>step 3 · brain</Eyebrow>
      <h1 className="text-3xl font-bold tracking-tight">Give it a brain.</h1>
      <p className="text-[15px] text-dim">
        Everything installs and runs on this Mac — no cloud AI, nothing leaves your machine.
        Powers Slack triage, digests, drafts, call summaries, and voice commands.
      </p>
      <ModelSelectors />
      <SetupRows />
      <InstallButton />
      {/* Continue appears only once everything is installed — Skip covers opting out. */}
      <Footer show={allInstalled()} />
    </>
  );
}

function StepConnect() {
  return (
    <>
      <Eyebrow>step 4 · connect</Eyebrow>
      <h1 className="text-3xl font-bold tracking-tight">Wire in your work.</h1>
      <p className="text-[15px] text-dim">Optional — connect the services you use. Each one shows up in the sidebar once connected.</p>
      <IntegrationsCatalog />
      <Footer />
    </>
  );
}

function StepReady() {
  return (
    <>
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', duration: 0.6, bounce: 0.45 }}
        className="bg-grad grid size-[84px] place-items-center rounded-full text-[40px] text-white shadow-[0_0_0_10px_var(--acc-soft),0_0_40px_var(--glow)]"
      >
        ✓
      </motion.div>
      <h1 className="text-3xl font-bold tracking-tight">Assembled.</h1>
      <p className="text-[15px] text-dim">
        Knock a desk corner to trigger it. Hold nothing — just knuckles, whistles, and words.<br />
        Everything lives in the sidebar; every knob is in Settings.
      </p>
      <Button size="lg" onClick={async () => {
        app.config.onboarded = true;
        await window.assemble.setConfig({ onboarded: true });
        setMode('app');
        toastAfterEnter();
      }}>
        Open assemble
      </Button>
    </>
  );
}

const STEPS = [StepMic, StepTeach, StepBrain, StepConnect, StepReady];

export function Setup() {
  useApp();
  const Body = STEPS[app.setupStep];
  return (
    <div className="flex flex-1 flex-col items-center gap-7 overflow-y-auto px-6 py-10">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2.5">
        {SETUP_LABELS.map((l, i) => (
          <div key={l} className="contents">
            <div className="flex w-[76px] flex-col items-center gap-1.5">
              <i className={cn(
                'grid size-[30px] place-items-center rounded-full border-[1.5px] border-line text-[13px] not-italic text-dim transition-all',
                'glass',
                i === app.setupStep && 'border-acc text-acc shadow-[0_0_0_4px_var(--acc-soft),0_0_16px_var(--glow)]',
                i < app.setupStep && 'bg-grad border-transparent text-white',
              )}>
                {i < app.setupStep ? '✓' : i + 1}
              </i>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{l}</span>
            </div>
            {i < SETUP_LABELS.length - 1 && <div className="mb-5 h-[1.5px] w-[26px] bg-line" />}
          </div>
        ))}
      </motion.div>
      <motion.div
        key={app.setupStep}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex w-full max-w-[620px] flex-col items-center gap-5 text-center"
      >
        <Body />
      </motion.div>
    </div>
  );
}
