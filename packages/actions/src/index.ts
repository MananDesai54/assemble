import { exec as nodeExec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Action } from '@assemble/core';

const realExec = promisify(nodeExec);

export type Exec = (cmd: string) => Promise<unknown>;

const MODS: Record<string, string> = {
  cmd: 'command down', command: 'command down', ctrl: 'control down',
  control: 'control down', alt: 'option down', option: 'option down', shift: 'shift down',
};
const KEY_CODES: Record<string, number> = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, esc: 53, escape: 53,
  left: 123, right: 124, down: 125, up: 126,
};

export const SYSTEM_PRESETS: Record<string, string> = {
  'volume-up':   `osascript -e 'set volume output volume (((output volume of (get volume settings)) + 10))'`,
  'volume-down': `osascript -e 'set volume output volume (((output volume of (get volume settings)) - 10))'`,
  'mute-toggle': `osascript -e 'set volume output muted (not (output muted of (get volume settings)))'`,
  'lock-screen': `osascript -e 'tell application "System Events" to keystroke "q" using {command down, control down}'`,
  'screenshot':  `screencapture -x -c`,
  'screenshot-region': `screencapture -i -c`,
  'display-sleep': `pmset displaysleepnow`,
};

function keystrokeCommand(value: string): string {
  const parts = value.toLowerCase().split('+').map(p => p.trim()).filter(Boolean);
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map(m => {
    if (!MODS[m]) throw new Error(`Unknown modifier: ${m}`);
    return MODS[m];
  });
  const using = mods.length ? ` using {${mods.join(', ')}}` : '';
  const stroke = key in KEY_CODES ? `key code ${KEY_CODES[key]}` : `keystroke "${key}"`;
  return `osascript -e 'tell application "System Events" to ${stroke}${using}'`;
}

export function buildCommand(action: Action): string {
  switch (action.type) {
    case 'shell': return action.value;
    case 'open': return `open '${action.value.replace(/'/g, `'\\''`)}'`;
    case 'keystroke': return keystrokeCommand(action.value);
    case 'system': {
      const cmd = SYSTEM_PRESETS[action.value];
      if (!cmd) throw new Error(`Unknown system preset: ${action.value}`);
      return cmd;
    }
    default: throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}

export async function executeAction(
  action: Action | null | undefined,
  exec: Exec = cmd => realExec(cmd),
): Promise<void> {
  if (!action || !action.type) return;
  await exec(buildCommand(action));
}
