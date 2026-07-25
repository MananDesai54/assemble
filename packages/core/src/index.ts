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

export type ActionType = 'shell' | 'keystroke' | 'open' | 'system' | 'voice';

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

/* ================= integrations ================= */

/** One input the user fills to connect an integration. `key` is the kv key. */
export interface ConnectField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  help?: string;
}

export interface IntegrationStatus {
  connected: boolean;
  detail?: string;
}

export interface IntegrationKv {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

/**
 * Capabilities the server hands to an integration. `db` is a bun:sqlite
 * Database and `llm()` resolves to a ready @assemble/llm Llm (or null when
 * AI is off) — typed unknown here so core stays dependency-free.
 */
export interface IntegrationContext {
  kv: IntegrationKv;
  db: unknown;
  broadcast(payload: unknown): void;
  llm(): Promise<unknown | null>;
  notify(title: string, body: string): void;
}

export interface IntegrationManifest {
  id: string;
  name: string;
  description: string;
  /** Inline SVG markup for the sidebar/catalog icon. */
  icon: string;
  connectFields: ConnectField[];
  status(ctx: IntegrationContext): Promise<IntegrationStatus>;
  /** Called on connect and on boot. Must throw if required fields are missing. */
  start(ctx: IntegrationContext): Promise<void>;
  stop(): Promise<void>;
  /** Returns a Hono sub-app; the server mounts it at /integrations/<id>. */
  routes(ctx: IntegrationContext): unknown;
}
