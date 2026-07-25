# ASSEMBLE — Design Spec

Date: 2026-07-25
Status: Approved (user, 2026-07-25)

> **Superseded in part (2026-07-25, later same day):** the Avengers theming below was
> dropped at the user's request. UI now uses neutral naming (corners by position, app
> name "assemble"), a first-run onboarding flow (welcome → mic check → guided teaching),
> a desk-map main screen, and light/dark themes. The signal pipeline, classifier, and
> action model are unchanged. The internal reject label remains `ultron` for config
> compatibility only. See README for current UI.

## What

macOS desktop app (Electron) that turns a desk into 4 programmable buttons using the
microphone. Tap a corner of the desk → app classifies which corner → runs the action
assigned to that corner. Avengers-themed.

## Why

Physical macro pad with zero hardware. Desk itself is the input device.

## How it works (signal path)

One microphone cannot triangulate direction, but taps in different desk corners have
distinct acoustic fingerprints at the mic (distance, desk resonance, timbre). So:

1. **Detect** — continuous audio stream; a sharp transient (energy spike + fast decay)
   is a tap candidate.
2. **Fingerprint** — capture ~100 ms around the peak, FFT, log-spectral feature vector.
3. **Classify** — nearest-centroid / k-NN against calibration samples. Fire only if
   best distance < threshold AND margin over second-best is large enough.
4. **Act** — zone → configured action. 300 ms cooldown prevents double-fire.

Constraint: mic must stay in the same position after calibration. Moving the laptop
requires recalibration (one click).

## Zones (Avengers theme)

| Desk position | Avenger | Card style |
|---|---|---|
| Top-left | Iron Man | red/gold |
| Top-right | Captain America | blue/star |
| Bottom-left | Hulk | green |
| Bottom-right | Thor | silver/lightning |

Rejected/noise class labeled **Ultron** (typing, mug, claps → rejected).

Theming is names + colors only. No Marvel assets, logos, or artwork.

## Architecture

```
Electron app (tray/menubar)
├── Main process
│   ├── Action executor: shell command, keystroke (osascript), open app/URL,
│   │   screenshot (screencapture), system-control presets
│   ├── Config store: JSON (zone→action, calibration vectors, device id, sensitivity)
│   └── Tray: shield icon, "Assemble mode" arm/disarm, open settings
└── Renderer (settings window, hidden-able; audio runs here)
    ├── Audio engine: Web Audio mic stream → transient detector → fingerprint
    ├── Training Room (calibration wizard): "Summon Iron Man — tap top-left 10×",
    │   live feedback, also records ambient/typing negative samples (Ultron class)
    └── Config UI: input-device picker (default: built-in mic), 4 Avenger zone cards,
        action editor, sensitivity slider, arc-reactor pulse on detection
```

Audio must keep running when the window is hidden (window hides, does not close;
`backgroundThrottling` disabled).

## Classifier decision

- **Chosen: spectral fingerprint + nearest-centroid/k-NN.** No ML dependencies,
  instant retraining, adequate for 4 well-separated classes.
- Rejected: TensorFlow.js (heavy, needs far more training data), amplitude-only
  heuristics (cannot separate 4 zones with one mic).

## Actions (v1)

Per zone, one action of type:
- Shell command (covers screenshots, scripts, anything)
- Keystroke/shortcut via osascript (requires Accessibility permission; app detects
  missing permission and links to System Settings)
- Open app / URL
- System-control preset menu (volume, mute, lock screen, screenshot)

Optional per-zone trigger sound, off by default.

## Error handling

- False positives: confidence threshold + Ultron negative class + tray arm/disarm.
- Accuracy drift (mic moved): one-click recalibrate wipes old data.
- Permissions: mic prompt on first run; Accessibility detected per above.

## Testing

- Unit tests: transient detector + classifier against recorded WAV fixtures.
- Live validation: Training Room shows real-time classification + confidence before
  actions are assigned.

## v1 scope

4 zones × single tap. Later (out of scope now): double-tap, tap patterns, more zones,
external mic profiles.

## Project setup

Repo `~/asgard/assemble`, local git identity manandesai54 / manan5401desai@gmail.com.
