# ASSEMBLE 🛡

**Avengers, assemble.** Your desk becomes a 4-button macro pad — no hardware, just the microphone.

Tap a corner of your desk. The app hears it, figures out *which* corner, and runs whatever you assigned there.

| Desk corner | Avenger |
|---|---|
| Top-left | Iron Man |
| Top-right | Captain America |
| Bottom-left | Hulk |
| Bottom-right | Thor |

Anything that isn't a desk tap (typing, mugs, claps) gets rejected as **Ultron**.

## How it works

One mic can't triangulate, but each desk corner *sounds different* at the mic — distance, desk resonance, timbre. So:

1. **Detect** — continuous stream; a sharp energy spike + fast decay = tap candidate.
2. **Fingerprint** — ~46 ms around the onset → FFT → 32 log-spaced band energies, gain-normalized.
3. **Classify** — k-nearest-neighbors against your calibration samples. Fires only when the match is close *and* clearly better than the runner-up; otherwise Ultron.
4. **Act** — zone → your action. 300 ms cooldown against double-fires.

**Constraint:** the mic must stay where it was during calibration. Moved your laptop? Re-enter the Training Room.

## Install & run

```bash
npm install
npm start
```

First launch: macOS asks for microphone access — allow it.

If macOS claims "Electron.app contains malware": that's XProtect false-positiving on stale Electron dev builds. `npm install --save-dev electron@latest`, then `node node_modules/electron/install.js`.

## Calibrate (Training Room)

1. Click **Enter Training Room**.
2. Tap each corner 10× as prompted ("Summon Iron Man…"). Vary strength a little.
3. **Trap Ultron** phase: make non-tap noise — type, click, set a mug down, clap. Click **Done**.

Watch the Activity log: taps should show the right Avenger with confidence %. Misfires? Recalibrate or lower sensitivity.

## Assign actions

Per zone card:

| Type | Value example | Notes |
|---|---|---|
| Shell command | `say "assemble"` | anything zsh runs |
| Keystroke | `cmd+shift+4` | needs Accessibility permission (System Settings → Privacy & Security → Accessibility → enable Electron/ASSEMBLE) |
| Open app / URL | `https://github.com` or `/Applications/Spotify.app` | |
| System preset | volume up/down, mute toggle, lock screen, screenshot (full / select-region) | screenshots go to clipboard; app needs Screen Recording permission. Want a file instead? Use a Shell action: `screencapture -x ~/Desktop/shot.png` |

## Tray

🛡 in the menubar: **Assemble mode** (arm/disarm), **Open Settings**, **Quit**. Closing the window hides it — listening continues in the background.

## Troubleshooting

- **Wrong zone detected** — recalibrate; tap more distinctly different spots (far corners beat near-center points).
- **Taps missed** — move the sensitivity slider left (the slider is a spike threshold: lower value = more sensitive).
- **Random fires** — move it right, and feed more Ultron samples.
- **Soft / glass desk** — worse separation; wood works best.
- **`sounds` config key** — per-zone trigger sounds are stubbed in config, not wired in v1.

## Manual test checklist

1. `npm test` → all green (23 tests).
2. Launch, grant mic. Tray 🛡 appears.
3. Training Room: 10 taps × 4 corners + Ultron phase.
4. Assign `say "assemble"` to Iron Man (shell). Tap top-left → Mac speaks.
5. Typing burst → Activity shows "Ultron rejected".
6. Disarm from tray → taps do nothing; re-arm → work again.
7. Close window → tap still fires (background listening).
