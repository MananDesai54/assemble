export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  url?: string;
  fetchFn?: typeof fetch;
  model?: string;
}

export interface MessageLike {
  channelName?: string | null;
  userName?: string | null;
  text: string;
}

// Thin client for a local llama-server (OpenAI-compatible API).
export class Llm {
  url: string;
  model: string;
  private fetchFn: typeof fetch;

  constructor({ url = process.env.ASSEMBLE_LLM_URL || 'http://127.0.0.1:4820',
                fetchFn = fetch, model = 'local' }: LlmOptions = {}) {
    this.url = url.replace(/\/$/, '');
    this.fetchFn = fetchFn;
    this.model = model;
  }

  async chat(messages: ChatMessage[], { maxTokens = 512, temperature = 0.4 } = {}): Promise<string> {
    const res = await this.fetchFn(`${this.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature }),
    });
    if (!res.ok) throw new Error(`llm http ${res.status}`);
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch { return false; }
  }
}

function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

function fmt(m: MessageLike): string {
  return `#${m.channelName ?? '?'} — ${m.userName ?? 'someone'}: ${m.text}`;
}

export interface UrgencyVerdict {
  urgent: boolean;
  reason: string;
}

export async function scoreUrgency(llm: Llm, msg: MessageLike): Promise<UrgencyVerdict> {
  const out = await llm.chat([
    { role: 'system', content:
      'You triage Slack messages for a software engineer. Urgent = needs their attention within the hour: ' +
      'production incidents, blocking questions directed at them, deadlines today, security issues. ' +
      'Not urgent: FYIs, chitchat, threads they are not needed in, newsletters, bot noise. ' +
      'Reply with ONLY JSON: {"urgent": boolean, "reason": "short phrase"}' },
    { role: 'user', content: fmt(msg) },
  ], { maxTokens: 100, temperature: 0 });
  const parsed = extractJson(out) as Partial<UrgencyVerdict> | null;
  if (!parsed || typeof parsed.urgent !== 'boolean') return { urgent: false, reason: 'unparseable verdict' };
  return { urgent: parsed.urgent, reason: String(parsed.reason ?? '') };
}

export async function digestMessages(llm: Llm, messages: MessageLike[]): Promise<string> {
  if (messages.length === 0) return 'Nothing new.';
  const body = messages.map(fmt).join('\n');
  return (await llm.chat([
    { role: 'system', content:
      'Summarize these Slack messages for a software engineer catching up. ' +
      'Group by topic, lead with anything that needs action, keep it under 8 bullet lines. Plain text.' },
    { role: 'user', content: body },
  ], { maxTokens: 400, temperature: 0.3 })).trim();
}

export async function draftReply(
  llm: Llm,
  context: MessageLike[],
  target: MessageLike,
): Promise<string> {
  const thread = context.map(fmt).join('\n');
  return (await llm.chat([
    { role: 'system', content:
      'Draft a Slack reply for a software engineer. Concise, friendly, direct, no filler, ' +
      'no signatures, match casual Slack tone. Reply with the message text only.' },
    { role: 'user', content: `Conversation:\n${thread}\n\nDraft a reply to: ${fmt(target)}` },
  ], { maxTokens: 300, temperature: 0.5 })).trim();
}
