// One coarse external store: controller mutates `app`/`talk` and calls emit();
// React subscribes through useApp(). Transient high-rate signals (mic level,
// desk ripples) go over `bus` instead so they never trigger re-renders.

import { useSyncExternalStore } from 'react';
import { TapClassifier, RhythmMatcher, WhistleController, BlowDetector } from '@assemble/dsp';
import type { AppConfig } from '@assemble/core';
import type { Engine } from './engine';
import type { Camera } from './camera';
import type { Bg } from './background';

export type Mode = 'loading' | 'landing' | 'setup' | 'app';
export type SettingsTab = 'general' | 'gestures' | 'integrations' | 'ai';
export type TalkPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface TeachState {
  stepIdx: number;
  secondsLeft: number | null;
  timer: ReturnType<typeof setInterval> | null;
}

export interface IntegrationField { key: string; label: string; placeholder: string; secret: boolean; help?: string; saved: boolean }
export interface IntegrationInfo {
  id: string; name: string; description: string; icon: string;
  connected: boolean; detail?: string; fields: IntegrationField[];
}

export interface TalkChatRow { id: number; title: string; created_at: string; reasoning: number }
export interface TalkMsg { role: 'user' | 'assistant'; content: string }

export const SERVER = 'http://127.0.0.1:4817';

export const app = {
  config: null as unknown as AppConfig,
  classifier: new TapClassifier(),
  engine: null as Engine | null,
  camera: null as Camera | null,
  whistle: null as WhistleController | null,
  blow: null as BlowDetector | null,
  rhythm: new RhythmMatcher(),
  rhythmTimer: null as ReturnType<typeof setTimeout> | null,
  lastConfidence: 1,
  mode: 'loading' as Mode,
  page: 'desk',
  settingsTab: 'general' as SettingsTab,
  setupStep: 0,
  setupReturn: false, // re-teach launched from the app → return to app after
  teach: null as TeachState | null,
  micError: null as string | null,
  activity: [] as { time: string; text: string; hit: boolean }[],
  integrations: [] as IntegrationInfo[],
  consentOpen: false,
  toast: null as { text: string; key: number } | null,
  // install rows: live progress line per setup step, latest server status
  setupLines: {} as Record<string, string>,
  setupStatus: {} as Record<string, boolean>,
  recording: false,
  recStatus: '',
};

export const talk = {
  phase: 'idle' as TalkPhase,
  status: 'hold fn and speak, or type',
  chatId: Number(localStorage.getItem('talk-chat') || 0) || (null as number | null),
  chats: [] as TalkChatRow[],
  msgs: [] as TalkMsg[],
  chunks: [] as Float32Array[],
  sawSpeech: false,
  level: 0,               // live mic rms while listening — drives the orb
  levels: [] as number[], // rolling waveform while listening
};

export let bg: Bg | null = null;
export function setBg(b: Bg) { bg = b; }

const listeners = new Set<() => void>();
let version = 0;
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function emit() { version++; for (const l of listeners) l(); }

/** Subscribe a component to every store change (coarse, app-sized — fine here). */
export function useApp(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** High-rate / transient signals: 'level', 'ripple', 'lit', 'slack-message', 'agent', 'recording'. */
export const bus = new EventTarget();
export function fire(kind: string, detail?: unknown) {
  bus.dispatchEvent(new CustomEvent(kind, { detail }));
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(text: string) {
  if (toastTimer) clearTimeout(toastTimer);
  app.toast = { text, key: Date.now() };
  emit();
  toastTimer = setTimeout(() => { app.toast = null; emit(); }, 4200);
}

export function logLine(text: string, hit = false) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  app.activity.unshift({ time, text, hit });
  if (app.activity.length > 100) app.activity.pop();
  emit();
}

export const integrationById = (id: string) => app.integrations.find(i => i.id === id);

export async function fetchIntegrations(): Promise<void> {
  try { app.integrations = await (await fetch(`${SERVER}/integrations`)).json(); }
  catch { app.integrations = []; }
  emit();
}
