import { describe, it, expect } from 'vitest';
import { normalizeHistoryMessage } from '../src/intake';

describe('normalizeHistoryMessage', () => {
  it('normalizes a plain history message', () => {
    const m = normalizeHistoryMessage(
      { type: 'message', ts: '1721900000.000100', user: 'U1', text: 'hello' },
      'C1', 'channel', 'T1',
    );
    expect(m).toEqual({
      slackTs: '1721900000.000100',
      channel: 'C1',
      channelType: 'channel',
      user: 'U1',
      text: 'hello',
      threadTs: null,
      team: 'T1',
      botName: null,
    });
  });

  it('keeps every subtype that carries text', () => {
    expect(normalizeHistoryMessage(
      { type: 'message', subtype: 'thread_broadcast', ts: '2.0', user: 'U1', text: 'fyi', thread_ts: '1.0' },
      'C1', 'channel',
    )?.threadTs).toBe('1.0');
    expect(normalizeHistoryMessage(
      { type: 'message', subtype: 'channel_join', ts: '3.0', user: 'U1', text: 'joined' },
      'C1', 'channel',
    )?.text).toBe('joined');
  });

  it('drops non-messages and empty text', () => {
    expect(normalizeHistoryMessage({ type: 'reaction_added', ts: '1.0' }, 'C1', 'channel')).toBeNull();
    expect(normalizeHistoryMessage({ type: 'message', ts: '1.0', text: '' }, 'C1', 'channel')).toBeNull();
    expect(normalizeHistoryMessage(null, 'C1', 'channel')).toBeNull();
  });

  it('marks DMs by channel type', () => {
    const m = normalizeHistoryMessage({ type: 'message', ts: '1.0', user: 'U2', text: 'hi' }, 'D1', 'im');
    expect(m?.channelType).toBe('im');
  });
});

describe('normalizeEvent (push transport)', () => {
  it('normalizes a message event', async () => {
    const { normalizeEvent } = await import('../src/intake');
    const m = normalizeEvent({ type: 'message', ts: '5.0', channel: 'C9', channel_type: 'channel', user: 'U3', text: 'yo' }, 'T1');
    expect(m).toEqual({
      slackTs: '5.0', channel: 'C9', channelType: 'channel', user: 'U3',
      text: 'yo', threadTs: null, team: 'T1', botName: null,
    });
  });

  it('keeps all message subtypes with text, drops non-messages', async () => {
    const { normalizeEvent } = await import('../src/intake');
    expect(normalizeEvent({ type: 'message', subtype: 'channel_join', ts: '1.0', channel: 'C9', text: 'joined' })?.text).toBe('joined');
    expect(normalizeEvent({ type: 'message', subtype: 'thread_broadcast', ts: '2.0', channel: 'C9', user: 'U1', text: 'fyi', thread_ts: '1.0' })?.threadTs).toBe('1.0');
    expect(normalizeEvent({ type: 'reaction_added' })).toBeNull();
    // edits nest text under .message — no top-level text, no row
    expect(normalizeEvent({ type: 'message', subtype: 'message_changed', ts: '3.0', channel: 'C9', message: { text: 'edited' } })).toBeNull();
  });
});

describe('bot/webhook messages', () => {
  it('keeps bot_message with its display name', async () => {
    const { normalizeEvent, normalizeHistoryMessage } = await import('../src/intake');
    const ev = normalizeEvent({ type: 'message', subtype: 'bot_message', ts: '7.0', channel: 'C9', text: 'Hello, World!', username: 'automations' });
    expect(ev?.text).toBe('Hello, World!');
    expect(ev?.botName).toBe('automations');
    expect(ev?.user).toBeNull();
    const h = normalizeHistoryMessage({ type: 'message', subtype: 'bot_message', ts: '8.0', text: 'ping' }, 'C9', 'channel');
    expect(h?.botName).toBe('bot');
  });
});
