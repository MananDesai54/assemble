// Integration connect UI shared by the setup wizard's Connect step and
// Settings → Integrations. Tabs per integration, brand icons from manifests.
import { useState } from 'react';
import { app, useApp, fetchIntegrations, SERVER, type IntegrationInfo } from '../store';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Input } from './ui/input';
import { Button } from './ui/button';

function IntegrationCard({ info }: { info: IntegrationInfo }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState(info.connected ? `Connected${info.detail ? ` — ${info.detail}` : ''}.` : (info.detail ?? ''));
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim()) payload[k] = v.trim();
    setStatus('Connecting…');
    setBusy(true);
    try {
      const r = await fetch(`${SERVER}/integrations/${info.id}/connect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await r.json();
      setStatus(r.ok ? `Connected${data.detail ? ` — ${data.detail}` : ''}.` : `Failed: ${data.error}`);
      if (r.ok) await fetchIntegrations();
    } catch { setStatus('Local server unreachable.'); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!confirm(`Disconnect ${info.name}? Its saved tokens are deleted.`)) return;
    try {
      await fetch(`${SERVER}/integrations/${info.id}/disconnect`, { method: 'POST' });
      await fetchIntegrations();
      setStatus('');
    } catch { setStatus('Local server unreachable.'); }
  };

  return (
    <div className="flex w-full max-w-[460px] flex-col gap-2 text-left">
      <span className="text-[12.5px] text-dim">{info.description}</span>
      {info.fields.map(f => (
        <div key={f.key} className="flex flex-col gap-2">
          {f.help && <span className="text-[12.5px] text-dim">{f.help}</span>}
          <Input
            type={f.secret ? 'password' : 'text'}
            className="font-mono text-[13px]"
            placeholder={f.saved ? `${f.label} saved — paste to replace` : f.placeholder}
            value={values[f.key] ?? ''}
            onChange={e => setValues({ ...values, [f.key]: e.target.value })}
          />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void connect()}>
          {busy ? 'Connecting…' : info.connected ? 'Reconnect' : 'Connect'}
        </Button>
        {info.connected && <Button variant="link" onClick={() => void disconnect()}>Disconnect</Button>}
        <span className="text-[12.5px] text-dim">{status}</span>
      </div>
    </div>
  );
}

export function IntegrationsCatalog() {
  useApp();
  const [active, setActive] = useState<string | null>(null);
  if (!app.integrations.length) {
    return <span className="text-[12.5px] text-dim">Local server offline — integrations unavailable.</span>;
  }
  const activeId = app.integrations.some(i => i.id === active) ? active! : app.integrations[0].id;
  const info = app.integrations.find(i => i.id === activeId)!;
  return (
    <Tabs value={activeId} onValueChange={setActive}>
      <TabsList className="mb-3.5">
        {app.integrations.map(i => (
          <TabsTrigger key={i.id} value={i.id}>
            <span className="inline-flex [&_svg]:size-3.5" dangerouslySetInnerHTML={{ __html: i.icon }} />
            <span>{i.name}</span>
            {i.connected && <span className="font-bold text-ok">✓</span>}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* keyed remount per integration so field state never bleeds across tabs */}
      <IntegrationCard key={activeId} info={info} />
    </Tabs>
  );
}
