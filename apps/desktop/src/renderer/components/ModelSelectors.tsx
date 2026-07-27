// Brain source card (Local model picker ⟷ BYOK key fields) + speech model picker.
// Mirrors the server's /setup/models contract.
import { useEffect, useState } from 'react';
import { SERVER, toast } from '../store';
import { refreshSetupStatus } from '../controller';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface ModelOption {
  id: string; label: string; size: string; notes: string;
  speed?: string; quality?: string; ram?: string; strengths?: string;
}
interface ModelsData {
  whisper: { options: ModelOption[]; selected: string };
  sttLanguage: string;
  llm: { options: ModelOption[]; selected: string };
  byok: { source: 'local' | 'byok'; url: string; model: string; hasKey: boolean };
}

function ModelBlock({ title, hint, options, selected, onSelect }: {
  title: string; hint: string; options: ModelOption[]; selected: string;
  onSelect: (id: string) => void;
}) {
  const o = options.find(x => x.id === selected) ?? options[0];
  return (
    <div className="glass flex flex-col gap-2 rounded-xl border border-line p-3.5">
      <div className="flex flex-col gap-0.5">
        <b className="text-sm">{title}</b>
        <span className="text-[12.5px] text-dim">{hint}</span>
      </div>
      <Select value={selected} onValueChange={onSelect}>
        <SelectTrigger className="max-w-[420px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(x => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {o && (
        <div className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-[12.5px] text-dim">
          <span><b className="mr-1 font-semibold text-ink">Download</b>{o.size}</span>
          {o.ram && <span><b className="mr-1 font-semibold text-ink">RAM</b>{o.ram}</span>}
          {o.speed && <span><b className="mr-1 font-semibold text-ink">Speed</b>{o.speed}</span>}
          {o.quality && <span><b className="mr-1 font-semibold text-ink">Quality</b>{o.quality}</span>}
          {o.strengths && <span><b className="mr-1 font-semibold text-ink">Strengths</b>{o.strengths}</span>}
          <span className="basis-full">{o.notes}</span>
        </div>
      )}
    </div>
  );
}

export function ModelSelectors() {
  const [data, setData] = useState<ModelsData | null>(null);
  const [byokStatus, setByokStatus] = useState('');
  const [key, setKey] = useState('');

  useEffect(() => {
    fetch(`${SERVER}/setup/models`).then(r => r.json()).then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;

  const pickModel = async (kind: 'whisper' | 'llm', id: string) => {
    setData({ ...data, [kind]: { ...data[kind], selected: id } });
    await fetch(`${SERVER}/setup/models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [kind]: id }),
    });
    void refreshSetupStatus(); // selected model file may not be downloaded yet
    const label = data[kind].options.find(o => o.id === id)?.label ?? id;
    toast(`${kind === 'llm' ? 'Brain model' : 'Speech model'} → ${label}. Run "Install everything" if it needs a download.`);
  };

  const setSttLanguage = async (lang: string) => {
    setData({ ...data, sttLanguage: lang });
    await fetch(`${SERVER}/setup/models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sttLanguage: lang }),
    });
    toast(lang === 'auto' ? 'Speech language: auto-detect.' : `Speech language pinned — applies to new recordings.`);
  };

  const setSource = async (source: 'local' | 'byok') => {
    setData({ ...data, byok: { ...data.byok, source } });
    await fetch(`${SERVER}/setup/byok`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    if (source === 'local') toast('Brain: local — private.');
  };

  const saveByok = async () => {
    setByokStatus('Testing…');
    try {
      const r = await fetch(`${SERVER}/setup/byok`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'byok',
          url: data.byok.url.trim(),
          key: key.trim() || undefined,
          model: data.byok.model.trim(),
        }),
      });
      const res = await r.json();
      setByokStatus(res.ok ? `Connected — replied "${res.sample}".` : `Failed: ${res.error}`);
    } catch {
      setByokStatus('Local server unreachable.');
    }
  };

  return (
    <div className="flex w-full flex-col gap-3.5 text-left">
      <div className="glass flex flex-col gap-2.5 rounded-xl border border-line p-3.5">
        <div className="flex flex-col gap-0.5">
          <b className="text-sm">Brain source</b>
          <span className="text-[12.5px] text-dim">Where AI thinking happens.</span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-dim">
          <input type="radio" name="brain-src" className="accent-[var(--acc)]" checked={data.byok.source === 'local'} onChange={() => void setSource('local')} />
          <span><b className="text-ink">Local</b> — runs on this Mac, nothing leaves your machine (recommended)</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-dim">
          <input type="radio" name="brain-src" className="accent-[var(--acc)]" checked={data.byok.source === 'byok'} onChange={() => void setSource('byok')} />
          <span><b className="text-ink">Your API key</b> — any OpenAI-compatible provider (OpenAI, OpenRouter, Groq, Gemini…)</span>
        </label>
        {data.byok.source === 'local' && (
          <ModelBlock
            title="Brain model"
            hint="Powers Slack triage, digests, drafts, call summaries, voice intents."
            options={data.llm.options}
            selected={data.llm.selected}
            onSelect={id => void pickModel('llm', id)}
          />
        )}
        {data.byok.source === 'byok' && (
          <div className="mt-1 flex max-w-[480px] flex-col gap-2">
            <span className="text-[12.5px] text-danger">Heads up: Slack messages, call transcripts, and drafts will be sent to this provider.</span>
            <Input className="font-mono text-[13px]" placeholder="Base URL — e.g. https://api.openai.com or https://openrouter.ai/api/v1"
              value={data.byok.url} onChange={e => setData({ ...data, byok: { ...data.byok, url: e.target.value } })} />
            <Input className="font-mono text-[13px]" type="password"
              placeholder={data.byok.hasKey ? 'API key saved — paste to replace' : 'API key (sk-…)'}
              value={key} onChange={e => setKey(e.target.value)} />
            <Input className="font-mono text-[13px]" placeholder="Model id — e.g. gpt-5-mini, anthropic/claude-sonnet-5"
              value={data.byok.model} onChange={e => setData({ ...data, byok: { ...data.byok, model: e.target.value } })} />
            <Button variant="secondary" className="self-start" onClick={() => void saveByok()}>Save & test</Button>
            {byokStatus && <span className="text-[12.5px] text-dim">{byokStatus}</span>}
          </div>
        )}
      </div>
      {/* Speech model is always local — whisper transcribes calls/voice regardless of brain source. */}
      <ModelBlock
        title="Speech model"
        hint="Transcribes calls and voice commands."
        options={data.whisper.options}
        selected={data.whisper.selected}
        onSelect={id => void pickModel('whisper', id)}
      />
      <div className="glass flex flex-col gap-2 rounded-xl border border-line p-3.5">
        <div className="flex flex-col gap-0.5">
          <b className="text-sm">Spoken language</b>
          <span className="text-[12.5px] text-dim">Auto-detect trips on Hinglish — mostly-Hindi speech can come out as English. Pin Hindi if that happens.</span>
        </div>
        <Select value={data.sttLanguage} onValueChange={v => void setSttLanguage(v)}>
          <SelectTrigger className="max-w-[420px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="hi">Hindi / Hinglish (हिंदी)</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
