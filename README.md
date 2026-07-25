# assemble ◉

**Your desk is the keyboard.** Four corners of your desk become four programmable buttons — no extra hardware, just the microphone.

Tap a corner. The app hears it, figures out *which* corner, runs whatever you assigned there.

![Main screen, dark theme](docs/screenshots/main-dark.png)

## How it works

One mic can't triangulate, but each desk corner *sounds different* at the mic — distance, desk resonance, timbre. So:

1. **Detect** — continuous stream; a sharp energy spike + fast decay = tap candidate.
2. **Fingerprint** — ~46 ms around the onset → FFT → 32 log-spaced band energies, gain-normalized.
3. **Classify** — k-nearest-neighbors against the samples you taught it. Fires only when the match is close *and* clearly better than the runner-up; everything else (typing, claps, mugs) is ignored.
4. **Act** — corner → your action. 300 ms cooldown against double-fires.

**Constraint:** the mic must stay where it was during teaching. Moved your laptop? Re-teach.

## Install

```bash
git clone https://github.com/MananDesai54/assemble.git
cd assemble
npm install
npm start
```

Requires macOS. First launch asks for microphone access — allow it.

If macOS claims "Electron.app contains malware": XProtect false-positive on stale Electron dev builds. `npm install --save-dev electron@latest`, then `node node_modules/electron/install.js`.

## Usage guide

### 1. First run — setup

![Welcome screen](docs/screenshots/welcome.png)

Click **Set up**. Pick your microphone and tap the desk — the level meter should jump. If it doesn't, choose a different input or check System Settings → Privacy & Security → Microphone.

### 2. Teach the corners

![Teaching screen](docs/screenshots/teach.png)

The highlighted corner on the desk map is the one to tap. Knock that corner of your **desk** 10 times with a knuckle, varying strength a little. The map mirrors your real desk; the dot in the middle is your mic.

Made a mess of a corner? **Redo this corner**, **Previous corner**, and **Start over** are right under the count.

After the four corners: the **ignore** phase. For ten seconds, make every sound that should NOT trigger anything — type, click, clap, set a mug down. Don't skip this; it's what stops random noise from firing your actions.

**Teaching tips**

- Tap the desk, not the laptop — chassis taps all sound identical at the mic and usually clip.
- Corners far apart beat spots near each other. Wood desks work best.
- Teach with the room in its normal state (music on if it's usually on).

### 3. Assign actions

Click a corner card:

| Action | Value example | Notes |
|---|---|---|
| System action | screenshot (full / region), volume up/down, mute, lock screen | screenshots go to clipboard; needs Screen Recording permission |
| Run a command | `say "hello"` | anything zsh runs |
| Press a shortcut | `cmd+shift+4` | needs Accessibility permission (System Settings → Privacy & Security) |
| Open app or link | `https://github.com` or `/Applications/Spotify.app` | |

### 4. Daily use

![Main screen, light theme](docs/screenshots/main-light.png)

- Every sound the app hears ripples from the mic dot; a recognized tap lights its corner and shows up in **Activity** with its confidence.
- **Listening** switch (top right, or the ◉ menubar item) is the master arm/disarm — flip it off for meetings.
- **Sensitivity**: left = softer taps register; right = only hard knocks.
- **☀/☾** toggles light/dark; follows your system by default.
- Closing the window hides it — listening continues in the background. Quit from the menubar.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Wrong corner detected | Re-teach; tap positions farther apart |
| Taps missed | Sensitivity slider left |
| Random fires | Slider right; re-teach with a longer, louder ignore phase |
| "ignored a sound" for real taps | Re-teach — your tap now differs from the samples (mic moved, different knuckle) |
| Meter dead | Wrong input device, or mic permission missing |

## Development

```bash
npm test                          # 24 unit tests (detector, fingerprint, classifier, actions, config)
ASSEMBLE_SCREEN=teach npm start   # jump straight to a screen: welcome | mic | teach | main
```

Pure-DSP modules (`src/renderer/audio/`) have no Electron dependency — they run in Node under Vitest against synthesized tap fixtures.

Config lives at `~/Library/Application Support/assemble/config.json` — delete it for a factory reset.
