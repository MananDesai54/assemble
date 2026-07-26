import { useEffect, useState } from 'react';
import { app, useApp, bus, toast, SERVER } from '../store';
import { Button } from '../components/ui/button';

interface RecordingRow {
  id: number; started_at: string; ended_at: string | null;
  transcript: string | null; summary: string | null; status: string;
}

function RecordingItem({ rec }: { rec: RecordingRow }) {
  const [open, setOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const when = new Date(rec.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const label = rec.status === 'done'
    ? (rec.summary ?? rec.transcript ?? '').split('\n')[0].slice(0, 90)
    : rec.status;
  const summarize = async () => {
    setSummarizing(true);
    try {
      const r = await fetch(`${SERVER}/recordings/${rec.id}/summarize`, { method: 'POST' });
      if (!r.ok) { toast(`Summary failed: ${(await r.json()).error}`); setSummarizing(false); }
      // success re-renders via the 'done' WS event
    } catch { toast('Local server unreachable.'); setSummarizing(false); }
  };
  return (
    <li
      className={`rounded-md px-1 py-[3px] font-mono text-[12.5px] leading-relaxed text-dim hover:bg-ink/5 ${rec.status === 'done' ? 'cursor-pointer' : ''}`}
      title={rec.status === 'done' ? 'Click for transcript' : undefined}
      onClick={() => rec.status === 'done' && setOpen(!open)}
    >
      {when} · {label}
      {open && (
        <div className="whitespace-pre-wrap py-1.5 pb-2.5 text-xs" onClick={e => e.stopPropagation()}>
          {rec.summary ? `${rec.summary}\n\n— transcript —\n${rec.transcript ?? ''}` : (rec.transcript ?? '(no transcript)')}
          {!rec.summary && rec.transcript && (
            <div className="mt-2">
              <Button variant="secondary" size="sm" disabled={summarizing} onClick={() => void summarize()}>
                {summarizing ? 'Summarizing…' : 'Generate summary'}
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function CallsPage() {
  useApp();
  const [rows, setRows] = useState<RecordingRow[]>([]);

  const refresh = async () => {
    try {
      const health = await (await fetch(`${SERVER}/health`)).json();
      app.recording = Boolean(health.recording);
      setRows(await (await fetch(`${SERVER}/recordings?limit=10`)).json());
    } catch { /* server offline */ }
  };

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    bus.addEventListener('recordings-changed', onChanged);
    return () => bus.removeEventListener('recordings-changed', onChanged);
  }, []);

  const toggle = async () => {
    try {
      const r = await fetch(`${SERVER}/record/toggle`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) { toast(`Recording: ${data.error}`); return; }
      app.recording = data.state === 'recording';
      void refresh();
    } catch {
      toast('Local server unreachable.');
    }
  };

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Calls</h2>
        <p className="mt-1 text-[13.5px] text-dim">Records both sides: your mic + system audio. Everyone on the call should know.</p>
      </div>
      <div className="glass flex flex-col gap-2.5 rounded-2xl border border-line p-4">
        <div className="flex items-center gap-3">
          <Button variant={app.recording ? 'danger' : 'secondary'} onClick={() => void toggle()}>
            {app.recording ? '■ Stop' : '● Record'}
          </Button>
          <span className="text-[12.5px] text-danger">{app.recStatus}</span>
        </div>
        <ul className="flex max-h-[340px] flex-col gap-0.5 overflow-y-auto">
          {rows.map(rec => <RecordingItem key={`${rec.id}-${rec.status}-${rec.summary ? 's' : ''}`} rec={rec} />)}
        </ul>
      </div>
    </>
  );
}
