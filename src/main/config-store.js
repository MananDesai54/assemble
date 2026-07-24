import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULTS = () => ({
  deviceId: 'default',
  sensitivity: 6,
  armed: true,
  sounds: false,
  zones: { tl: { action: null }, tr: { action: null }, bl: { action: null }, br: { action: null } },
  classifier: null,
});

export class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = DEFAULTS();
    try {
      const disk = JSON.parse(readFileSync(filePath, 'utf8'));
      this.data = { ...this.data, ...disk, zones: { ...this.data.zones, ...(disk.zones || {}) } };
    } catch { /* missing or corrupt → defaults */ }
  }

  get() { return this.data; }

  set(partial) {
    const zones = partial.zones
      ? { ...this.data.zones, ...Object.fromEntries(Object.entries(partial.zones).map(
          ([id, z]) => [id, { ...this.data.zones[id], ...z }])) }
      : this.data.zones;
    this.data = { ...this.data, ...partial, zones };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.filePath);
    return this.data;
  }
}
