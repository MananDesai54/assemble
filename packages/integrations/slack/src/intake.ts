import { WebClient } from '@slack/web-api';

export interface NormalizedMessage {
  slackTs: string;
  channel: string;
  channelType: string | null;
  user: string | null;
  text: string;
  threadTs: string | null;
  team: string | null;
}

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
  if (msg.subtype && msg.subtype !== 'thread_broadcast') return null;
  if (!msg.text || !msg.ts) return null;
  return {
    slackTs: String(msg.ts),
    channel,
    channelType,
    user: msg.user ?? null,
    text: String(msg.text),
    threadTs: msg.thread_ts ?? null,
    team: team ?? null,
  };
}

export interface SlackIntake {
  stop: () => Promise<void>;
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
 * Poll-based intake on a user token (xoxp): watches every conversation the
 * user is a member of — no bot invites, no Socket Mode, no public URL.
 * Listens for NEW messages only: the first visit to a channel just sets the
 * cursor to its newest message, nothing historical is fetched or stored.
 * Duplicate delivery is fine — the store dedupes on (channel, ts).
 */
export async function startSlack({
  userToken,
  onMessage,
  log = console.log,
  pollMs = 2_000,
  fullSweepEvery = 30,
  hotWindowMs = 10 * 60_000,
}: {
  userToken: string;
  onMessage: (m: EnrichedMessage) => void;
  log?: (msg: string) => void;
  /** Fast tick — polls DMs and recently-active channels. */
  pollMs?: number;
  /** Every Nth tick polls ALL conversations (catches quiet channels waking up). */
  fullSweepEvery?: number;
  /** A channel counts as hot for this long after its last message. */
  hotWindowMs?: number;
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

  let convos = await listConversations(web);
  log(`slack: watching ${convos.length} conversations as ${auth.user ?? self}`);

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

  const lastSeen = new Map<string, string>(); // channel id → newest ts already fetched
  const lastActivity = new Map<string, number>(); // channel id → ms epoch of last message
  let stopped = false;
  let ticking = false;
  let tick = 0;

  const isHot = (c: Convo) =>
    c.type === 'im' || c.type === 'mpim' ||
    Date.now() - (lastActivity.get(c.id) ?? 0) < hotWindowMs;

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
        userName: await userName(norm.user),
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
      const full = tick === 1 || tick % fullSweepEvery === 0;
      if (tick % (fullSweepEvery * 10) === 0) convos = await listConversations(web).catch(() => convos);
      // fast ticks hit only hot conversations (DMs + recently active); if the
      // hot set ever grows large the SDK queues on 429 rather than failing
      const targets = full ? convos : convos.filter(isHot);
      for (const c of targets) {
        if (stopped) break;
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
  const timer = setInterval(() => void poll(), pollMs);
  return {
    stop: async () => { stopped = true; clearInterval(timer); },
  };
}
