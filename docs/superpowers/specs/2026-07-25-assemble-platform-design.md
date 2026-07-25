# assemble platform — Design & Roadmap

Date: 2026-07-25
Status: Approved direction (user), Phase 1 in progress

## Vision

Local-first work automation. Physical gestures, voice, Slack, Linear, and calls flow
into one local system; local models (no cloud AI) decide and summarize; actions flow
back out — macOS commands, Slack replies, Linear updates, and eventually Claude Code
terminal sessions doing the actual work.

The user's world: **Slack = conversation, Linear = work items, Claude Code = execution.**
End goal: assemble learns how the user works and automates increasing amounts of it.

## Hard constraints

- **No outside models.** All AI local:
  - LLM: **Gemma 4 12B** (omni multimodal, June 2026) as GGUF via **llama.cpp**
    (`llama-server`, OpenAI-compatible localhost API). Q4_K_M default.
    Chosen over Ollama deliberately: llama.cpp direct = no daemon wrapper, faster
    feature uptake, full flag control; we manage GGUFs ourselves.
  - STT: **whisper.cpp** with **medium** model (parrot-style: local, in-process/CLI).
- TypeScript everywhere. Bun workspaces monorepo.
- Recordings, transcripts, messages: stored locally (SQLite), never uploaded.

## Monorepo layout

```
assemble/
├── package.json            bun workspaces root
├── apps/
│   ├── desktop/            Electron + TS — sensors UI (taps/rhythms/whistle/blow/waves),
│   │                       recording controls, digests/drafts UI. esbuild bundling.
│   └── server/             Bun + Hono — local daemon :4817. Slack Socket Mode intake,
│                           SQLite storage, LLM/STT job runner, RE
│                           ST+WS API for desktop.
├── packages/
│   ├── core/               shared types: events, actions, config schemas (zod)
│   ├── dsp/                pure audio DSP (detector, fingerprint, classifier, rhythm,
│   │                       pitch, whistle, blow, motion) — extracted from desktop
│   ├── stt/                whisper.cpp wrapper (spawns whisper-cli, wav→text)
│   ├── llm/                llama-server client: complete/json helpers, prompt templates
│   ├── slack/              Socket Mode client, message normalization, reply posting
│   └── actions/            action model + macOS executor (moved from desktop main)
├── native/
│   └── audiotap/           Swift ScreenCaptureKit CLI: system audio (+mic mix) → PCM/WAV
├── models/                 gitignored — GGUFs + whisper models
└── scripts/                setup: build llama.cpp/whisper.cpp, download models
```

Desktop ↔ server: localhost HTTP + WebSocket. Desktop keeps working with server down
(sensors/actions degrade gracefully; Slack/AI features need server).

## Roadmap

### Phase 1 — Monorepo + TypeScript (now)
Restructure to bun workspaces; extract `packages/dsp`, `packages/core`,
`packages/actions`; desktop → TS with esbuild; all 46 tests keep passing (vitest).
App behavior unchanged.

### Phase 2 — Server + Slack capture
`apps/server`: Hono, SQLite (`bun:sqlite`). Slack **Socket Mode** (reuse tokens from
slack-receiver `.env`; needs new app-level `SLACK_APP_TOKEN` — user action).
Store normalized messages; expose `/slack/recent`, WS event stream. Desktop shows a
Slack pane. (Old slack-receiver Express webhook retired.)

### Phase 3 — Local model runtime
`scripts/setup-models.sh`: clone+build llama.cpp & whisper.cpp; download
gemma-4-12b-it Q4_K_M GGUF + whisper medium. `packages/llm` + `packages/stt`.
Slack features go live:
- **Urgent-ping filter**: every incoming message scored by gemma; urgent → macOS notification.
- **On-demand digest**: gesture/button → summary of unread since last check.
- **Draft replies**: gemma drafts, user approves/edits in desktop UI before posting.

### Phase 4 — Call recording + transcription
`native/audiotap` (Swift, ScreenCaptureKit): captures system audio + mic.
Start/stop: UI button + assignable action type `record-toggle` (usable from any
gesture) + auto-suggest when a call app is active (later).
Pipeline: PCM → wav chunks → whisper medium → transcript → gemma summary + action
items → SQLite → viewer UI in desktop.
Consent: user is responsible for informing participants; app shows a recording
indicator at all times.

### Phase 5 — Voice actions
Push-to-talk (gesture or hotkey) → capture until silence → whisper → gemma intent
parse → execute mapped action. Gestures stay for quick tasks; voice covers the long
tail ("record this call", "digest slack", "open the PR").

### Phase 6 — Work automation (vision)
- Linear integration: read/update issues, link Slack threads to issues.
- Style/pattern learning: fine-tune prompts (not weights) on the user's message
  history and habits; drafts that sound like the user.
- Claude Code orchestration: assemble spawns/feeds terminal sessions for actual
  work execution, reports back to Slack/Linear.
- Multi-channel piezo hardware option for tap accuracy.

## Decisions log

- Bun over npm; llama.cpp over Ollama; Socket Mode over HTTP webhooks (no public URL).
- Electron stays (no Tauri rewrite) — working app, native modules not needed thanks to
  CLI helpers (audiotap, whisper-cli, llama-server as separate processes).
- Whisper medium over small (user choice: transcript quality > speed).
- Gemma 4 12B Q4_K_M (~7–8GB): fits 16GB+ Apple Silicon comfortably.
