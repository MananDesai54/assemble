// Settings → Local AI → assistant voice: Kokoro only, one dropdown + preview.
import { useEffect, useState } from 'react';
import { SERVER } from '../store';
import { previewVoice } from '../controller';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';

export function VoicePicker() {
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([]);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const savedRaw = localStorage.getItem('talk-voice') ?? 'k:af_heart';
  const [chosen, setChosen] = useState(savedRaw.startsWith('k:') ? savedRaw : 'k:af_heart');

  useEffect(() => {
    fetch(`${SERVER}/tts/voices`).then(r => r.json())
      .then(d => setVoices(d.voices ?? []))
      .catch(() => setOffline(true));
  }, []);

  const preview = async (value: string) => {
    setBusy(true);
    await previewVoice(value);
    setBusy(false);
  };

  return (
    <div className="glass flex flex-col gap-2 rounded-xl border border-line p-3.5">
      <div className="flex flex-col gap-0.5">
        <b className="text-sm">Assistant voice</b>
        <span className="text-[12.5px] text-dim">Speaks Talk replies — Kokoro, fully local. Hindi replies use the OS Hindi voice automatically.</span>
      </div>
      {offline || !voices.length ? (
        <span className="text-[12.5px] text-dim">Voices unavailable — local server offline.</span>
      ) : (
        <div className="flex items-center gap-2.5">
          <Select value={chosen} onValueChange={v => { setChosen(v); localStorage.setItem('talk-voice', v); void preview(v); }}>
            <SelectTrigger className="max-w-80 min-w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {voices.map(v => <SelectItem key={v.id} value={`k:${v.id}`}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="secondary" disabled={busy} onClick={() => void preview(chosen)}>
            {busy ? '…' : '▶ Preview'}
          </Button>
        </div>
      )}
    </div>
  );
}
