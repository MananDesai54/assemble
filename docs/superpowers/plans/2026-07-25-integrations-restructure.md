# Integrations Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Slack and Linear into pluggable integration packages discovered through a server registry, with the UI showing them only when connected.

**Architecture:** Manifest types live in `packages/core`. Each integration is a bun workspace package under `packages/integrations/` exporting an `IntegrationManifest` (connect fields, start/stop, status, Hono routes). `apps/server` holds a registry and generic `/integrations` endpoints; old hardcoded `/slack/*`, `/linear/*`, `/setup/slack`, `/setup/linear` routes die. The renderer builds its sidebar from `GET /integrations` and gets a reusable integrations-catalog component (Settings tab + onboarding Connect step).

**Tech Stack:** TypeScript, Bun workspaces, Hono, bun:sqlite, vitest + bun:test, Electron renderer (vanilla TS, esbuild).

**Spec:** `docs/superpowers/specs/2026-07-25-integrations-restructure-design.md`

## Global Constraints

- kv keys unchanged: `slack_app_token`, `slack_bot_token`, `linear_api_key` (NOTE: spec wrote `linear_key`; actual key in code is `linear_api_key` — keep `linear_api_key`).
- WS kinds unchanged (`slack-message`, `urgent`, `slack-connected`, …) plus new `integration-changed`.
- `packages/core` stays dependency-free — manifest types use `unknown` for db/llm/Hono, integrations narrow them.
- `.env` fallback preserved: `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `LINEAR_API_KEY` still work when kv is empty.
- Tests touching `bun:sqlite` run under `bun test` (tests-bun dirs), pure-logic tests under vitest (`tests/` dirs). vitest must never load a file importing `bun:sqlite`.
- Every task ends green: `bun run typecheck`, `bun test` (vitest), `bun test apps/server/tests-bun packages/integrations/slack/tests-bun` (bun) — dirs that exist at that point.
- Commit messages: conventional prefix + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Manifest types in core + kvDel

**Files:**
- Modify: `packages/core/src/index.ts` (append at end)
- Modify: `apps/server/src/db.ts` (add `kvDel` after `kvSet`, line ~164)
- Test: `apps/server/tests-bun/db.test.ts` (extend kv roundtrip test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ConnectField`, `IntegrationStatus`, `IntegrationKv`, `IntegrationContext`, `IntegrationManifest` exported from `@assemble/core`; `kvDel(db: Database, key: string): void` from `apps/server/src/db`.

- [ ] **Step 1: Write failing test for kvDel**

Append inside the `describe('db', …)` block of `apps/server/tests-bun/db.test.ts` (add `kvDel` to the existing import from `../src/db`):

```ts
  it('kv delete', () => {
    const db = fresh();
    kvSet(db, 'gone', 'x');
    kvDel(db, 'gone');
    expect(kvGet(db, 'gone')).toBe(null);
    kvDel(db, 'never-existed'); // no throw
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/server/tests-bun`
Expected: FAIL — `kvDel` is not exported.

- [ ] **Step 3: Implement kvDel + manifest types**

Append to `apps/server/src/db.ts`:

```ts
export function kvDel(db: Database, key: string): void {
  db.run(`DELETE FROM kv WHERE key = ?`, [key]);
}
```

Append to `packages/core/src/index.ts`:

```ts
/* ================= integrations ================= */

/** One input the user fills to connect an integration. `key` is the kv key. */
export interface ConnectField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  help?: string;
}

export interface IntegrationStatus {
  connected: boolean;
  detail?: string;
}

export interface IntegrationKv {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

/**
 * Capabilities the server hands to an integration. `db` is a bun:sqlite
 * Database and `llm()` resolves to a ready @assemble/llm Llm (or null when
 * AI is off) — typed unknown here so core stays dependency-free.
 */
export interface IntegrationContext {
  kv: IntegrationKv;
  db: unknown;
  broadcast(payload: unknown): void;
  llm(): Promise<unknown | null>;
  notify(title: string, body: string): void;
}

export interface IntegrationManifest {
  id: string;
  name: string;
  description: string;
  /** Inline SVG markup for the sidebar/catalog icon. */
  icon: string;
  connectFields: ConnectField[];
  status(ctx: IntegrationContext): Promise<IntegrationStatus>;
  /** Called on connect and on boot. Must throw if required fields are missing. */
  start(ctx: IntegrationContext): Promise<void>;
  stop(): Promise<void>;
  /** Returns a Hono sub-app; the server mounts it at /integrations/<id>. */
  routes(ctx: IntegrationContext): unknown;
}
```

- [ ] **Step 4: Verify green**

Run: `bun test apps/server/tests-bun && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts apps/server/src/db.ts apps/server/tests-bun/db.test.ts
git commit -m "feat(core): integration manifest types + kvDel"
```

---

### Task 2: Slack integration package

**Files:**
- Create: `packages/integrations/slack/package.json`
- Create: `packages/integrations/slack/src/intake.ts` (content of `apps/server/src/slack.ts`, verbatim)
- Create: `packages/integrations/slack/src/store.ts` (message schema + helpers moved from `apps/server/src/db.ts`)
- Create: `packages/integrations/slack/src/index.ts` (manifest + routes + runDigest)
- Create: `packages/integrations/slack/tests/normalize.test.ts` (moved from `apps/server/tests/normalize.test.ts`)
- Create: `packages/integrations/slack/tests-bun/store.test.ts` (message tests moved from `apps/server/tests-bun/db.test.ts`)
- Delete: `apps/server/src/slack.ts`, `apps/server/tests/normalize.test.ts`
- Modify: root `package.json` (workspaces + test script), `vitest.config.ts`, `apps/server/src/db.ts` (remove message schema/helpers), `apps/server/tests-bun/db.test.ts` (remove message tests), `apps/server/src/index.ts` (interim import swap), `apps/server/package.json`

**Interfaces:**
- Consumes: `IntegrationManifest`, `IntegrationContext` from `@assemble/core` (Task 1).
- Produces: package `@assemble/integration-slack` exporting:
  - `slackIntegration: IntegrationManifest`
  - `runDigest(ctx: IntegrationContext): Promise<{ summary: string; count: number }>` (throws `Error('local AI is off — open Setup')` when llm null)
  - `startSlack`, `normalizeEvent`, `SlackIntake`, `EnrichedMessage` (re-exported from intake)
  - `ensureSlackTables(db: Database)`, `insertMessage`, `recentMessages`, `setUrgency`, `messagesAfter`, `channelMessages`, `lastMessageId`, `MessageRow`, `InsertMessage` (from store)

- [ ] **Step 1: Workspace + package scaffolding**

Root `package.json`: change workspaces to `["apps/*", "packages/*", "packages/integrations/*"]` and add script `"test:bun": "bun test apps/server/tests-bun packages/integrations/slack/tests-bun"`.

`vitest.config.ts` include becomes:

```ts
    include: [
      'packages/*/tests/**/*.test.ts',
      'packages/integrations/*/tests/**/*.test.ts',
      'apps/*/tests/**/*.test.ts',
    ],
```

`packages/integrations/slack/package.json`:

```json
{
  "name": "@assemble/integration-slack",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@assemble/core": "workspace:*",
    "@assemble/llm": "workspace:*",
    "@slack/socket-mode": "^2.0.0",
    "@slack/web-api": "^7.0.0",
    "hono": "^4.0.0"
  }
}
```

- [ ] **Step 2: Move intake + store, write failing store test**

`git mv apps/server/src/slack.ts packages/integrations/slack/src/intake.ts` (content unchanged).
`git mv apps/server/tests/normalize.test.ts packages/integrations/slack/tests/normalize.test.ts` and change its import to `from '../src/intake'`.

Create `packages/integrations/slack/tests-bun/store.test.ts` — the two message tests from `apps/server/tests-bun/db.test.ts`, retargeted:

```ts
import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSlackTables, insertMessage, recentMessages } from '../src/store';

const fresh = () => { const db = new Database(':memory:'); ensureSlackTables(db); return db; };

describe('slack store', () => {
  it('inserts and reads back newest-first', () => {
    const db = fresh();
    insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'first', userName: 'Manan' });
    insertMessage(db, { slackTs: '2.0', channel: 'C1', text: 'second' });
    const rows = recentMessages(db, 10);
    expect(rows.length).toBe(2);
    expect(rows[0].text).toBe('second');
    expect(rows[1].user_name).toBe('Manan');
  });

  it('dedupes on (channel, slack_ts)', () => {
    const db = fresh();
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'x' })).not.toBe(null);
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'x again' })).toBe(null);
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C2', text: 'other channel' })).not.toBe(null);
    expect(recentMessages(db, 10).length).toBe(2);
  });

  it('is idempotent on existing DBs', () => {
    const db = fresh();
    ensureSlackTables(db); // second call: CREATE IF NOT EXISTS + column checks must not throw
    insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'x' });
    expect(recentMessages(db, 1)[0].text).toBe('x');
  });
});
```

Delete the two message tests from `apps/server/tests-bun/db.test.ts` (keep kv tests; drop now-unused `insertMessage, recentMessages` imports).

Run: `bun install && bun test packages/integrations/slack/tests-bun`
Expected: FAIL — `../src/store` does not exist.

- [ ] **Step 3: Write store.ts**

`packages/integrations/slack/src/store.ts` — move `MessageRow`, `InsertMessage`, `insertMessage`, `setUrgency`, `messagesAfter`, `channelMessages`, `lastMessageId`, `recentMessages` from `apps/server/src/db.ts` verbatim, plus schema ownership:

```ts
import { Database } from 'bun:sqlite';

// …MessageRow + InsertMessage interfaces moved verbatim from apps/server/src/db.ts…

/** Slack owns its tables: messages schema + additive urgency migrations. */
export function ensureSlackTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slack_ts TEXT NOT NULL,
      channel TEXT NOT NULL,
      channel_type TEXT,
      channel_name TEXT,
      user TEXT,
      user_name TEXT,
      text TEXT NOT NULL,
      thread_ts TEXT,
      team TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (channel, slack_ts)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_received ON messages (received_at DESC);
  `);
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(messages)`).all().map(c => c.name);
  if (!cols.includes('urgency')) db.exec(`ALTER TABLE messages ADD COLUMN urgency INTEGER`);
  if (!cols.includes('urgency_reason')) db.exec(`ALTER TABLE messages ADD COLUMN urgency_reason TEXT`);
}

// …insertMessage, setUrgency, messagesAfter, channelMessages, lastMessageId, recentMessages moved verbatim…
```

In `apps/server/src/db.ts`: delete the moved interfaces/functions, the messages CREATE TABLE + index from `openDb`, and the urgency PRAGMA migration block (openDb keeps WAL pragma, kv table, recordings table).

Run: `bun test packages/integrations/slack/tests-bun`
Expected: PASS.

- [ ] **Step 4: Write the manifest (src/index.ts)**

```ts
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { WebClient } from '@slack/web-api';
import type { IntegrationContext, IntegrationManifest } from '@assemble/core';
import { Llm, scoreUrgency, digestMessages, draftReply } from '@assemble/llm';
import { startSlack, type SlackIntake, type EnrichedMessage } from './intake';
import {
  ensureSlackTables, insertMessage, recentMessages, setUrgency,
  messagesAfter, channelMessages, lastMessageId, type MessageRow,
} from './store';

export * from './intake';
export * from './store';

let intake: SlackIntake | null = null;

const tokens = (ctx: IntegrationContext) => ({
  appToken: ctx.kv.get('slack_app_token') || process.env.SLACK_APP_TOKEN || '',
  botToken: ctx.kv.get('slack_bot_token') || process.env.SLACK_BOT_TOKEN || '',
});

const readyLlm = async (ctx: IntegrationContext) => (await ctx.llm()) as Llm | null;

async function scoreInBackground(ctx: IntegrationContext, id: number, m: EnrichedMessage) {
  const llm = await readyLlm(ctx);
  if (!llm) return;
  try {
    const verdict = await scoreUrgency(llm, m);
    setUrgency(ctx.db as Database, id, verdict.urgent, verdict.reason);
    if (verdict.urgent) {
      ctx.notify(`Slack · #${m.channelName ?? '?'}`, `${m.userName ?? 'Someone'}: ${m.text.slice(0, 120)} (${verdict.reason})`);
      ctx.broadcast({ kind: 'urgent', message: m, reason: verdict.reason });
    }
  } catch (err) {
    console.error('urgency scoring failed:', (err as Error).message);
  }
}

/** Digest of everything since the last digest cursor. Also used by voice intents. */
export async function runDigest(ctx: IntegrationContext): Promise<{ summary: string; count: number }> {
  const llm = await readyLlm(ctx);
  if (!llm) throw new Error('local AI is off — open Setup');
  const db = ctx.db as Database;
  const cursor = Number(ctx.kv.get('digest_cursor') || 0);
  const rows = messagesAfter(db, cursor, 200);
  const summary = await digestMessages(llm, rows.map(r => ({
    channelName: r.channel_name, userName: r.user_name, text: r.text,
  })));
  ctx.kv.set('digest_cursor', String(lastMessageId(db)));
  return { summary, count: rows.length };
}

export const slackIntegration: IntegrationManifest = {
  id: 'slack',
  name: 'Slack',
  description: 'Messages captured locally — urgency pings, digests, drafted replies.',
  icon: '<svg viewBox="0 0 16 16"><path d="M6 1v6M10 9v6M1 10h6M9 6h6" stroke-width="2" stroke-linecap="round"/></svg>',
  connectFields: [
    { key: 'slack_app_token', label: 'App token', placeholder: 'xapp-… app-level token', secret: true, help: 'api.slack.com → your app → Socket Mode on. Needs connections:write.' },
    { key: 'slack_bot_token', label: 'Bot token', placeholder: 'xoxb-… bot token', secret: true, help: 'Invite the bot to channels you want captured.' },
  ],

  async status() {
    return intake ? { connected: true, detail: 'socket open' } : { connected: false };
  },

  async start(ctx) {
    await this.stop();
    const { appToken, botToken } = tokens(ctx);
    if (!appToken || !botToken) throw new Error('Slack tokens missing');
    const db = ctx.db as Database;
    ensureSlackTables(db);
    intake = await startSlack({
      appToken, botToken,
      onMessage: m => {
        const id = insertMessage(db, m);
        if (id === null) return;
        console.log(`[${m.channelName ?? m.channel}] ${m.userName ?? m.user}: ${m.text.slice(0, 80)}`);
        ctx.broadcast({ kind: 'slack-message', message: m });
        void scoreInBackground(ctx, id, m);
      },
    });
    ctx.broadcast({ kind: 'slack-connected' });
  },

  async stop() {
    if (intake) { await intake.stop().catch(() => {}); intake = null; }
  },

  routes(ctx) {
    const db = ctx.db as Database;
    ensureSlackTables(db); // routes can be hit before first connect
    const app = new Hono();

    app.get('/recent', c => {
      const limit = Math.min(200, Number(c.req.query('limit') || 50));
      return c.json(recentMessages(db, limit));
    });

    app.post('/digest', async c => {
      try { return c.json(await runDigest(ctx)); }
      catch (err) { return c.json({ error: (err as Error).message }, 503); }
    });

    app.post('/draft', async c => {
      const llm = await readyLlm(ctx);
      if (!llm) return c.json({ error: 'local AI is off — open Setup' }, 503);
      const { channel, ts } = await c.req.json<{ channel: string; ts?: string }>();
      if (!channel) return c.json({ error: 'channel required' }, 400);
      const context = channelMessages(db, channel, 15);
      const target = (ts && context.find(m => m.slack_ts === ts)) || context[context.length - 1];
      if (!target) return c.json({ error: 'no messages in channel' }, 404);
      const toLike = (r: MessageRow) => ({ channelName: r.channel_name, userName: r.user_name, text: r.text });
      const draft = await draftReply(llm, context.map(toLike), toLike(target));
      return c.json({ draft, target: { channel: target.channel, ts: target.slack_ts, threadTs: target.thread_ts } });
    });

    app.post('/send', async c => {
      const { botToken } = tokens(ctx);
      if (!botToken) return c.json({ error: 'Slack not connected — open Setup' }, 503);
      const { channel, text, threadTs } = await c.req.json<{ channel: string; text: string; threadTs?: string }>();
      if (!channel || !text) return c.json({ error: 'channel and text required' }, 400);
      const res = await new WebClient(botToken).chat.postMessage({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) });
      return c.json({ ok: res.ok, ts: res.ts });
    });

    return app;
  },
};
```

- [ ] **Step 5: Interim rewire of the server (keeps it running until Task 4)**

`apps/server/src/index.ts`:
- Replace `import { startSlack, type SlackIntake } from './slack';` with `import { startSlack, type SlackIntake, ensureSlackTables, insertMessage, recentMessages, setUrgency, messagesAfter, channelMessages, lastMessageId } from '@assemble/integration-slack';`
- Remove those same names from the `./db` import (keep `openDb, kvGet, kvSet, insertRecording, updateRecording, listRecordings, getRecording`).
- After `const db = openDb(DB_PATH);` add `ensureSlackTables(db); // interim — Task 4 moves this into route mounting`.

`apps/server/package.json`: add `"@assemble/integration-slack": "workspace:*"` to dependencies (leave `@slack/*` deps for now — still imported by index.ts's WebClient; removed in Task 4).

- [ ] **Step 6: Verify green**

Run: `bun install && bun run typecheck && bun test && bun run test:bun`
Expected: all PASS (vitest picks up moved normalize test at new path).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(slack): extract @assemble/integration-slack package with manifest"
```

---

### Task 3: Linear integration package

**Files:**
- Create: `packages/integrations/linear/package.json`
- Create: `packages/integrations/linear/src/api.ts` (content of `packages/linear/src/index.ts`, verbatim)
- Create: `packages/integrations/linear/src/index.ts` (manifest)
- Create: `packages/integrations/linear/tests/linear.test.ts` (moved from `packages/linear/tests/linear.test.ts`, import → `../src/api`)
- Create: `packages/integrations/linear/tests/manifest.test.ts`
- Delete: `packages/linear/` (whole directory)
- Modify: `apps/server/src/index.ts` (import swap), `apps/server/package.json`

**Interfaces:**
- Consumes: `IntegrationManifest`, `IntegrationContext` from `@assemble/core`.
- Produces: package `@assemble/integration-linear` exporting `linearIntegration: IntegrationManifest`, `myIssues(apiKey, fetchFn?)`, `LinearIssue`.

- [ ] **Step 1: Move package, write failing manifest test**

`git mv packages/linear/src/index.ts` content → `packages/integrations/linear/src/api.ts`; `git mv packages/linear/tests/linear.test.ts packages/integrations/linear/tests/linear.test.ts` (import → `../src/api`); delete `packages/linear`.

`packages/integrations/linear/package.json`:

```json
{
  "name": "@assemble/integration-linear",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@assemble/core": "workspace:*",
    "hono": "^4.0.0"
  }
}
```

`packages/integrations/linear/tests/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { IntegrationContext } from '@assemble/core';
import { linearIntegration } from '../src/index';

const ctx = (key: string | null): IntegrationContext => ({
  kv: { get: k => (k === 'linear_api_key' ? key : null), set: () => {}, del: () => {} },
  db: null,
  broadcast: () => {},
  llm: async () => null,
  notify: () => {},
});

describe('linear manifest', () => {
  it('has catalog metadata', () => {
    expect(linearIntegration.id).toBe('linear');
    expect(linearIntegration.icon).toContain('<svg');
    expect(linearIntegration.connectFields[0].key).toBe('linear_api_key');
  });

  it('status is disconnected without a key', async () => {
    delete process.env.LINEAR_API_KEY;
    const s = await linearIntegration.status(ctx(null));
    expect(s.connected).toBe(false);
  });

  it('start throws without a key', async () => {
    delete process.env.LINEAR_API_KEY;
    await expect(linearIntegration.start(ctx(null))).rejects.toThrow('Linear key missing');
  });
});
```

Run: `bun install && bun test packages/integrations/linear`
Expected: manifest.test FAILS (`../src/index` missing); linear.test PASSES.

- [ ] **Step 2: Write the manifest (src/index.ts)**

```ts
import { Hono } from 'hono';
import type { IntegrationContext, IntegrationManifest } from '@assemble/core';
import { myIssues } from './api';

export * from './api';

const apiKey = (ctx: IntegrationContext) => ctx.kv.get('linear_api_key') || process.env.LINEAR_API_KEY || '';

export const linearIntegration: IntegrationManifest = {
  id: 'linear',
  name: 'Linear',
  description: 'Your assigned issues, one click away from a Claude Code session.',
  icon: '<svg viewBox="0 0 16 16"><path d="M1 9.5L6.5 15M1 5.5L10.5 15M2 2l12 12M5.5 1L15 10.5" stroke-width="1.6" stroke-linecap="round"/></svg>',
  connectFields: [
    { key: 'linear_api_key', label: 'API key', placeholder: 'lin_api_…', secret: true, help: 'linear.app → Settings → API → personal key.' },
  ],

  async status(ctx) {
    const key = apiKey(ctx);
    if (!key) return { connected: false };
    try {
      const issues = await myIssues(key);
      return { connected: true, detail: `${issues.length} open issues` };
    } catch (err) {
      return { connected: false, detail: (err as Error).message };
    }
  },

  // Pull-based: nothing runs in the background. start() just validates the key.
  async start(ctx) {
    const key = apiKey(ctx);
    if (!key) throw new Error('Linear key missing');
    await myIssues(key);
  },

  async stop() {},

  routes(ctx) {
    const app = new Hono();
    app.get('/issues', async c => {
      const key = apiKey(ctx);
      if (!key) return c.json({ error: 'Linear not connected — open Settings → Integrations' }, 503);
      try { return c.json(await myIssues(key)); }
      catch (err) { return c.json({ error: (err as Error).message }, 502); }
    });
    return app;
  },
};
```

- [ ] **Step 3: Interim server rewire**

`apps/server/src/index.ts`: change `import { myIssues } from '@assemble/linear';` → `import { myIssues } from '@assemble/integration-linear';`.
`apps/server/package.json`: replace `"@assemble/linear": "workspace:*"` with `"@assemble/integration-linear": "workspace:*"`.

- [ ] **Step 4: Verify green**

Run: `bun install && bun run typecheck && bun test && bun run test:bun`
Expected: PASS (vitest finds linear tests at new path only).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(linear): move to @assemble/integration-linear with manifest"
```

---

### Task 4: Server registry + generic endpoints

**Files:**
- Create: `apps/server/src/integrations.ts`
- Test: `apps/server/tests-bun/integrations.test.ts`
- Modify: `apps/server/src/index.ts` (add generic endpoints; delete `/slack/*`, `/linear/*`, `/setup/slack`, `/setup/linear`, `restartSlack`, `scoreInBackground`, `runDigest`, `slackTokens`, `webClient`, `slackConnected`, `slackIntake`; rewire boot, `/reset`, `/setup/status`, `/health`, voice digest)
- Modify: `apps/server/package.json` (drop `@slack/socket-mode`, `@slack/web-api` — now only in the slack package)

**Interfaces:**
- Consumes: `slackIntegration`, `runDigest` from `@assemble/integration-slack`; `linearIntegration` from `@assemble/integration-linear`; core types.
- Produces (from `apps/server/src/integrations.ts`):
  - `registry: IntegrationManifest[]`
  - `listIntegrations(ctx): Promise<IntegrationInfo[]>` where `IntegrationInfo = { id, name, description, icon, connected, detail?, fields: { key, label, placeholder, secret, help?, saved: boolean }[] }`
  - `connectIntegration(ctx, id, values: Record<string, string>): Promise<IntegrationStatus>` (throws on unknown id / failed start)
  - `disconnectIntegration(ctx, id): Promise<void>` (stops + deletes kv keys; throws on unknown id)
  - `startConfigured(ctx): Promise<void>` (boot; start errors logged, not thrown)
  - `stopAll(): Promise<void>`
- HTTP surface (consumed by Task 5): `GET /integrations`, `POST /integrations/:id/connect` (body = `{ [kvKey]: value }`), `POST /integrations/:id/disconnect`, mounted sub-routes `/integrations/slack/recent|digest|draft|send`, `/integrations/linear/issues`. WS kind `integration-changed` with `{ id, connected }`.

- [ ] **Step 1: Write failing registry tests**

`apps/server/tests-bun/integrations.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { IntegrationContext, IntegrationManifest } from '@assemble/core';
import { registry, connectIntegration, disconnectIntegration } from '../src/integrations';

function makeCtx(): IntegrationContext {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)`);
  return {
    kv: {
      get: k => (db.query<{ value: string }, [string]>(`SELECT value FROM kv WHERE key = ?`).get(k)?.value ?? null),
      set: (k, v) => db.run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]),
      del: k => db.run(`DELETE FROM kv WHERE key = ?`, [k]),
    },
    db, broadcast: () => {}, llm: async () => null, notify: () => {},
  };
}

describe('registry', () => {
  it('has unique ids, fields, and svg icons', () => {
    const ids = registry.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of registry) {
      expect(m.connectFields.length).toBeGreaterThan(0);
      expect(m.icon).toContain('<svg');
      expect(m.name.length).toBeGreaterThan(0);
    }
  });

  it('connect saves fields, starts, and reports status; disconnect stops and clears', async () => {
    const ctx = makeCtx();
    let started = 0, stopped = 0;
    const fake: IntegrationManifest = {
      id: 'fake', name: 'Fake', description: '', icon: '<svg/>',
      connectFields: [{ key: 'fake_token', label: 'Token', placeholder: 't', secret: true }],
      status: async c => ({ connected: Boolean(c.kv.get('fake_token')) && started > stopped }),
      start: async c => { if (!c.kv.get('fake_token')) throw new Error('missing'); started++; },
      stop: async () => { stopped++; },
      routes: () => null,
    };
    registry.push(fake);
    try {
      const s = await connectIntegration(ctx, 'fake', { fake_token: '  abc  ' });
      expect(s.connected).toBe(true);
      expect(ctx.kv.get('fake_token')).toBe('abc'); // trimmed
      expect(started).toBe(1);

      await disconnectIntegration(ctx, 'fake');
      expect(stopped).toBeGreaterThan(0);
      expect(ctx.kv.get('fake_token')).toBe(null);
    } finally {
      registry.pop();
    }
  });

  it('connect rejects unknown id and failed start', async () => {
    const ctx = makeCtx();
    await expect(connectIntegration(ctx, 'nope', {})).rejects.toThrow('unknown integration');
    // bun auto-loads .env — blank the fallbacks so slack start fails fast without tokens
    process.env.SLACK_APP_TOKEN = '';
    process.env.SLACK_BOT_TOKEN = '';
    await expect(connectIntegration(ctx, 'slack', {})).rejects.toThrow();
  });
});
```

Run: `bun test apps/server/tests-bun/integrations.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: Write integrations.ts**

```ts
import type { IntegrationContext, IntegrationManifest, IntegrationStatus } from '@assemble/core';
import { slackIntegration } from '@assemble/integration-slack';
import { linearIntegration } from '@assemble/integration-linear';

// Adding an integration = new package + one entry here.
export const registry: IntegrationManifest[] = [slackIntegration, linearIntegration];

const find = (id: string): IntegrationManifest => {
  const m = registry.find(x => x.id === id);
  if (!m) throw new Error(`unknown integration: ${id}`);
  return m;
};

export interface IntegrationInfo {
  id: string; name: string; description: string; icon: string;
  connected: boolean; detail?: string;
  fields: { key: string; label: string; placeholder: string; secret: boolean; help?: string; saved: boolean }[];
}

export function listIntegrations(ctx: IntegrationContext): Promise<IntegrationInfo[]> {
  return Promise.all(registry.map(async m => {
    const s = await m.status(ctx).catch((err): IntegrationStatus => ({ connected: false, detail: (err as Error).message }));
    return {
      id: m.id, name: m.name, description: m.description, icon: m.icon,
      connected: s.connected, detail: s.detail,
      fields: m.connectFields.map(f => ({ ...f, saved: Boolean(ctx.kv.get(f.key)) })),
    };
  }));
}

export async function connectIntegration(ctx: IntegrationContext, id: string, values: Record<string, string>): Promise<IntegrationStatus> {
  const m = find(id);
  for (const f of m.connectFields) {
    const v = values[f.key]?.trim();
    if (v) ctx.kv.set(f.key, v);
  }
  await m.start(ctx); // throws if still missing fields or the service rejects them
  return m.status(ctx);
}

export async function disconnectIntegration(ctx: IntegrationContext, id: string): Promise<void> {
  const m = find(id);
  await m.stop().catch(() => {});
  for (const f of m.connectFields) ctx.kv.del(f.key);
}

/** Boot: start whatever is already configured; failures log, never crash. */
export async function startConfigured(ctx: IntegrationContext): Promise<void> {
  for (const m of registry) {
    try { await m.start(ctx); }
    catch (err) { console.warn(`${m.id}: not started — ${(err as Error).message}`); }
  }
}

export async function stopAll(): Promise<void> {
  for (const m of registry) await m.stop().catch(() => {});
}
```

Run: `bun test apps/server/tests-bun`
Expected: PASS.

- [ ] **Step 3: Rewire index.ts**

In `apps/server/src/index.ts`:

1. Imports: drop `WebClient` from `@slack/web-api`; from `@assemble/integration-slack` import only `{ runDigest }`; drop `myIssues` import; drop `scoreUrgency, digestMessages, draftReply` from the `@assemble/llm` import (keep `Llm, summarizeCall, parseIntent`); drop `insertMessage, recentMessages, setUrgency, messagesAfter, channelMessages, lastMessageId, ensureSlackTables` (and the interim `ensureSlackTables(db)` call); add:
```ts
import type { Hono as HonoApp } from 'hono';
import type { IntegrationContext } from '@assemble/core';
import { registry, listIntegrations, connectIntegration, disconnectIntegration, startConfigured, stopAll } from './integrations';
```
2. Delete: `slackTokens`, `slackConnected`, `slackIntake`, `webClient`, `restartSlack`, `scoreInBackground`, the local `runDigest`, handlers for `/slack/recent`, `/slack/digest`, `/slack/draft`, `/slack/send`, `/linear/issues`, `/setup/slack`, `/setup/linear`, and the `linearKey` helper.
3. After `const agents = new AgentRunner();` add the context (function `broadcast` is hoisted, so this is safe):
```ts
const ctx: IntegrationContext = {
  kv: { get: k => kvGet(db, k), set: (k, v) => kvSet(db, k, v), del: k => kvDel(db, k) },
  db,
  broadcast,
  llm: async () => ((await llmReady()) ? llm : null),
  notify: notifyMac,
};
```
(add `kvDel` to the `./db` import.)
4. New endpoints (place where the old slack block was):
```ts
/* ================= integrations ================= */

app.get('/integrations', async c => c.json(await listIntegrations(ctx)));

app.post('/integrations/:id/connect', async c => {
  const id = c.req.param('id');
  try {
    const status = await connectIntegration(ctx, id, await c.req.json<Record<string, string>>());
    broadcast({ kind: 'integration-changed', id, connected: status.connected });
    return c.json(status);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post('/integrations/:id/disconnect', async c => {
  const id = c.req.param('id');
  try {
    await disconnectIntegration(ctx, id);
    broadcast({ kind: 'integration-changed', id, connected: false });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

for (const m of registry) app.route(`/integrations/${m.id}`, m.routes(ctx) as HonoApp);
```
5. `/health`: replace `slack: slackConnected,` with nothing (drop the field).
6. `/setup/status`: drop `slackConfigured`, `slackConnected`, `linearConfigured` fields.
7. `/reset`: replace `await restartSlack();` with `await stopAll();`.
8. Voice `case 'digest'`: replace `const d = await runDigest();` with `const d = await runDigest(ctx);` (error text now comes from the throw and lands in the existing catch).
9. Boot: replace `void restartSlack();` with `void startConfigured(ctx);`.
10. `apps/server/package.json`: remove `"@slack/socket-mode"` and `"@slack/web-api"` dependencies.

- [ ] **Step 4: Verify green + smoke**

Run: `bun install && bun run typecheck && bun test && bun run test:bun`
Then smoke: `bun run server` in background; `curl -s http://127.0.0.1:4817/integrations | head -c 400` → JSON array with slack + linear entries, `connected: false` fresh; `curl -s http://127.0.0.1:4817/integrations/slack/recent` → `[]`; `curl -s -X POST http://127.0.0.1:4817/integrations/nope/connect -H 'Content-Type: application/json' -d '{}'` → 400 `unknown integration`. Kill server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): integration registry + generic /integrations endpoints, drop hardcoded slack/linear routes"
```

---

### Task 5: Renderer — dynamic nav + integrations catalog

**Files:**
- Modify: `apps/desktop/src/renderer/renderer.ts`
- Modify: `apps/desktop/src/renderer/styles.css` (only if the new catalog card needs it — reuse `.setup-inputs`, `.model-select`, `.setting-row` classes first)

**Interfaces:**
- Consumes: `GET /integrations` → `IntegrationInfo[]` (Task 4 shape), `POST /integrations/:id/connect|disconnect`, moved data routes `/integrations/slack/*`, `/integrations/linear/issues`, WS `integration-changed`.
- Produces: UI only. Behavior contract:
  - Sidebar = Desk, [connected integrations with a page], Calls, Work, Activity, Settings.
  - Settings tab `connections` is renamed to **Integrations** and shows the catalog; onboarding `stepConnect` shows the same catalog.
  - Work page's Linear pane renders only when linear is connected.

- [ ] **Step 1: State + fetch**

In `renderer.ts`:
- Add to interfaces near the top:
```ts
interface IntegrationField { key: string; label: string; placeholder: string; secret: boolean; help?: string; saved: boolean }
interface IntegrationInfo {
  id: string; name: string; description: string; icon: string;
  connected: boolean; detail?: string; fields: IntegrationField[];
}
```
- Add to `state`: `integrations: [] as IntegrationInfo[],`
- Add helper + fetch:
```ts
const integrationById = (id: string) => state.integrations.find(i => i.id === id);

async function fetchIntegrations(): Promise<void> {
  try { state.integrations = await (await fetch(`${SERVER}/integrations`)).json(); }
  catch { state.integrations = []; }
}
```
- In `init()`, before `setMode(...)`: `await fetchIntegrations();`

- [ ] **Step 2: Dynamic nav**

- Change `type Page = 'desk' | 'slack' | 'calls' | 'work' | 'activity' | 'settings';` to `type Page = string;`
- Replace the `NAV` const + `renderApp` + `setPage` trio:
```ts
const CORE_NAV: { page: string; label: string; icon: string }[] = [
  { page: 'desk', label: 'Desk', icon: '…(unchanged desk svg)…' },
  { page: 'calls', label: 'Calls', icon: '…(unchanged)…' },
  { page: 'work', label: 'Work', icon: '…(unchanged)…' },
  { page: 'activity', label: 'Activity', icon: '…(unchanged)…' },
  { page: 'settings', label: 'Settings', icon: '…(unchanged)…' },
];

// Integration pages are client-side modules keyed by manifest id.
const INTEGRATION_PAGES: Record<string, () => void> = { slack: pageSlack };

function navItems() {
  const integrations = state.integrations
    .filter(i => i.connected && INTEGRATION_PAGES[i.id])
    .map(i => ({ page: i.id, label: i.name, icon: i.icon }));
  // integrations sit between Desk and Calls — same spot Slack always lived
  return [CORE_NAV[0], ...integrations, ...CORE_NAV.slice(1)];
}

function renderApp() {
  $('#screen').innerHTML = `
    <div class="shell">
      <nav class="sidenav">
        ${navItems().map(n => `
          <button class="nav-item" data-page="${n.page}">
            ${n.icon}<span>${n.label}</span>
          </button>`).join('')}
      </nav>
      <main class="page" id="page"></main>
    </div>`;
  document.querySelectorAll('.nav-item').forEach(el => {
    (el as HTMLElement).onclick = () => setPage((el as HTMLElement).dataset.page!);
  });
  if (!navItems().some(n => n.page === state.page)) state.page = 'desk';
  setPage(state.page);
}

function setPage(page: string) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', (el as HTMLElement).dataset.page === page));
  const el = $('#page');
  el.classList.remove('page-in');
  void el.offsetWidth;
  el.classList.add('page-in');
  const core: Record<string, () => void> = { desk: pageDesk, calls: pageCalls, work: pageWork, activity: pageActivity, settings: pageSettings };
  (core[page] ?? INTEGRATION_PAGES[page] ?? pageDesk)();
}
```

- [ ] **Step 3: Integrations catalog component (shared)**

Add (replacing `connectSlackTokens` + `connectLinearKey`, which are deleted):

```ts
async function renderIntegrationsCatalog(container: HTMLElement) {
  await fetchIntegrations();
  container.innerHTML = '';
  for (const info of state.integrations) {
    const card = document.createElement('div');
    card.className = 'setup-inputs';
    card.innerHTML = `
      <b><span class="int-icon">${info.icon}</span> ${info.name}</b>
      <span class="hint">${info.description}</span>
      ${info.fields.map(f => `
        ${f.help ? `<span class="hint">${f.help}</span>` : ''}
        <input data-key="${f.key}" type="${f.secret ? 'password' : 'text'}"
          placeholder="${f.saved ? `${f.label} saved — paste to replace` : f.placeholder}" />`).join('')}
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="secondary int-connect">${info.connected ? 'Reconnect' : 'Connect'}</button>
        ${info.connected ? '<button class="quiet-link int-disconnect">Disconnect</button>' : ''}
        <span class="hint int-status">${info.connected ? `Connected${info.detail ? ` — ${info.detail}` : ''}.` : (info.detail ?? '')}</span>
      </div>`;
    const status = card.querySelector('.int-status') as HTMLElement;
    (card.querySelector('.int-connect') as HTMLElement).onclick = async () => {
      const values: Record<string, string> = {};
      card.querySelectorAll('input[data-key]').forEach(el => {
        const input = el as HTMLInputElement;
        if (input.value.trim()) values[input.dataset.key!] = input.value.trim();
      });
      status.textContent = 'Connecting…';
      try {
        const r = await fetch(`${SERVER}/integrations/${info.id}/connect`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
        });
        const data = await r.json();
        status.textContent = r.ok ? `Connected${data.detail ? ` — ${data.detail}` : ''}.` : `Failed: ${data.error}`;
        if (r.ok) { await fetchIntegrations(); if (state.mode === 'app') renderApp(); }
      } catch { status.textContent = 'Local server unreachable.'; }
    };
    const disc = card.querySelector('.int-disconnect') as HTMLElement | null;
    if (disc) disc.onclick = async () => {
      if (!confirm(`Disconnect ${info.name}? Its saved tokens are deleted.`)) return;
      try {
        await fetch(`${SERVER}/integrations/${info.id}/disconnect`, { method: 'POST' });
        await fetchIntegrations();
        if (state.mode === 'app') { renderApp(); if (state.page === 'settings') void renderIntegrationsCatalog($('#tab-body')); }
        else void renderIntegrationsCatalog(container);
      } catch { status.textContent = 'Local server unreachable.'; }
    };
    container.appendChild(card);
  }
  if (!state.integrations.length) container.innerHTML = '<span class="hint">Local server offline — integrations unavailable.</span>';
}
```

Add small CSS in `styles.css` for the icon inline sizing:

```css
.int-icon svg { width: 14px; height: 14px; vertical-align: -2px; stroke: currentColor; fill: none; }
```

- [ ] **Step 4: Wire catalog into wizard + settings**

- `stepConnect()` body becomes:
```ts
function stepConnect() {
  const body = $('#setup-body');
  body.innerHTML = `
    <div class="eyebrow">step 4 · connect</div>
    <h1>Wire in your work.</h1>
    <p class="lede">Optional — connect the services you use. Each one shows up in the sidebar once connected.</p>
    <div id="int-catalog"></div>`;
  void renderIntegrationsCatalog($('#int-catalog'));
  stepFooter(body);
}
```
- `type SettingsTab`: rename `'connections'` → `'integrations'`; TABS entry becomes `{ id: 'integrations', label: 'Integrations' }`; if `state.settingsTab` currently `'connections'` anywhere, update.
- In `renderSettingsTab()`, replace the whole `if (state.settingsTab === 'connections') { … }` block with:
```ts
  if (state.settingsTab === 'integrations') {
    body.innerHTML = `<p class="hint">Connected services show up in the sidebar. Tokens live only in the local database.</p><div id="int-catalog"></div>`;
    void renderIntegrationsCatalog($('#int-catalog'));
  }
```
- In `refreshSetupStatus()`: delete the `slackStatus` and `linearStatus` blocks (fields no longer returned).

- [ ] **Step 5: Endpoint path updates + gated Work pane + WS**

- Path swaps (exact): `/slack/draft` → `/integrations/slack/draft`; `/slack/send` → `/integrations/slack/send`; `/slack/digest` → `/integrations/slack/digest`; `/slack/recent?limit=20` → `/integrations/slack/recent?limit=20`; `/linear/issues` → `/integrations/linear/issues`.
- `pageWork()`: wrap the Linear pane markup:
```ts
    ${integrationById('linear')?.connected ? `
    <div class="pane">
      <div class="pane-toolbar"><b class="pane-title">Linear</b><span id="linear-status" class="pane-status"></span></div>
      <ul id="linear-list" class="feed"></ul>
    </div>` : ''}
```
and call `void refreshLinear();` only when connected: `if (integrationById('linear')?.connected) void refreshLinear();`
- `openWs()` onmessage — add:
```ts
    if (payload.kind === 'integration-changed') {
      void fetchIntegrations().then(() => { if (state.mode === 'app') renderApp(); });
    }
```
- `wipeEverything()` confirm text: replace "Slack & Linear tokens" with "integration tokens".

- [ ] **Step 6: Verify + manual smoke**

Run: `bun run typecheck && bun test && bun run test:bun`
Then `bun start`: fresh-ish config → sidebar has no Slack entry when disconnected; Settings → Integrations shows both cards; wizard Connect step shows the same catalog. (Full connect flow needs real tokens — visual check only.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(desktop): config-driven sidebar + integrations catalog in settings and onboarding"
```

---

### Task 6: Docs + final sweep

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-25-integrations-restructure-design.md` (status line → implemented; note `linear_api_key` correction)

**Interfaces:** none — documentation.

- [ ] **Step 1: README updates**

- Development tree section: replace `packages/linear` line and add:
```
packages/integrations       pluggable third-party connectors — hidden until connected
packages/integrations/slack   Socket Mode intake, digests, drafts + manifest
packages/integrations/linear  assigned issues + manifest
```
- Slack section (`### Slack`): mention tokens are pasted in **Settings → Integrations** (or onboarding Connect step); catalog shows each service, sidebar entries appear only when connected.
- Work section: note the Linear pane appears once Linear is connected in Settings → Integrations.
- Add a short "Integrations" paragraph under Development: an integration is one package under `packages/integrations/` exporting a manifest (`connectFields`, `start/stop`, `status`, `routes`) plus one line in `apps/server/src/integrations.ts`; UI appears automatically from the manifest.

- [ ] **Step 2: Full suite + typecheck**

Run: `bun run typecheck && bun test && bun run test:bun`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: integrations architecture in README, spec marked implemented"
```
