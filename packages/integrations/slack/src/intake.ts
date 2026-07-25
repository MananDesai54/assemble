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
  /** Message written by the token's owner — callers skip urgency pings for these. */
  isSelf?: boolean;
  /** False during the initial backfill sweep — callers skip pings/broadcasts for history. */
  live?: boolean;
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
 * Poll-based intake on a user token (xoxp): reads every conversation the
 * user is a member of — no bot invites, no Socket Mode, no public URL.
 * First sweep backfills history; later sweeps fetch only newer messages.
 * Duplicate delivery is fine — the store dedupes on (channel, ts).
 */
export async function startSlack({
  userToken,
  onMessage,
  log = console.log,
  pollMs = 45_000,
  backfillLimit = 100,
}: {
  userToken: string;
  onMessage: (m: EnrichedMessage) => void;
  log?: (msg: string) => void;
  pollMs?: number;
  backfillLimit?: number;
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
  let stopped = false;
  let ticking = false;
  let tick = 0;
  let live = false; // flips true once the backfill sweep finishes

  async function pollChannel(c: Convo) {
    const oldest = lastSeen.get(c.id);
    const r: any = await web.conversations.history({
      channel: c.id,
      limit: oldest ? 50 : backfillLimit,
      ...(oldest ? { oldest } : {}), // exclusive — only strictly newer messages
    });
    const newest = r.messages?.[0]?.ts;
    for (const raw of (r.messages ?? []).slice().reverse()) {
      const norm = normalizeHistoryMessage(raw, c.id, c.type, team);
      if (!norm) continue;
      onMessage({
        ...norm,
        userName: await userName(norm.user),
        channelName: c.type === 'im' ? 'DM' : c.name,
        isSelf: norm.user === self,
        live,
      });
    }
    if (newest && (!oldest || newest > oldest)) lastSeen.set(c.id, String(newest));
  }

  async function poll() {
    if (stopped || ticking) return; // never overlap sweeps
    ticking = true;
    try {
      tick++;
      if (tick % 20 === 0) convos = await listConversations(web).catch(() => convos);
      for (const c of convos) {
        if (stopped) break;
        await pollChannel(c).catch(err =>
          log(`slack: poll ${c.name ?? c.id} failed — ${(err as any)?.data?.error ?? (err as Error).message}`));
      }
    } finally {
      ticking = false;
    }
  }

  // Backfill runs in the background — connect returns as soon as the token
  // and conversation list check out. Overlap is prevented by `ticking`.
  void poll().then(() => { live = true; log('slack: backfill done'); });
  const timer = setInterval(() => void poll(), pollMs);
  return {
    stop: async () => { stopped = true; clearInterval(timer); },
  };
}
