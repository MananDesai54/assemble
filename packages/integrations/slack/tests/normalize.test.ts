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
    });
  });

  it('keeps thread broadcasts, drops other subtypes', () => {
    expect(normalizeHistoryMessage(
      { type: 'message', subtype: 'thread_broadcast', ts: '2.0', user: 'U1', text: 'fyi', thread_ts: '1.0' },
      'C1', 'channel',
    )?.threadTs).toBe('1.0');
    expect(normalizeHistoryMessage(
      { type: 'message', subtype: 'channel_join', ts: '3.0', user: 'U1', text: 'joined' },
      'C1', 'channel',
    )).toBeNull();
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
