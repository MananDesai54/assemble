import { execFile } from 'node:child_process';

const clean = (s: string) => s.replace(/[\\"]/g, ' ').slice(0, 200);

export function notifyMac(title: string, body: string): void {
  if (process.platform === 'linux') {
    execFile('notify-send', [clean(title), clean(body)],
      err => { if (err) console.error('notify failed:', err.message); });
    return;
  }
  execFile('osascript', ['-e',
    `display notification "${clean(body)}" with title "${clean(title)}" sound name "Glass"`,
  ], err => { if (err) console.error('notify failed:', err.message); });
}
