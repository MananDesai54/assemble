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
      botId: null,
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
      text: 'yo', threadTs: null, team: 'T1', botName: null, botId: null,
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
    const h = normalizeHistoryMessage({ type: 'message', subtype: 'bot_message', ts: '8.0', text: 'ping', bot_id: 'B1' }, 'C9', 'channel');
    expect(h?.botName).toBeNull();
    expect(h?.botId).toBe('B1');
  });
});

describe('attachment/block messages (Grafana-style alerts)', () => {
  it('extracts text from attachments when top-level text is empty', async () => {
    const { normalizeEvent } = await import('../src/intake');
    const m = normalizeEvent({
      type: 'message', subtype: 'bot_message', ts: '9.0', channel: 'C9', text: '',
      bot_id: 'B2', username: 'Centerseat Prod App',
      attachments: [{ title: 'Centerseat Alert [prod]', text: 'Mimir ingester memory exceeded 85%.' }],
    });
    expect(m?.text).toBe('Centerseat Alert [prod] — Mimir ingester memory exceeded 85%.');
    expect(m?.botName).toBe('Centerseat Prod App');
  });

  it('falls back to blocks, still drops truly empty messages', async () => {
    const { normalizeEvent } = await import('../src/intake');
    const b = normalizeEvent({ type: 'message', ts: '10.0', channel: 'C9', text: '', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'deploy done' } }] });
    expect(b?.text).toBe('deploy done');
    expect(normalizeEvent({ type: 'message', ts: '11.0', channel: 'C9', text: '' })).toBeNull();
  });
});

describe('file and misc message shapes', () => {
  it('file-only message becomes [file] lines', async () => {
    const { normalizeEvent } = await import('../src/intake');
    const m = normalizeEvent({
      type: 'message', ts: '12.0', channel: 'C9', user: 'U5', text: '',
      files: [{ name: 'certificate-9qusdj.pdf' }, { title: 'report Q3' }],
    });
    expect(m?.text).toBe('[file] certificate-9qusdj.pdf\n[file] report Q3');
  });

  it('file with caption keeps both', async () => {
    const { normalizeEvent } = await import('../src/intake');
    const m = normalizeEvent({ type: 'message', ts: '13.0', channel: 'C9', user: 'U5', text: 'here are the certs', files: [{ name: 'a.pdf' }] });
    expect(m?.text).toBe('here are the certs\n[file] a.pdf');
  });

  it('context block text extracted', async () => {
    const { normalizeEvent } = await import('../src/intake');
    const m = normalizeEvent({ type: 'message', ts: '14.0', channel: 'C9', text: '', blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: 'deployed by ci' }] }] });
    expect(m?.text).toBe('deployed by ci');
  });
});
