import { describe, it, expect } from 'vitest';
import { Llm, scoreUrgency, digestMessages, draftReply, summarizeCall, parseIntent } from '../src/index';

function fakeLlm(reply: string, calls: any[] = [], opts: Record<string, string> = {}) {
  const fetchFn = async (url: string, init?: any) => {
    calls.push({ url, headers: init?.headers, body: init?.body ? JSON.parse(init.body) : null });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: reply } }] }),
    } as Response;
  };
  return { llm: new Llm({ url: 'http://test', fetchFn: fetchFn as any, ...opts }), calls };
}

describe('Llm.chat', () => {
  it('posts to /v1/chat/completions and returns content', async () => {
    const { llm, calls } = fakeLlm('hello back', []);
    const out = await llm.chat([{ role: 'user', content: 'hi' }]);
    expect(out).toBe('hello back');
    expect(calls[0].url).toBe('http://test/v1/chat/completions');
    expect(calls[0].body.messages[0].content).toBe('hi');
  });

  it('BYOK: bearer header, model id, no double /v1', async () => {
    const calls: any[] = [];
    const llm = new Llm({
      url: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-5-mini',
      fetchFn: (async (url: string, init: any) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } as Response;
      }) as any,
    });
    await llm.chat([{ role: 'user', content: 'hi' }]);
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test');
    expect(calls[0].body.model).toBe('gpt-5-mini');
  });
});

describe('scoreUrgency', () => {
  const msg = { channelName: 'eng', userName: 'Priya', text: 'prod is down!!' };

  it('parses urgent JSON verdict', async () => {
    const { llm } = fakeLlm('{"urgent": true, "reason": "production outage"}');
    const r = await scoreUrgency(llm, msg);
    expect(r.urgent).toBe(true);
    expect(r.reason).toBe('production outage');
  });

  it('handles fenced JSON', async () => {
    const { llm } = fakeLlm('```json\n{"urgent": false, "reason": "chitchat"}\n```');
    expect((await scoreUrgency(llm, msg)).urgent).toBe(false);
  });

  it('defaults to not-urgent on garbage output', async () => {
    const { llm } = fakeLlm('cannot parse this');
    const r = await scoreUrgency(llm, msg);
    expect(r.urgent).toBe(false);
  });
});

describe('digestMessages', () => {
  it('includes messages in prompt and returns summary', async () => {
    const { llm, calls } = fakeLlm('- eng: prod fixed', []);
    const out = await digestMessages(llm, [
      { channelName: 'eng', userName: 'Priya', text: 'prod is fixed' },
    ]);
    expect(out).toContain('prod fixed');
    const prompt = JSON.stringify(calls[0].body);
    expect(prompt).toContain('prod is fixed');
  });

  it('empty input short-circuits without calling the model', async () => {
    const calls: any[] = [];
    const { llm } = fakeLlm('should not be called', calls);
    const out = await digestMessages(llm, []);
    expect(out).toBe('Nothing new.');
    expect(calls.length).toBe(0);
  });
});

describe('parseIntent', () => {
  it('maps known intents', async () => {
    const { llm } = fakeLlm('{"kind":"system","value":"screenshot"}');
    expect(await parseIntent(llm, 'take a screenshot')).toEqual({ kind: 'system', value: 'screenshot' });
  });

  it('rejects invented kinds and bad system values', async () => {
    const { llm: a } = fakeLlm('{"kind":"shell","value":"rm -rf /"}');
    expect((await parseIntent(a, 'nuke it')).kind).toBe('none');
    const { llm: b } = fakeLlm('{"kind":"system","value":"format-disk"}');
    expect((await parseIntent(b, 'format disk')).kind).toBe('none');
  });

  it('none on garbage output and empty transcript', async () => {
    const { llm } = fakeLlm('sure, doing that now!');
    expect((await parseIntent(llm, 'hello')).kind).toBe('none');
    const calls: any[] = [];
    const { llm: c } = fakeLlm('x', calls);
    expect((await parseIntent(c, '  ')).kind).toBe('none');
    expect(calls.length).toBe(0);
  });
});

describe('summarizeCall', () => {
  it('summarizes transcript', async () => {
    const { llm, calls } = fakeLlm('Gist: standup.', []);
    const out = await summarizeCall(llm, 'we discussed the launch');
    expect(out).toBe('Gist: standup.');
    expect(JSON.stringify(calls[0].body)).toContain('we discussed the launch');
  });

  it('empty transcript short-circuits', async () => {
    const calls: any[] = [];
    const { llm } = fakeLlm('x', calls);
    expect(await summarizeCall(llm, '   ')).toBe('Empty recording.');
    expect(calls.length).toBe(0);
  });
});

describe('draftReply', () => {
  it('returns trimmed draft', async () => {
    const { llm } = fakeLlm('  Sounds good, shipping it today.  ');
    const out = await draftReply(llm, [
      { channelName: 'eng', userName: 'Priya', text: 'can you ship today?' },
    ], { userName: 'Priya', text: 'can you ship today?' });
    expect(out).toBe('Sounds good, shipping it today.');
  });
});
