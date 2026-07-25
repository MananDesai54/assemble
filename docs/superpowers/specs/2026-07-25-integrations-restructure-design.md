# Integrations restructure — design

**Date:** 2026-07-25
**Status:** implemented

## Goal

assemble becomes a generic local-first work platform. Anything that talks to a
third-party service (Slack, Linear, future Gmail/Notion/GitHub) is a pluggable
**integration**: its own package, discovered through a registry, shown in the UI
only when connected. Core features — desk gestures, calls, voice, Claude Code
sessions, local AI — stay built in.

## Decisions (from brainstorm)

- **Core line:** integrations = third-party connectors only. Desk/dsp, calls,
  voice, Work (Claude Code), llm/stt stay core.
- **UI:** unconnected integrations are hidden from the nav. Settings gets an
  **Integrations** tab with a catalog of available integrations and per-card
  Connect/Disconnect. Onboarding's Connect step reuses the same catalog.
- **No separate kit package:** manifest + context types live in `packages/core`.

## Package structure

```
packages/
  core          shared types, zones, IntegrationManifest, IntegrationContext
  dsp           audio DSP (taps, whistle, blow, motion) — core
  actions       action model + executors — core
  llm           llama-server client + prompts — core
  stt           whisper.cpp wrapper — core
  integrations/
    slack/      Socket Mode client + routes + manifest (from apps/server/src/slack.ts)
    linear/     Linear API client + routes + manifest (from packages/linear)
```

Root `package.json` workspaces gains `packages/integrations/*`.
`packages/linear` is deleted after the move. `apps/server/src/slack.ts` moves
into the slack integration package.

## Manifest contract (packages/core)

```ts
export interface ConnectField {
  key: string;          // kv key, e.g. "slack_app_token"
  label: string;
  placeholder: string;
  secret: boolean;      // render as password input
  help?: string;
}

export interface IntegrationStatus {
  connected: boolean;
  detail?: string;      // e.g. "socket open", "3 issues assigned"
}

export interface IntegrationContext {
  kv: { get(key: string): string | null; set(key: string, v: string): void; del(key: string): void };
  db: unknown;                          // concrete Database passed by server
  broadcast(payload: unknown): void;
  llm(): Promise<unknown | null>;       // current Llm instance or null
  notify(title: string, body: string): void;
}

export interface IntegrationManifest {
  id: string;                           // "slack", "linear"
  name: string;
  description: string;
  icon: string;                         // inline SVG markup
  connectFields: ConnectField[];
  status(ctx: IntegrationContext): Promise<IntegrationStatus>;
  start(ctx: IntegrationContext): Promise<void>;   // called on connect + on boot if connected
  stop(): Promise<void>;
  routes(ctx: IntegrationContext): unknown;        // Hono sub-app, mounted at /integrations/<id>
}
```

`db`/`llm` are typed loosely in core to keep core dependency-free;
integrations narrow them.

## Server

- `apps/server/src/integrations.ts`: `const registry: IntegrationManifest[] = [slack, linear]`.
  Adding an integration later = one import + one array entry.
- Boot: for each registry entry with all `connectFields` present in kv → `start(ctx)`.
- Endpoints:
  - `GET  /integrations` → `[{ id, name, description, icon, connectFields (values masked), connected, detail }]`
  - `POST /integrations/:id/connect` — body `{ [key]: value }`; saves to kv, calls `start`, returns status
  - `POST /integrations/:id/disconnect` — calls `stop`, deletes kv keys
- Route moves (old paths deleted; desktop is the only client, updated in same change):
  - `/slack/recent|digest|draft|send` → `/integrations/slack/*`
  - `/linear/issues` → `/integrations/linear/issues`
  - `/setup/slack`, `/setup/linear` → replaced by generic connect endpoint
- `/reset` also stops all running integrations.
- Slack `.env` fallback for headless runs is preserved inside the slack package.

## Renderer

- Nav = fixed core pages (Desk, Calls, Work, Activity, Settings) + one entry per
  **connected** integration from `GET /integrations`, refreshed on WS
  `integration-changed` events.
- Integration pages are modules in `renderer.ts` keyed by id in
  `INTEGRATION_PAGES`. Integrations without a page get no nav entry — e.g.
  linear has no page module; its UI is the gated pane inside Work, not a
  standalone "no UI" card.
- Work page stays core (Claude Code sessions); its Linear issue list renders
  only when linear is connected.
- Settings → **Integrations** tab: catalog cards built from `GET /integrations`
  (icon, name, description, fields, Connect/Disconnect). Same component reused
  in onboarding's Connect step.

## Data & migration

- kv keys unchanged (`slack_app_token`, `slack_bot_token`, `linear_api_key`) → no
  data migration needed; previously-connected users stay connected.
- WS message kinds unchanged (`slack-message`, `urgent`, `slack-connected`),
  plus new `integration-changed`.

## Testing

- Existing slack/linear tests move with their code into the integration packages.
- New: registry endpoint tests (catalog shape, connect happy path + missing
  field, disconnect clears kv and stops), manifest completeness test (every
  registry entry has unique id, fields, icon).
- Full suite (`bun test`, `bun test apps/server/tests-bun`, typecheck) stays green.

## Out of scope

- Dynamic/runtime plugin loading from user directory.
- Making core features (desk, calls, voice, work) modular.
- New integrations beyond slack/linear (structure ready; none added now).
