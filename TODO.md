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

1. Slack-triggered workflows — my pick. Your own todo ("workflow around slack message to do different tasks based on messages") and it's the bridge between everything already built: messages flow in, Claude Code runner exists — nothing connects them. Concretely:

- Rules you define in the Workflows page: when (channel / sender / keyword match, e.g. #alerts + "exceeded") → then (notify, or launch Claude Code in a chosen repo with a templated prompt containing the message)
- Your Grafana alert lands → assemble notifies you, or straight-up spawns a session in ~/midgard/infra with "investigate this alert: …"
- That's the devhub-style automation loop, v1

2. Linear activation — it's connected but inert; on-demand fetch fits your "only requested data" rule. Cheap, but nothing depends on it yet.

3. Notes / learning section — standalone, no dependencies, but doesn't compound like #1.

4. Fine-tune on usage — needs months of captured data first; capture is running, so this one just ripens on its own.
