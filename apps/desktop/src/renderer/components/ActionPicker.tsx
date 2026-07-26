// Small self-saving control: [type ▾] [preset ▾ | value input]
import { useState } from 'react';
import type { Action } from '@assemble/core';
import { PRESET_NAMES } from '../controller';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';

const PLACEHOLDERS: Record<string, string> = {
  shell: 'say "hello"', keystroke: 'cmd+shift+4', open: 'https://… or /Applications/App.app',
};

const TYPES = [
  { value: 'none', label: 'Does nothing' },
  { value: 'system', label: 'System action' },
  { value: 'shell', label: 'Run a command' },
  { value: 'keystroke', label: 'Press a shortcut' },
  { value: 'open', label: 'Open app or link' },
  { value: 'voice', label: '🎙 Voice command' },
];

export function ActionPicker({ current, onChange }: {
  current: Action | null | undefined;
  onChange: (a: Action | null) => void;
}) {
  const [type, setType] = useState<string>(current?.type ?? 'none');
  const [preset, setPreset] = useState(current?.type === 'system' ? current.value : 'volume-up');
  const [value, setValue] = useState(current && current.type !== 'system' ? current.value : '');

  const save = (t: string, p: string, v: string) => {
    if (t === 'none') { onChange(null); return; }
    const val = t === 'system' ? p : t === 'voice' ? 'listen' : v.trim();
    onChange(val || t === 'system' || t === 'voice' ? { type: t as Action['type'], value: val } : null);
  };

  return (
    <span className="inline-flex flex-1 flex-wrap items-center gap-2">
      <Select value={type} onValueChange={t => { setType(t); save(t, preset, value); }}>
        <SelectTrigger className="min-w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {type === 'system' && (
        <Select value={preset} onValueChange={p => { setPreset(p); save(type, p, value); }}>
          <SelectTrigger className="min-w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(PRESET_NAMES).map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {type !== 'system' && type !== 'voice' && type !== 'none' && (
        <Input
          className="min-w-[200px] flex-1"
          placeholder={PLACEHOLDERS[type] || ''}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={() => save(type, preset, value)}
          onKeyDown={e => { if (e.key === 'Enter') save(type, preset, value); }}
        />
      )}
    </span>
  );
}
