import { useEffect, useState } from 'react';
import { app, useApp } from '../store';
import { listAudioInputs, setDevice } from '../controller';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function DeviceSelect() {
  useApp();
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([{ id: 'default', label: 'Built-in / default' }]);
  useEffect(() => { void listAudioInputs().then(setDevices); }, []);
  const current = devices.some(d => d.id === app.config?.deviceId) ? app.config.deviceId! : 'default';
  return (
    <Select value={current} onValueChange={v => void setDevice(v)}>
      <SelectTrigger className="min-w-56 max-w-80 self-start"><SelectValue /></SelectTrigger>
      <SelectContent>
        {devices.map(d => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
