import { execFile } from 'node:child_process';

const clean = (s: string) => s.replace(/[\\"]/g, ' ').slice(0, 200);

export function notifyMac(title: string, body: string): void {
  execFile('osascript', ['-e',
    `display notification "${clean(body)}" with title "${clean(title)}" sound name "Glass"`,
  ], err => { if (err) console.error('notify failed:', err.message); });
}
