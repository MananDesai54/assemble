import { exec as nodeExec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Action } from '@assemble/core';

const realExec = promisify(nodeExec);

export type Exec = (cmd: string) => Promise<unknown>;
export type Platform = 'darwin' | 'linux';

const currentPlatform = (): Platform => (process.platform === 'linux' ? 'linux' : 'darwin');

/* ---------- macOS ---------- */

const MAC_MODS: Record<string, string> = {
  cmd: 'command down', command: 'command down', ctrl: 'control down',
  control: 'control down', alt: 'option down', option: 'option down', shift: 'shift down',
};
const MAC_KEY_CODES: Record<string, number> = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, esc: 53, escape: 53,
  left: 123, right: 124, down: 125, up: 126,
};

const MAC_PRESETS: Record<string, string> = {
  'volume-up':   `osascript -e 'set volume output volume (((output volume of (get volume settings)) + 10))'`,
  'volume-down': `osascript -e 'set volume output volume (((output volume of (get volume settings)) - 10))'`,
  'mute-toggle': `osascript -e 'set volume output muted (not (output muted of (get volume settings)))'`,
  'lock-screen': `osascript -e 'tell application "System Events" to keystroke "q" using {command down, control down}'`,
  'screenshot':  `screencapture -x -c`,
  'screenshot-region': `screencapture -i -c`,
  'display-sleep': `pmset displaysleepnow`,
  'record-toggle': `curl -s -X POST http://127.0.0.1:4817/record/toggle`,
};

function macKeystroke(value: string): string {
  const parts = value.toLowerCase().split('+').map(p => p.trim()).filter(Boolean);
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map(m => {
    if (!MAC_MODS[m]) throw new Error(`Unknown modifier: ${m}`);
    return MAC_MODS[m];
  });
  const using = mods.length ? ` using {${mods.join(', ')}}` : '';
  const stroke = key in MAC_KEY_CODES ? `key code ${MAC_KEY_CODES[key]}` : `keystroke "${key}"`;
  return `osascript -e 'tell application "System Events" to ${stroke}${using}'`;
}

/* ---------- Linux (PulseAudio/PipeWire + xdotool + xdg) ---------- */

const LINUX_MODS: Record<string, string> = {
  cmd: 'super', command: 'super', ctrl: 'ctrl', control: 'ctrl',
  alt: 'alt', option: 'alt', shift: 'shift',
};
const LINUX_KEYS: Record<string, string> = {
  return: 'Return', enter: 'Return', tab: 'Tab', space: 'space', delete: 'BackSpace',
  esc: 'Escape', escape: 'Escape', left: 'Left', right: 'Right', down: 'Down', up: 'Up',
};

const LINUX_PRESETS: Record<string, string> = {
  'volume-up':   `pactl set-sink-volume @DEFAULT_SINK@ +10%`,
  'volume-down': `pactl set-sink-volume @DEFAULT_SINK@ -10%`,
  'mute-toggle': `pactl set-sink-mute @DEFAULT_SINK@ toggle`,
  'lock-screen': `loginctl lock-session`,
  'screenshot':  `sh -c 'gnome-screenshot -c 2>/dev/null || spectacle -bc 2>/dev/null || (grim - | wl-copy)'`,
  'screenshot-region': `sh -c 'gnome-screenshot -ac 2>/dev/null || spectacle -rbc 2>/dev/null || (slurp | grim -g - - | wl-copy)'`,
  'display-sleep': `sh -c 'xset dpms force off 2>/dev/null || true'`,
  'record-toggle': `curl -s -X POST http://127.0.0.1:4817/record/toggle`,
};

function linuxKeystroke(value: string): string {
  const parts = value.toLowerCase().split('+').map(p => p.trim()).filter(Boolean);
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map(m => {
    if (!LINUX_MODS[m]) throw new Error(`Unknown modifier: ${m}`);
    return LINUX_MODS[m];
  });
  const combo = [...mods, LINUX_KEYS[key] ?? key].join('+');
  return `xdotool key --clearmodifiers '${combo}'`;
}

/* ---------- shared ---------- */

export const presets = (platform: Platform = currentPlatform()): Record<string, string> =>
  platform === 'linux' ? LINUX_PRESETS : MAC_PRESETS;

/** Presets for the platform this process runs on. */
export const SYSTEM_PRESETS: Record<string, string> = presets();

export function buildCommand(action: Action, platform: Platform = currentPlatform()): string {
  switch (action.type) {
    case 'shell': return action.value;
    case 'open': {
      const v = action.value.replace(/'/g, `'\\''`);
      const opener = platform === 'linux' ? 'xdg-open' : 'open';
      // URLs and paths open directly; bare names are app names (macOS only)
      if (/^(https?:\/\/|\/|~)/.test(action.value)) return `${opener} '${v}'`;
      return platform === 'linux' ? `${opener} '${v}'` : `open -a '${v}'`;
    }
    case 'keystroke': return platform === 'linux' ? linuxKeystroke(action.value) : macKeystroke(action.value);
    case 'system': {
      const cmd = presets(platform)[action.value];
      if (!cmd) throw new Error(`Unknown system preset: ${action.value}`);
      return cmd;
    }
    default: throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}

export async function executeAction(
  action: Action | null | undefined,
  exec: Exec = cmd => realExec(cmd),
  platform: Platform = currentPlatform(),
): Promise<void> {
  if (!action || !action.type) return;
  if (action.type === 'voice') return; // handled in the desktop renderer
  await exec(buildCommand(action, platform));
}
