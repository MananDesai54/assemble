// Talk: chat + push-to-talk (hold fn), stt → llm → tts. The orb and the live
// waveform are canvases driven by one raf loop reading the talk session directly.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { app, talk, useApp } from '../store';
import {
  refreshTalkChats, newTalkChat, loadTalkChat, deleteTalkChat,
  talkSendText, talkInterrupt, talkSpeak,
} from '../controller';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Plus, Volume2, X } from 'lucide-react';

function useOrb(orbRef: React.RefObject<HTMLCanvasElement | null>, waveRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = orbRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = 0, amp = 0, raf = 0;
    const draw = () => {
      t += reduced ? 0 : 0.016;
      const target =
        talk.phase === 'listening' ? Math.min(1, talk.level * 14) :
        talk.phase === 'speaking' ? 0.35 + 0.3 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1)) :
        talk.phase === 'thinking' ? 0.18 + 0.1 * Math.sin(t * 2.2) :
        0.08 + 0.04 * Math.sin(t * 1.1);
      amp += (target - amp) * 0.12;
      const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
      ctx.clearRect(0, 0, W, H);
      const s = getComputedStyle(document.documentElement);
      const acc = s.getPropertyValue('--acc').trim() || '#8b9aff';
      const acc2 = s.getPropertyValue('--acc-2').trim() || '#4fd8e8';
      const base = 26;
      for (let ring = 3; ring >= 1; ring--) {
        ctx.beginPath();
        const pts = 72;
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const wob = Math.sin(a * (2 + ring) + t * (1.2 + ring * 0.7)) * 3 * amp * ring
                    + Math.sin(a * 5 - t * 2.1) * 2 * amp;
          const r = base + ring * 7 * amp + wob;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = ring === 2 ? acc2 : acc;
        ctx.globalAlpha = 0.16 * ring;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, base);
      grad.addColorStop(0, acc);
      grad.addColorStop(0.7, acc2);
      grad.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.25 + amp * 0.55;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, base * (0.75 + amp * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // live waveform takes the input's place while listening
      const wave = waveRef.current;
      if (wave && talk.phase === 'listening') {
        const want = Math.max(200, wave.clientWidth * 2);
        if (wave.width !== want) wave.width = want;
        const wc = wave.getContext('2d')!;
        wc.clearRect(0, 0, wave.width, wave.height);
        wc.fillStyle = acc2;
        const n = 80;
        const bw = wave.width / n;
        const mid = wave.height / 2;
        for (let i = 0; i < n; i++) {
          const idx = talk.levels.length - n + i;
          const lv = idx >= 0 ? talk.levels[idx] : 0;
          const h = Math.max(3, Math.min(1, lv * 16) * (wave.height - 8));
          wc.globalAlpha = 0.35 + (i / n) * 0.65; // newest brightest
          wc.fillRect(i * bw + bw * 0.2, mid - h / 2, bw * 0.6, h);
        }
        wc.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export function TalkPage() {
  useApp();
  const orbRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  useOrb(orbRef, waveRef);

  useEffect(() => {
    void refreshTalkChats().then(() => {
      if (!talk.chatId && talk.chats.length) talk.chatId = talk.chats[0].id;
      if (talk.chatId) void loadTalkChat(talk.chatId);
      else void newTalkChat();
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (app.page !== 'talk' || app.mode !== 'app') return;
      if (e.code === 'Escape') talkInterrupt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const t = threadRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, [talk.msgs.length]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void talkSendText(text);
  };

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Talk</h2>
        <p className="mt-1 text-[13.5px] text-dim">Hold <b>fn</b> to speak, or type. <b>Esc</b> interrupts. Voice lives in Settings → Local AI.</p>
      </div>
      <div className="flex min-h-0 flex-1 gap-3.5">
        <aside className="flex w-[190px] shrink-0 flex-col gap-2">
          <Button variant="secondary" size="sm" onClick={() => void newTalkChat()}>
            <Plus className="size-3.5" /> New chat
          </Button>
          <ul className="flex-1 overflow-y-auto">
            {talk.chats.map(chat => (
              <li
                key={chat.id}
                onClick={() => void loadTalkChat(chat.id)}
                className={`group flex cursor-pointer items-center justify-between gap-1 rounded-lg border-l-2 px-2.5 py-1.5 text-[13px] transition-colors ${
                  chat.id === talk.chatId
                    ? 'border-acc bg-acc-soft text-ink'
                    : 'border-transparent text-dim hover:bg-ink/5 hover:text-ink'
                }`}
              >
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{chat.title}</span>
                <button
                  title="Delete chat"
                  className="cursor-pointer text-dim opacity-0 transition-opacity hover:text-danger group-hover:opacity-70"
                  onClick={e => { e.stopPropagation(); void deleteTalkChat(chat.id); }}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={threadRef} className="mx-auto flex min-h-[200px] w-full max-w-[780px] flex-1 flex-col gap-2.5 overflow-y-auto px-0.5 py-2.5">
            {talk.msgs.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-center text-dim">
                <motion.div
                  animate={{ scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-grad text-[44px]"
                >
                  ◉
                </motion.div>
                <p>Hold <b>fn</b> and just say it.<br />Heard by whisper, answered by the local brain, spoken by Kokoro.</p>
              </div>
            ) : (
              talk.msgs.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                  className={`group/b relative max-w-[82%] rounded-2xl px-3.5 py-2.5 leading-normal ${
                    m.role === 'user'
                      ? 'self-end rounded-br-[5px] bg-ink/7'
                      : 'self-start rounded-bl-[5px] border border-acc/15 bg-acc/10'
                  }`}
                >
                  <span className="whitespace-pre-wrap">{m.content}</span>
                  {m.role === 'assistant' && (
                    <button
                      title="Read aloud"
                      className="absolute -right-[30px] top-1 cursor-pointer text-dim opacity-0 transition-opacity hover:text-ink group-hover/b:opacity-80"
                      onClick={() => talkSpeak(m.content, false)}
                    >
                      <Volume2 className="size-4" />
                    </button>
                  )}
                </motion.div>
              ))
            )}
          </div>
          <div className="mx-auto flex w-full max-w-[780px] items-center gap-2.5 border-t border-line pt-2.5">
            <canvas ref={orbRef} width={128} height={128} className="size-[52px] shrink-0" title="Hold fn to talk" />
            {talk.phase === 'listening' ? (
              <canvas ref={waveRef} height={88} className="h-11 flex-1 rounded-xl border border-acc/40" />
            ) : (
              <>
                <Input
                  placeholder="Type a message — or hold fn to talk"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') send(); }}
                />
                <Button variant="secondary" onClick={send}>Send</Button>
              </>
            )}
            <AnimatePresence>
              {talk.phase !== 'idle' && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Button variant="danger" onClick={talkInterrupt}>Stop</Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="min-h-[22px] pt-1.5 text-center text-[12.5px] text-dim">{talk.status}</div>
        </section>
      </div>
    </>
  );
}
