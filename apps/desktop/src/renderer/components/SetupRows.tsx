// Install checklist shared by the setup wizard's Brain step and Settings → Local AI.
// Live progress lines stream in over the websocket (app.setupLines).
import { useEffect, useState } from 'react';
import { app, useApp, SERVER } from '../store';
import { SETUP_ROWS, refreshSetupStatus } from '../controller';
import { Button } from './ui/button';

export function allInstalled(): boolean {
  return SETUP_ROWS.every(r => app.setupStatus[r.key]);
}

export function SetupRows() {
  useApp();
  useEffect(() => { void refreshSetupStatus(); }, []);
  return (
    <div className="flex w-full flex-col text-left">
      {SETUP_ROWS.map(r => {
        const ok = app.setupStatus[r.key];
        const line = app.setupLines[r.step];
        return (
          <div key={r.step} className="flex flex-wrap items-center gap-2.5 border-t border-line py-2.5">
            <span className={`w-5 font-mono text-[13px] ${ok ? 'text-ok' : 'text-dim'}`}>{ok ? '✓' : '○'}</span>
            <span className="text-sm">{r.label}</span>
            {line && <span className="basis-full pl-[30px] font-mono text-xs text-dim">{line}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function InstallButton() {
  useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const status = await refreshSetupStatus();
    for (const r of SETUP_ROWS) {
      if (status[r.key]) continue;
      try {
        const res = await fetch(`${SERVER}/setup/run`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: r.step }),
        });
        if (!res.ok) break; // error line already shown via WS
      } catch { break; }
    }
    await refreshSetupStatus();
    setBusy(false);
  };
  return <Button onClick={() => void run()} disabled={busy}>{busy ? 'Installing…' : 'Install everything'}</Button>;
}
