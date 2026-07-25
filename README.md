# assemble ◉

**Your desk is the keyboard.** Four corners of your desk become four programmable buttons — no hardware, just the microphone.

Tap a corner. The app hears it, figures out *which* corner, runs whatever you assigned there.

## How it works

One mic can't triangulate, but each desk corner *sounds different* at the mic — distance, desk resonance, timbre. So:

1. **Detect** — continuous stream; a sharp energy spike + fast decay = tap candidate.
2. **Fingerprint** — ~46 ms around the onset → FFT → 32 log-spaced band energies, gain-normalized.
3. **Classify** — k-nearest-neighbors against the samples you taught it. Fires only when the match is close *and* clearly better than the runner-up; everything else (typing, claps, mugs) is ignored.
4. **Act** — corner → your action. 300 ms cooldown against double-fires.

**Constraint:** the mic must stay where it was during teaching. Moved your laptop? Re-teach.

## Install & run

```bash
npm install
npm start
```

First launch walks you through setup: mic check with a live meter, then teaching — tap each corner 10× as prompted, then 10 seconds of "noise you want ignored" (type, click, clap).

If macOS claims "Electron.app contains malware": XProtect false-positive on stale Electron dev builds. `npm install --save-dev electron@latest`, then `node node_modules/electron/install.js`.

## Assign actions

Click a corner on the desk map:

| Action | Value example | Notes |
|---|---|---|
| System action | screenshot (full / region), volume up/down, mute, lock screen | screenshots go to clipboard; needs Screen Recording permission |
| Run a command | `say "hello"` | anything zsh runs |
| Press a shortcut | `cmd+shift+4` | needs Accessibility permission (System Settings → Privacy & Security) |
| Open app or link | `https://github.com` or `/Applications/Spotify.app` | |

## Interface

- **Desk map** — the 2×2 grid mirrors your physical desk; the dot in the middle is the mic. Every detected sound ripples from the dot; a recognized tap lights its corner.
- **Listening switch** (top right, also in the ◉ menubar item) — master arm/disarm.
- **Themes** — ☀/☾ toggle; follows system by default.
- Closing the window hides it; listening continues. Quit from the menubar.

## Teaching tips

- Tap the **desk**, not the laptop — laptop-chassis taps all sound identical at the mic (vibration travels straight through) and usually clip.
- Corners far apart beat spots near each other. Wood desks work best.
- Knuckle taps, moderate strength, vary slightly.
- Don't skip the noise step — that's what teaches it to reject claps and typing.

## Troubleshooting

- **Wrong corner detected** — re-teach with more distinct corner positions.
- **Taps missed** — sensitivity slider left (lower threshold = softer taps register).
- **Random fires** — slider right, re-teach with a longer noise phase.

## Manual test checklist

1. `npm test` → all green (23 tests).
2. Launch, grant mic. ◉ appears in menubar.
3. Onboarding: meter jumps on tap → teach 4 corners + noise phase.
4. Assign `say "hello"` (Run a command) to top-left. Tap top-left → Mac speaks.
5. Typing burst → Activity shows "ignored a sound".
6. Uncheck Listening → taps do nothing; re-check → work again.
7. Close window → tap still fires (background listening).
