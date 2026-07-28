# TODO

- [ ] **Fine-tune the LLM on my usage** — train on captured Slack conversations, call transcripts, drafts I edited, and actions I took, so the brain drafts/triages the way I actually work.
- [ ] **Only fetch requested data from sources** — pull data on demand instead of bulk-syncing everything; integrations should ask for exactly what a feature needs, when it needs it.
- [ ] **Automate flows with Claude Code (devhub-style)** — chain Claude Code sessions into repeatable flows like we did in devhub, triggered from issues/messages/gestures.
- [ ] **Support more automations** — grow the automation catalog beyond the current presets (more triggers, more actions, user-composable).
- [ ] **Note taking** — capture and organize notes locally.
- [ ] **Learning section** — a place that surfaces what the system has learned about how I work.
- [ ] **More interaction types** — improve STT as an interaction path, and add other tap/gesture types beyond corner knocks (scratches, slides, new surfaces) for triggering actions.
- [ ] Have workflow around slack message to do different task based on messages.
- [ ] agentic calls and tool calling but local/open weight only.
- [ ] Add memory for everything to tune model.
- [ ] add speech to text for usage
- [ ] computer use and browser inside https://huggingface.co/microsoft/Fara1.5-27B
- [ ] fix installtion issue
- [ ] local Ai performance
- [ ] have tts which can do both english and hindi.
- [ ] p2p compute ? utilize all PCs and mobiles ?
- [ ] Electronics learning platfrom + Book/article to exaplnatory video
- [ ] provide exiting model path in local instead of downloading

1. Slack-triggered workflows — my pick. Your own todo ("workflow around slack message to do different tasks based on messages") and it's the bridge between everything already built: messages flow in, Claude Code runner exists — nothing connects them. Concretely:

- Rules you define in the Workflows page: when (channel / sender / keyword match, e.g. #alerts + "exceeded") → then (notify, or launch Claude Code in a chosen repo with a templated prompt containing the message)
- Your Grafana alert lands → assemble notifies you, or straight-up spawns a session in ~/midgard/infra with "investigate this alert: …"
- That's the devhub-style automation loop, v1

2. Linear activation — it's connected but inert; on-demand fetch fits your "only requested data" rule. Cheap, but nothing depends on it yet.

3. Notes / learning section — standalone, no dependencies, but doesn't compound like #1.

4. Fine-tune on usage — needs months of captured data first; capture is running, so this one just ripens on its own.

┌────────────────────────────┬───────────────────────────────┬─────────────────────────────┐
│ Component │ Cost │ Tauri effect │
├────────────────────────────┼───────────────────────────────┼─────────────────────────────┤
│ llama-server (12B model) │ ~7–8 GB RAM, battery when hot │ zero │
├────────────────────────────┼───────────────────────────────┼─────────────────────────────┤
│ whisper per call │ CPU spikes │ zero │
├────────────────────────────┼───────────────────────────────┼─────────────────────────────┤
│ Kokoro ONNX │ ~300 MB resident │ zero │
├────────────────────────────┼───────────────────────────────┼─────────────────────────────┤
│ bun server daemon │ ~100–200 MB │ zero — still ships │
├────────────────────────────┼───────────────────────────────┼─────────────────────────────┤
│ Electron chrome + renderer │ ~250–400 MB │ this shrinks, maybe −200 MB │
└────────────────────────────┴───────────────────────────────┴─────────────────────────────┘

Tauri wins: smaller binary (~10 MB vs 175 MB), faster launch, ~200 MB less RAM. Real but marginal — under 5% of your total footprint.

Tauri costs:

- Main-process layer rewritten in Rust: server spawn, tray, quick panel window, global shortcut plumbing, dock, IPC preload
- WKWebView instead of Chromium: WebGL (Threads bg), AudioWorklet capture, speechSynthesis voices all behave differently on macOS vs Linux — re-test everything audio
- Renderer stays React — that ports fine

The performance you actually feel = engines sitting resident. That was the on-demand/idle-kill change you reverted today. Cheaper levers than Tauri, in order:

1. Re-apply idle engine sleep (maybe with longer window, 30–60 min, or Settings toggle)
2. Smaller brain when idle contexts (Gemma 4B for voice commands, 12B for talk)
3. --reasoning-budget 0 already cut token burn
