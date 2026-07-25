import { SocketModeClient } from '@slack/socket-mode';
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
}

// Pure: Slack event → normalized message, or null for non-message noise.
// Skips subtypes (edits, joins, bot noise) except thread broadcasts.
export function normalizeEvent(event: any, teamId?: string): NormalizedMessage | null {
  if (!event || event.type !== 'message') return null;
  if (event.subtype && event.subtype !== 'thread_broadcast') return null;
  if (!event.text || !event.ts || !event.channel) return null;
  return {
    slackTs: String(event.ts),
    channel: String(event.channel),
    channelType: event.channel_type ?? null,
    user: event.user ?? null,
    text: String(event.text),
    threadTs: event.thread_ts ?? null,
    team: teamId ?? event.team ?? null,
  };
}

export interface SlackIntake {
  stop: () => Promise<void>;
}

export async function startSlack({
  appToken,
  botToken,
  onMessage,
  log = console.log,
}: {
  appToken: string;
  botToken: string;
  onMessage: (m: EnrichedMessage) => void;
  log?: (msg: string) => void;
}): Promise<SlackIntake> {
  // Fail fast on the wrong token type — a non-xapp token makes socket.start()
  // hang forever instead of erroring.
  if (!appToken.startsWith('xapp-')) {
    throw new Error('app token must start with xapp- (App-Level Token with connections:write — api.slack.com → your app → Basic Information)');
  }
  if (!botToken.startsWith('xoxb-')) {
    throw new Error('bot token must start with xoxb- (OAuth → Bot User OAuth Token)');
  }
  const socket = new SocketModeClient({ appToken });
  const web = new WebClient(botToken);
  try {
    await web.auth.test(); // verify the bot token before opening the socket
  } catch (err) {
    throw new Error(`bot token rejected by Slack: ${(err as Error).message}`);
  }
  const userNames = new Map<string, string | null>();
  const channelNames = new Map<string, string | null>();

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

  async function channelName(id: string): Promise<string | null> {
    if (!channelNames.has(id)) {
      try {
        const r = await web.conversations.info({ channel: id });
        channelNames.set(id, r.channel?.name ?? null);
      } catch { channelNames.set(id, null); }
    }
    return channelNames.get(id) ?? null;
  }

  socket.on('message', async ({ event, body, ack }: any) => {
    await ack();
    const norm = normalizeEvent(event, body?.team_id);
    if (!norm) return;
    onMessage({
      ...norm,
      userName: await userName(norm.user),
      channelName: norm.channelType === 'im' ? 'DM' : await channelName(norm.channel),
    });
  });

  socket.on('connected', () => log('slack: socket connected'));
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
  return { stop: () => socket.disconnect() };
}
