export type ZoneId = 'tl' | 'tr' | 'bl' | 'br';

export interface Zone {
  id: ZoneId;
  label: string;
}

export const ZONES: Zone[] = [
  { id: 'tl', label: 'Top left' },
  { id: 'tr', label: 'Top right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'br', label: 'Bottom right' },
];
export const ZONE_IDS: ZoneId[] = ZONES.map(z => z.id);
// Internal reject-class label. Kept as-is so existing calibration configs stay valid.
export const REJECT_LABEL = 'ultron';
export const zoneById = (id: string): Zone | undefined => ZONES.find(z => z.id === id);

export type ActionType = 'shell' | 'keystroke' | 'open' | 'system';

export interface Action {
  type: ActionType;
  value: string;
}

/** Tap-count pattern → action. Keys '1' | '2' | '3'. */
export type PatternActions = Partial<Record<'1' | '2' | '3', Action | null>>;

export interface ZoneConfig {
  actions: PatternActions;
}

export interface ExtrasConfig {
  whistleVolume: boolean;
  blow: { action: Action | null };
  camera: {
    enabled: boolean;
    left: { action: Action | null };
    right: { action: Action | null };
  };
}

export interface ClassifierJSON {
  k: number;
  maxDistance: number;
  minMargin: number;
  samples: { label: string; vec: number[] }[];
}

export interface AppConfig {
  deviceId: string;
  sensitivity: number;
  armed: boolean;
  sounds: boolean;
  theme: 'system' | 'light' | 'dark';
  onboarded: boolean;
  zones: Record<ZoneId, ZoneConfig>;
  extras: ExtrasConfig;
  classifier: ClassifierJSON | null;
}
