import { describe, it, expect } from 'vitest';
import { normalizeEvent } from '../src/slack';

const base = { type: 'message', ts: '123.456', channel: 'C1', channel_type: 'channel', user: 'U1', text: 'hello' };

describe('normalizeEvent', () => {
  it('normalizes a plain message', () => {
    const m = normalizeEvent(base, 'T1');
    expect(m).toEqual({
      slackTs: '123.456', channel: 'C1', channelType: 'channel',
      user: 'U1', text: 'hello', threadTs: null, team: 'T1',
    });
  });

  it('keeps thread ts', () => {
    expect(normalizeEvent({ ...base, thread_ts: '111.0' })!.threadTs).toBe('111.0');
  });

  it('drops edits and joins, keeps thread broadcasts', () => {
    expect(normalizeEvent({ ...base, subtype: 'message_changed' })).toBe(null);
    expect(normalizeEvent({ ...base, subtype: 'channel_join' })).toBe(null);
    expect(normalizeEvent({ ...base, subtype: 'thread_broadcast' })).not.toBe(null);
  });

  it('drops non-messages and empty payloads', () => {
    expect(normalizeEvent({ type: 'reaction_added' })).toBe(null);
    expect(normalizeEvent({ ...base, text: '' })).toBe(null);
    expect(normalizeEvent(null)).toBe(null);
  });
});
