import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';

export interface NormalizedMessage {
  slackTs: string;
  channel: string;
  channelType: string | null;
  user: string | null;
  text: string;
  threadTs: string | null;
  team: string | null;
  /** Display name for bot/webhook posts (no user id to resolve). */
  botName?: string | null;
}

// Subtypes worth keeping: humans (none), cross-posted thread replies, and
// bot/webhook posts — automations post via webhooks and must be visible.
const KEPT_SUBTYPES = new Set(['thread_broadcast', 'bot_message']);

export interface EnrichedMessage extends NormalizedMessage {
  userName: string | null;
  channelName: string | null;
  /** Message written by the token's owner. */
  isSelf?: boolean;
}

// Pure: one conversations.history entry → normalized message, or null for
// noise (joins, edits, bot housekeeping). Thread broadcasts kept.
export function normalizeHistoryMessage(
  msg: any,
  channel: string,
  channelType: string | null,
  team?: string | null,
): NormalizedMessage | null {
  if (!msg || msg.type !== 'message') return null;
  if (msg.subtype && !KEPT_SUBTYPES.has(msg.subtype)) return null;
  if (!msg.text || !msg.ts) return null;
  return {
    slackTs: String(msg.ts),
    channel,
    channelType,
    user: msg.user ?? null,
    text: String(msg.text),
    threadTs: msg.thread_ts ?? null,
    team: team ?? null,
    botName: msg.subtype === 'bot_message' ? (msg.username ?? 'bot') : null,
  };
}

export interface SlackIntake {
  stop: () => Promise<void>;
  /** 'push' = Socket Mode events (instant), 'poll' = history polling fallback. */
  mode: 'push' | 'poll';
}

// Pure: one Events-API message event → normalized message, or null for noise.
export function normalizeEvent(event: any, team?: string | null): NormalizedMessage | null {
  if (!event || event.type !== 'message') return null;
  if (event.subtype && !KEPT_SUBTYPES.has(event.subtype)) return null;
  if (!event.text || !event.ts || !event.channel) return null;
  return {
    slackTs: String(event.ts),
    channel: String(event.channel),
    channelType: event.channel_type ?? null,
    user: event.user ?? null,
    text: String(event.text),
    threadTs: event.thread_ts ?? null,
    team: team ?? null,
    botName: event.subtype === 'bot_message' ? (event.username ?? 'bot') : null,
  };
}

interface Convo {
  id: string;
  name: string | null;
  type: 'channel' | 'group' | 'im' | 'mpim';
}

// Widest type set the token's scopes allow — im needs im:read, mpim needs
// mpim:read; degrade instead of failing the whole connect.
const TYPE_SETS = [
  'public_channel,private_channel,im,mpim',
  'public_channel,private_channel,mpim',
  'public_channel,private_channel',
];

async function listConversations(web: WebClient): Promise<Convo[]> {
  for (const types of TYPE_SETS) {
    try {
      const out: Convo[] = [];
      let cursor: string | undefined;
      do {
        const r: any = await web.users.conversations({ types, limit: 200, exclude_archived: true, cursor });
        for (const c of r.channels ?? []) {
          out.push({
            id: String(c.id),
            name: c.is_im ? null : (c.name ?? null),
            type: c.is_im ? 'im' : c.is_mpim ? 'mpim' : c.is_private ? 'group' : 'channel',
          });
        }
        cursor = r.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return out;
    } catch (err) {
      if ((err as any)?.data?.error === 'missing_scope' && types !== TYPE_SETS[TYPE_SETS.length - 1]) continue;
      throw err;
    }
  }
  return [];
}

/**
 * Intake on a user token (xoxp) — everything the user can read, no bot, no
 * invites, new messages only (never history).
 *
 * Two transports:
 * - `appToken` (xapp-, Socket Mode) present → PUSH: Slack delivers message
 *   events instantly over an outbound WebSocket, exactly like an Events-API
 *   webhook but with no public URL. Channels don't matter — one pipe.
 * - otherwise → POLL fallback: budgeted per-channel history polling.
 *
 * Duplicate delivery is fine — the store dedupes on (channel, ts).
 */
export async function startSlack({
  userToken,
  appToken = '',
  onMessage,
  log = console.log,
  pollMs = 2_000,
  coldMs = 15_000,
  hotWindowMs = 60 * 60_000,
  callsPerMinute = 45,
}: {
  userToken: string;
  /** Optional xapp- Socket Mode token — enables instant push instead of polling. */
  appToken?: string;
  onMessage: (m: EnrichedMessage) => void;
  log?: (msg: string) => void;
  /** Target cadence for DMs and recently-active channels. */
  pollMs?: number;
  /** Target cadence for quiet channels — every channel is always polled. */
  coldMs?: number;
  /** A channel counts as hot for this long after its last message. */
  hotWindowMs?: number;
  /** Global API budget — stays under Slack's ~50/min tier so nothing stalls on 429. */
  callsPerMinute?: number;
}): Promise<SlackIntake> {
  if (!userToken.startsWith('xoxp-')) {
    throw new Error('user token must start with xoxp- (api.slack.com → your app → OAuth & Permissions → User OAuth Token)');
  }
  const web = new WebClient(userToken);
  let auth: any;
  try {
    auth = await web.auth.test();
  } catch (err) {
    throw new Error(`token rejected by Slack: ${(err as Error).message}`);
  }
  const team: string | null = auth.team_id ?? null;
  const self = String(auth.user_id ?? '');

  const userNames = new Map<string, string | null>();
  async function userName(id: string | null): Promise<string | null> {
    if (!id) return null;
    if (!userNames.has(id)) {
      try {
        const r = await web.users.info({ user: id });
        userNames.set(id, r.user?.real_name || r.user?.name || null);
      } catch { userNames.set(id, null); }
    }
    return userNames.get(id) ?? null;
  }
  const channelNames = new Map<string, string | null>();
  async function channelName(id: string): Promise<string | null> {
    if (!channelNames.has(id)) {
      try {
        const r = await web.conversations.info({ channel: id });
        channelNames.set(id, r.channel?.name ?? null);
      } catch { channelNames.set(id, null); }
    }
    return channelNames.get(id) ?? null;
  }

  /* ---- push transport: Socket Mode, like slack-receiver's webhook but local ---- */
  if (appToken) {
    if (!appToken.startsWith('xapp-')) {
      throw new Error('app token must start with xapp- (Basic Information → App-Level Tokens, scope connections:write)');
    }
    const socket = new SocketModeClient({ appToken });
    socket.on('message', async ({ event, body, ack }: any) => {
      await ack();
      const norm = normalizeEvent(event, body?.team_id ?? team);
      if (!norm) return;
      onMessage({
        ...norm,
        userName: norm.user ? await userName(norm.user) : norm.botName ?? null,
        channelName: norm.channelType === 'im' ? 'DM' : await channelName(norm.channel),
        isSelf: norm.user === self,
      });
    });
    socket.on('connected', () => log('slack: socket connected — push mode'));
    socket.on('disconnected', () => log('slack: socket disconnected'));
    try {
      await Promise.race([
        socket.start(),
        new Promise((_, reject) => setTimeout(() =>
          reject(new Error('Slack socket timed out — enable Socket Mode on the app and check the xapp token has connections:write')), 15_000)),
      ]);
    } catch (err) {
      await socket.disconnect().catch(() => {});
      throw err;
    }
    return { mode: 'push', stop: () => socket.disconnect() };
  }

  /* ---- poll transport: budgeted per-channel history polling ---- */
  let convos = await listConversations(web);
  log(`slack: watching ${convos.length} conversations as ${auth.user ?? self} (poll mode)`);

  const lastSeen = new Map<string, string>(); // channel id → newest ts already fetched
  const lastActivity = new Map<string, number>(); // channel id → ms epoch of last message
  const lastPolled = new Map<string, number>(); // channel id → ms epoch of last poll
  let stopped = false;
  let ticking = false;
  let tick = 0;

  const isHot = (c: Convo) =>
    c.type === 'im' || c.type === 'mpim' ||
    Date.now() - (lastActivity.get(c.id) ?? 0) < hotWindowMs;

  // Token bucket keeps total API calls under Slack's rate tier — hot channels
  // get their 2s cadence first, quiet ones share whatever budget remains.
  const bucket = { tokens: callsPerMinute, last: Date.now() };
  function takeToken(): boolean {
    const now = Date.now();
    bucket.tokens = Math.min(callsPerMinute, bucket.tokens + ((now - bucket.last) * callsPerMinute) / 60_000);
    bucket.last = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  async function pollChannel(c: Convo) {
    const oldest = lastSeen.get(c.id);
    if (!oldest) {
      // first visit: set the cursor to the newest message and emit nothing —
      // we listen for new messages only, never history
      const r: any = await web.conversations.history({ channel: c.id, limit: 1 });
      const newestTs = r.messages?.[0]?.ts;
      lastSeen.set(c.id, String(newestTs ?? '0'));
      if (newestTs) lastActivity.set(c.id, Number(newestTs) * 1000);
      return;
    }
    const r: any = await web.conversations.history({
      channel: c.id,
      limit: 50,
      oldest, // exclusive — only strictly newer messages
    });
    const newest = r.messages?.[0]?.ts;
    for (const raw of (r.messages ?? []).slice().reverse()) {
      const norm = normalizeHistoryMessage(raw, c.id, c.type, team);
      if (!norm) continue;
      lastActivity.set(c.id, Date.now());
      onMessage({
        ...norm,
        userName: norm.user ? await userName(norm.user) : norm.botName ?? null,
        channelName: c.type === 'im' ? 'DM' : c.name,
        isSelf: norm.user === self,
      });
    }
    if (newest && newest > oldest) lastSeen.set(c.id, String(newest));
  }

  async function poll() {
    if (stopped || ticking) return; // never overlap sweeps
    ticking = true;
    try {
      tick++;
      if (tick % 600 === 0) convos = await listConversations(web).catch(() => convos); // refresh list ~10 min
      const now = Date.now();
      // every channel is always in rotation — hot ones aim for pollMs, quiet
      // ones for coldMs; most-starved first, all bounded by the token bucket
      const due = convos
        .filter(c => now - (lastPolled.get(c.id) ?? 0) >= (isHot(c) ? pollMs : coldMs))
        .sort((a, b) => (lastPolled.get(a.id) ?? 0) - (lastPolled.get(b.id) ?? 0));
      for (const c of due) {
        if (stopped || !takeToken()) break;
        lastPolled.set(c.id, Date.now());
        await pollChannel(c).catch(err =>
          log(`slack: poll ${c.name ?? c.id} failed — ${(err as any)?.data?.error ?? (err as Error).message}`));
      }
    } finally {
      ticking = false;
    }
  }

  // First sweep just plants cursors; runs in the background so connect
  // returns as soon as the token and conversation list check out.
  void poll().then(() => log('slack: listening for new messages'));
  const timer = setInterval(() => void poll(), 1_000);
  return {
    mode: 'poll',
    stop: async () => { stopped = true; clearInterval(timer); },
  };
}
