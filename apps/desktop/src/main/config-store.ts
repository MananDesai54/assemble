import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppConfig, ZoneConfig } from '@assemble/core';

const DEFAULTS = (): AppConfig => ({
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

// Disk data may be from any prior version — treat loosely.
type DiskConfig = Omit<Partial<AppConfig>, 'zones' | 'extras'> & {
  zones?: Record<string, Partial<ZoneConfig> & { action?: unknown }>;
  extras?: Partial<AppConfig['extras']>;
};

/** What set() accepts: any subset, zones/extras may be partial per key. */
export type ConfigPatch = Omit<Partial<AppConfig>, 'zones' | 'extras'> & {
  zones?: Partial<Record<keyof AppConfig['zones'], ZoneConfig>>;
  extras?: Partial<AppConfig['extras']> & {
    blow?: Partial<AppConfig['extras']['blow']>;
    camera?: Partial<AppConfig['extras']['camera']>;
  };
};

function normalizeZone(zone: (Partial<ZoneConfig> & { action?: unknown }) | undefined = {}): ZoneConfig {
  const actions = { ...(zone.actions || {}) } as ZoneConfig['actions'];
  if (zone.action && !actions['1']) actions['1'] = zone.action as ZoneConfig['actions']['1']; // legacy single-action shape
  return { actions };
}

export class ConfigStore {
  filePath: string;
  data: AppConfig;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = DEFAULTS();
    try {
      const disk = JSON.parse(readFileSync(filePath, 'utf8')) as DiskConfig;
      const zones = Object.fromEntries(
        (Object.keys(this.data.zones) as (keyof AppConfig['zones'])[])
          .map(id => [id, normalizeZone(disk.zones?.[id])])) as AppConfig['zones'];
      const extras: AppConfig['extras'] = {
        ...this.data.extras, ...(disk.extras || {}),
        blow: { ...this.data.extras.blow, ...(disk.extras?.blow || {}) },
        camera: { ...this.data.extras.camera, ...(disk.extras?.camera || {}) },
      };
      this.data = { ...this.data, ...disk, zones, extras };
    } catch { /* missing or corrupt → defaults */ }
  }

  get(): AppConfig { return this.data; }

  /** Factory reset: back to defaults, persisted. */
  reset(): AppConfig {
    this.data = DEFAULTS();
    return this.set({});
  }

  set(partial: ConfigPatch): AppConfig {
    const zones = partial.zones
      ? { ...this.data.zones, ...Object.fromEntries(Object.entries(partial.zones).map(
          ([id, z]) => [id, { ...this.data.zones[id as keyof AppConfig['zones']], ...z }])) } as AppConfig['zones']
      : this.data.zones;
    const extras: AppConfig['extras'] = partial.extras
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
