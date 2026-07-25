import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULTS = () => ({
  deviceId: 'default',
  sensitivity: 6,
  armed: true,
  sounds: false,
  theme: 'system',
  onboarded: false,
  // per zone: actions keyed by tap count ('1' | '2' | '3')
  zones: { tl: { actions: {} }, tr: { actions: {} }, bl: { actions: {} }, br: { actions: {} } },
  extras: {
    whistleVolume: false,                     // sustained whistle slides system volume
    blow: { action: null },                   // blow at the mic
    camera: { enabled: false, left: { action: null }, right: { action: null } },
  },
  classifier: null,
});

function normalizeZone(zone = {}) {
  const actions = { ...(zone.actions || {}) };
  if (zone.action && !actions['1']) actions['1'] = zone.action; // legacy single-action shape
  return { actions };
}

export class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = DEFAULTS();
    try {
      const disk = JSON.parse(readFileSync(filePath, 'utf8'));
      const zones = Object.fromEntries(
        Object.keys(this.data.zones).map(id => [id, normalizeZone(disk.zones?.[id])]));
      const extras = {
        ...this.data.extras, ...(disk.extras || {}),
        blow: { ...this.data.extras.blow, ...(disk.extras?.blow || {}) },
        camera: { ...this.data.extras.camera, ...(disk.extras?.camera || {}) },
      };
      this.data = { ...this.data, ...disk, zones, extras };
    } catch { /* missing or corrupt → defaults */ }
  }

  get() { return this.data; }

  set(partial) {
    const zones = partial.zones
      ? { ...this.data.zones, ...Object.fromEntries(Object.entries(partial.zones).map(
          ([id, z]) => [id, { ...this.data.zones[id], ...z }])) }
      : this.data.zones;
    const extras = partial.extras
      ? {
          ...this.data.extras, ...partial.extras,
          blow: { ...this.data.extras.blow, ...(partial.extras.blow || {}) },
          camera: { ...this.data.extras.camera, ...(partial.extras.camera || {}) },
        }
      : this.data.extras;
    this.data = { ...this.data, ...partial, zones, extras };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.filePath);
    return this.data;
  }
}
