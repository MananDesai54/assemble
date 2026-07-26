import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { zoneById, type ZoneId } from '@assemble/core';
import { app, useApp, emit } from '../store';
import { actionSummary, isTrained, saveZoneActions, setMode, PATTERNS } from '../controller';
import { DeskGrid } from '../components/DeskGrid';
import { ActionPicker } from '../components/ActionPicker';
import { Button } from '../components/ui/button';
import { X } from 'lucide-react';

function cornerFace(zoneId: ZoneId): { text: string; unset: boolean } {
  const actions = app.config.zones[zoneId].actions || {};
  const parts = PATTERNS.filter(n => actions[String(n) as '1' | '2' | '3'])
    .map(n => `${n}× ${actionSummary(actions[String(n) as '1' | '2' | '3'])}`);
  return parts.length
    ? { text: parts.join('  ·  '), unset: false }
    : { text: 'Not set — click to assign', unset: true };
}

function CornerEditor({ zoneId, onClose }: { zoneId: ZoneId; onClose: () => void }) {
  const zone = zoneById(zoneId)!;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      onClick={e => e.stopPropagation()}
      className="absolute inset-[6%] z-[3] flex flex-col gap-2.5 rounded-[14px] border border-acc bg-panel p-4 shadow-[0_14px_40px_var(--shadow)]"
    >
      <div className="flex items-center justify-between">
        <b>{zone.label}</b>
        <Button variant="ghost" size="icon" title="Close" onClick={onClose}><X className="size-4" /></Button>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto">
        {PATTERNS.map(n => {
          const key = String(n) as '1' | '2' | '3';
          return (
            <div key={n} className="flex items-center gap-2.5">
              <span className="w-7 text-right font-mono text-acc">{n}×</span>
              <ActionPicker
                current={app.config.zones[zoneId].actions?.[key] || null}
                onChange={action => {
                  const actions = { ...(app.config.zones[zoneId].actions || {}) };
                  if (action) actions[key] = action; else delete actions[key];
                  void saveZoneActions(zoneId, actions);
                }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-dim">Taps in quick succession count as one pattern: two fast knocks = 2×.</p>
    </motion.div>
  );
}

export function DeskPage() {
  useApp();
  const [editing, setEditing] = useState<ZoneId | null>(null);
  const trained = isTrained();
  return (
    <>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Desk</h2>
        <p className="mt-1 text-[13.5px] text-dim">Four corners × three knock patterns. Click a corner to assign its actions.</p>
      </div>
      <div className="flex flex-col items-center gap-4.5">
        <DeskGrid
          onCornerClick={id => setEditing(id as ZoneId)}
          corner={z => {
            const face = cornerFace(z.id as ZoneId);
            return <span className={`text-[13px] ${face.unset ? 'italic text-dim' : ''}`}>{face.text}</span>;
          }}
        >
          <AnimatePresence>
            {editing && <CornerEditor zoneId={editing} onClose={() => setEditing(null)} />}
          </AnimatePresence>
        </DeskGrid>
        <div className="flex w-full max-w-[720px] items-center gap-3.5">
          <span className="text-[12.5px] text-dim">{trained ? 'Calibrated.' : 'Not taught yet — corners can’t be told apart.'}</span>
          <span className="flex-1" />
          <Button variant="secondary" onClick={() => { app.setupReturn = true; app.setupStep = 1; emit(); setMode('setup'); }}>
            {trained ? 'Re-teach corners' : 'Teach corners'}
          </Button>
        </div>
      </div>
    </>
  );
}
