import { app, useApp } from '../store';

export function ActivityPage() {
  useApp();
  return (
    <>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Activity</h2>
        <p className="mt-1 text-[13.5px] text-dim">Every gesture, voice command, and rejection — most recent first.</p>
      </div>
      <div className="glass rounded-2xl border border-line p-4">
        <ul className="flex max-h-[420px] flex-col gap-0.5 overflow-y-auto">
          {app.activity.map((a, i) => (
            <li key={`${a.time}-${i}`} className={`rounded-md px-1 py-[3px] font-mono text-[12.5px] leading-relaxed hover:bg-ink/5 ${a.hit ? 'text-ink' : 'text-dim'}`}>
              {a.time}  {a.text}
            </li>
          ))}
          {!app.activity.length && <li className="px-1 py-[3px] text-[12.5px] text-dim">Nothing yet — knock the desk.</li>}
        </ul>
      </div>
    </>
  );
}
