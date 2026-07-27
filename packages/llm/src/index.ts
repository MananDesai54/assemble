export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  url?: string;
  fetchFn?: typeof fetch;
  model?: string;
  /** BYOK: bearer token for OpenAI-compatible cloud endpoints. */
  apiKey?: string;
  /** llama-server only: allows chat_template_kwargs (cloud providers reject unknown fields). */
  templateControls?: boolean;
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
  apiKey: string;
  templateControls: boolean;
  private fetchFn: typeof fetch;

  constructor({ url = process.env.ASSEMBLE_LLM_URL || 'http://127.0.0.1:4820',
                fetchFn = fetch, model = 'local', apiKey = '', templateControls = false }: LlmOptions = {}) {
    this.url = url.replace(/\/$/, '');
    this.fetchFn = fetchFn;
    this.model = model;
    this.apiKey = apiKey;
    this.templateControls = templateControls;
  }

  /** Base may or may not already include the /v1 (or /openai compat) segment. */
  private endpoint(): string {
    return /\/(v1|v1beta\/openai|openai)$/.test(this.url)
      ? `${this.url}/chat/completions`
      : `${this.url}/v1/chat/completions`;
  }

  async chat(
    messages: ChatMessage[],
    // reasoning is opt-in: thinking stays off unless a call explicitly asks
    { maxTokens = 512, temperature = 0.4, reasoning = false }: { maxTokens?: number; temperature?: number; reasoning?: boolean } = {},
  ): Promise<string> {
    const res = await this.fetchFn(this.endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model, messages, max_tokens: maxTokens, temperature,
        // per-request thinking switch — llama-server renders it into the chat template
        ...(this.templateControls && !reasoning
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().then(t => t.slice(0, 200)).catch(() => '');
      throw new Error(`llm http ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    const data = await res.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const out = data.choices?.[0]?.message?.content ?? '';
    if (!out.trim()) {
      // reasoning models can spend the whole budget thinking and return an
      // empty content field — surface it instead of saving an empty reply
      const why = data.choices?.[0]?.finish_reason === 'length'
        ? 'model ran out of tokens before answering — try again or shorten the question'
        : 'model returned an empty reply';
      throw new Error(why);
    }
    return out;
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
  ], { maxTokens: 400, temperature: 0 });
  const parsed = extractJson(out) as Partial<UrgencyVerdict> | null;
  if (!parsed || typeof parsed.urgent !== 'boolean') return { urgent: false, reason: 'unparseable verdict' };
  return { urgent: parsed.urgent, reason: String(parsed.reason ?? '') };
}

// Keep digest input inside the local model's context window (8k tokens by
// default) — newest messages win when there's too much history.
const DIGEST_CHAR_BUDGET = 18_000;

export async function digestMessages(llm: Llm, messages: MessageLike[]): Promise<string> {
  if (messages.length === 0) return 'Nothing new.';
  const lines: string[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = fmt(messages[i]).slice(0, 600);
    if (used + line.length > DIGEST_CHAR_BUDGET) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  const body = lines.join('\n');
  return (await llm.chat([
    { role: 'system', content:
      'Summarize these Slack messages for a software engineer catching up. ' +
      'Group by topic, lead with anything that needs action, keep it under 8 bullet lines. Plain text.' },
    { role: 'user', content: body },
  ], { maxTokens: 800, temperature: 0.3 })).trim();
}

// Voice-intent catalog is deliberately closed: no arbitrary shell from voice —
// a misheard sentence must never execute an arbitrary command.
export type VoiceIntent =
  | { kind: 'none'; reason: string }
  | { kind: 'digest' }
  | { kind: 'record-toggle' }
  | { kind: 'system'; value: 'screenshot' | 'screenshot-region' | 'volume-up' | 'volume-down' | 'mute-toggle' | 'lock-screen' | 'display-sleep' }
  | { kind: 'open'; value: string };

const SYSTEM_VALUES = new Set(['screenshot', 'screenshot-region', 'volume-up', 'volume-down', 'mute-toggle', 'lock-screen', 'display-sleep']);

export async function parseIntent(llm: Llm, transcript: string): Promise<VoiceIntent> {
  if (!transcript.trim()) return { kind: 'none', reason: 'empty' };
  const out = await llm.chat([
    { role: 'system', content:
      'Map a spoken command to ONE of these intents and reply with ONLY JSON:\n' +
      '{"kind":"digest"} — summarize slack / what did I miss\n' +
      '{"kind":"record-toggle"} — start or stop recording the call\n' +
      '{"kind":"system","value":"screenshot"|"screenshot-region"|"volume-up"|"volume-down"|"mute-toggle"|"lock-screen"|"display-sleep"}\n' +
      '{"kind":"open","value":"<https url or macOS app name>"} — open a site or app\n' +
      '{"kind":"none","reason":"<why>"} — anything else, unclear, or not a command\n' +
      'The command may be spoken in English, Hindi, Hinglish, or Gujarati — map by meaning. ' +
      'Never invent other kinds. When unsure choose none.' },
    { role: 'user', content: transcript },
  ], { maxTokens: 512, temperature: 0 });
  const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : out;
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return { kind: 'none', reason: 'unparseable' };
  let parsed: any;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return { kind: 'none', reason: 'unparseable' }; }
  switch (parsed.kind) {
    case 'digest': return { kind: 'digest' };
    case 'record-toggle': return { kind: 'record-toggle' };
    case 'system':
      return SYSTEM_VALUES.has(parsed.value) ? { kind: 'system', value: parsed.value } : { kind: 'none', reason: 'unknown system value' };
    case 'open':
      return typeof parsed.value === 'string' && parsed.value.trim() ? { kind: 'open', value: parsed.value.trim() } : { kind: 'none', reason: 'no target' };
    default: return { kind: 'none', reason: String(parsed.reason ?? 'no match') };
  }
}

/** Conversational turn — replies may be spoken aloud, so keep them tight. */
export async function talkReply(llm: Llm, history: ChatMessage[], summary?: string | null, reasoning = false): Promise<string> {
  return (await llm.chat([
    { role: 'system', content:
      'You are assemble, a local assistant running on the user\'s machine. ' +
      'Replies may be read aloud: answer in 1-3 short sentences, plain text only — ' +
      'no markdown, no lists, no code blocks. Reply in the same language the user used ' +
      '(English, Hindi, or Hinglish). Be direct and useful.' +
      (summary ? `\n\nSummary of the conversation so far:\n${summary}` : '') },
    ...history.slice(-16),
  ], { maxTokens: 1024, temperature: 0.5, reasoning })).trim();
}

/** Fold older turns into a running summary so long chats fit the context. */
export async function foldTalkSummary(llm: Llm, prevSummary: string | null, turns: ChatMessage[]): Promise<string> {
  return (await llm.chat([
    { role: 'system', content:
      'You maintain a compact running summary of a conversation between a user and an assistant. ' +
      'Merge the new turns into the summary: keep facts, decisions, names, preferences, and open threads. ' +
      'Plain text, under 200 words.' },
    { role: 'user', content:
      `${prevSummary ? `Summary so far:\n${prevSummary}\n\n` : ''}New turns:\n` +
      turns.map(t => `${t.role}: ${t.content}`).join('\n') },
  ], { maxTokens: 1024, temperature: 0.2 })).trim();
}

// Rolling refinement: transcripts of any length are summarized chunk by
// chunk — each round sees the summary so far plus the next slice, so nothing
// past the model's context window is ever silently dropped.
const CALL_CHUNK_CHARS = 10_000;

export async function summarizeCall(llm: Llm, transcript: string): Promise<string> {
  const text = transcript.trim();
  if (!text) return 'Empty recording.';
  let summary = '';
  for (let i = 0; i < text.length; i += CALL_CHUNK_CHARS) {
    const chunk = text.slice(i, i + CALL_CHUNK_CHARS);
    summary = (await llm.chat([
      { role: 'system', content:
        'You maintain a running summary of a call transcript that arrives in parts. ' +
        'Structure: one-line gist, key points (bullets), decisions, action items with owners if mentioned. ' +
        'Merge the new part into the summary. Concise plain text; never mention that the transcript is partial.' },
      { role: 'user', content: summary
        ? `Summary of the call so far:\n${summary}\n\nNext part of the transcript:\n${chunk}`
        : chunk },
    ], { maxTokens: 1200, temperature: 0.3 })).trim();
  }
  return summary;
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
      'no signatures, match casual Slack tone. Reply in the same language and script as the ' +
      'conversation (English, Hindi, Hinglish, or Gujarati). Reply with the message text only.' },
    { role: 'user', content: `Conversation:\n${thread}\n\nDraft a reply to: ${fmt(target)}` },
  ], { maxTokens: 1024, temperature: 0.5 })).trim();
}
