// Workflows: Claude Code sessions + the live Slack feed (when connected).
import { useEffect, useRef, useState } from 'react';
import { useApp, bus, integrationById, SERVER } from '../store';
import { Button } from '../components/ui/button';
import { Input, Textarea } from '../components/ui/input';
import { Switch } from '../components/ui/switch';

interface AgentSession {
  id: number; cwd: string; prompt: string; status: string;
  output: string | null; created_at: string;
}
interface SlackMsg {
  channelName?: string | null; channel_name?: string | null; channel: string;
  userName?: string | null; user_name?: string | null; user?: string | null;
  text: string;
}

const slackLabel = (m: SlackMsg) =>
  `#${m.channelName ?? m.channel_name ?? m.channel}  ${m.userName ?? m.user_name ?? m.user ?? '?'}: ${m.text}`;

function SessionItem({ s }: { s: AgentSession }) {
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const when = new Date(s.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const icon = s.status === 'running' ? '◌' : s.status === 'done' ? '✓' : s.status === 'stopped' ? '■' : '✗';
  const toggleOpen = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (s.status !== 'running' && output === null) {
      const full: AgentSession = await (await fetch(`${SERVER}/agent/sessions/${s.id}`)).json();
      setOutput(full.output || '(no output)');
    }
  };
  return (
    <li className="cursor-pointer rounded-md px-1 py-[3px] font-mono text-[12.5px] leading-relaxed text-dim hover:bg-ink/5" onClick={() => void toggleOpen()}>
      {when} {icon} {s.cwd.split('/').slice(-2).join('/')} · {s.prompt.slice(0, 60)}
      {open && (
        <div className="whitespace-pre-wrap py-1.5 pb-2.5 text-xs" onClick={e => e.stopPropagation()}>
          {s.status === 'running' ? (
            <span>
              running…{'  '}
              <Button variant="secondary" size="sm" onClick={() => void fetch(`${SERVER}/agent/stop`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id }),
              })}>
                Stop session
              </Button>
            </span>
          ) : (output ?? 'loading…')}
        </div>
      )}
    </li>
  );
}

export function WorkPage() {
  useApp();
  const [dirs, setDirs] = useState<string[]>([]);
  const [dir, setDir] = useState('');
  const [prompt, setPrompt] = useState('');
  const [skip, setSkip] = useState(false);
  const [status, setStatus] = useState('');
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [slackLines, setSlackLines] = useState<string[]>([]);
  const [slackStatus, setSlackStatus] = useState('');
  const dirSet = useRef(false);
  const slackOn = integrationById('slack')?.connected;

  const refresh = async () => {
    try {
      const d: string[] = await (await fetch(`${SERVER}/agent/dirs`)).json();
      setDirs(d);
      if (!dirSet.current) { setDir(d[0] ?? '~/midgard'); dirSet.current = true; }
      setSessions(await (await fetch(`${SERVER}/agent/sessions?limit=8`)).json());
    } catch { /* server offline */ }
  };

  useEffect(() => {
    void refresh();
    const onAgent = () => void refresh();
    bus.addEventListener('agent-changed', onAgent);
    return () => bus.removeEventListener('agent-changed', onAgent);
  }, []);

  useEffect(() => {
    if (!slackOn) return;
    fetch(`${SERVER}/integrations/slack/recent?limit=20`)
      .then(r => r.json())
      .then((rows: SlackMsg[]) => { setSlackStatus(''); setSlackLines(rows.map(slackLabel)); })
      .catch(() => setSlackStatus('local server offline'));
    const onMsg = (e: Event) => {
      const m = (e as CustomEvent<SlackMsg>).detail;
      setSlackLines(prev => [slackLabel(m), ...prev].slice(0, 25));
    };
    bus.addEventListener('slack-message', onMsg);
    return () => bus.removeEventListener('slack-message', onMsg);
  }, [slackOn]);

  const run = async () => {
    if (!dir.trim() || !prompt.trim()) { setStatus('directory + prompt required'); return; }
    setStatus('starting…');
    try {
      const r = await fetch(`${SERVER}/agent/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: dir.trim(), prompt: prompt.trim(), skipPermissions: skip }),
      });
      const data = await r.json();
      setStatus(r.ok ? '' : data.error);
      if (r.ok) { setPrompt(''); void refresh(); }
    } catch {
      setStatus('server offline');
    }
  };

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Workflows</h2>
        <p className="mt-1 text-[13.5px] text-dim">Claude Code sessions in any repo. Pick the directory per run — recents remembered.</p>
      </div>
      <div className="glass flex flex-col gap-2.5 rounded-2xl border border-line p-4">
        <div className="flex flex-col gap-2">
          <Input list="work-dirs" className="font-mono text-[13px]" placeholder="~/midgard/…  (working directory)"
            value={dir} onChange={e => setDir(e.target.value)} />
          <datalist id="work-dirs">{dirs.map(d => <option key={d} value={d} />)}</datalist>
          <Textarea rows={2} className="font-mono text-[13px]" placeholder="What should Claude Code do?"
            value={prompt} onChange={e => setPrompt(e.target.value)} />
          <div className="flex items-center gap-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-dim">
              <Switch checked={skip} onCheckedChange={setSkip} />
              <span>Skip permission prompts (full autonomy in that repo)</span>
            </label>
            <span className="flex-1" />
            <Button variant="secondary" onClick={() => void run()}>Run Claude Code</Button>
          </div>
          {status && <span className="text-[12.5px] text-danger">{status}</span>}
        </div>
        <ul className="flex max-h-[340px] flex-col gap-0.5 overflow-y-auto">
          {sessions.map(s => <SessionItem key={`${s.id}-${s.status}`} s={s} />)}
        </ul>
      </div>
      {slackOn && (
        <div className="glass flex flex-col gap-2.5 rounded-2xl border border-line p-4">
          <div className="flex items-center gap-3">
            <b className="text-[11px] font-bold uppercase tracking-[0.22em] text-dim">Slack</b>
            <span className="text-[12.5px] text-danger">{slackStatus}</span>
          </div>
          <ul className="flex max-h-[340px] flex-col gap-0.5 overflow-y-auto">
            {slackLines.map((l, i) => (
              <li key={`${i}-${l.slice(0, 24)}`} className="rounded-md px-1 py-[3px] font-mono text-[12.5px] leading-relaxed text-dim hover:bg-ink/5">{l}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
