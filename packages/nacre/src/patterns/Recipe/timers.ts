/**
 * Kitchen timers, kept outside React so they run on while the card scrolls
 * out of sight (or is unmounted by a long chat), and across cook mode and
 * the card: one store, many views. Saved for the session, so a reload picks
 * them up where they were. When one ends it chimes softly and tells whoever
 * asked (`onDone`: the app's notification).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

import { chime, primeChime } from './chime';

export interface KitchenTimer {
  /** `<recipe>:<step>:<n>`: one per timer in a step. */
  id: string;
  /** Which recipe it's for (the card's state key) and which step. */
  recipe: string;
  step: number;
  /** What it's for, in words: `Step 3 · Simmer`. */
  label: string;
  /** How long it was set for. */
  ms: number;
  /** When it ends, while running; `null` while paused. */
  endsAt: number | null;
  /** What was left when it was paused. */
  left: number;
  done: boolean;
}

const KEY = 'nc-recipe-timers';
let timers: readonly KitchenTimer[] = [];
const listeners = new Set<() => void>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const doneHandlers = new Map<string, (timer: KitchenTimer) => void>();
let loaded = false;

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function save() {
  try {
    storage()?.setItem(KEY, JSON.stringify(timers));
  } catch {
    // Full or refused: they still run for now.
  }
}

function set(next: readonly KitchenTimer[]) {
  timers = next;
  save();
  for (const l of listeners) l();
}

function schedule(timer: KitchenTimer) {
  clearTimeout(pending.get(timer.id));
  pending.delete(timer.id);
  if (timer.endsAt === null || timer.done) return;
  const wait = Math.max(0, timer.endsAt - Date.now());
  pending.set(
    timer.id,
    setTimeout(() => finish(timer.id), wait),
  );
}

function finish(id: string) {
  pending.delete(id);
  const timer = timers.find((t) => t.id === id);
  if (!timer || timer.done || timer.endsAt === null) return;
  const done = { ...timer, done: true, endsAt: null, left: 0 };
  set(timers.map((t) => (t.id === id ? done : t)));
  chime();
  doneHandlers.get(id)?.(done);
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage()?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return;
    timers = parsed.filter(
      (t): t is KitchenTimer =>
        !!t &&
        typeof t === 'object' &&
        typeof (t as KitchenTimer).id === 'string' &&
        typeof (t as KitchenTimer).ms === 'number',
    );
    // One that ended while the page was away has simply ended: no chime for the past.
    timers = timers.map((t) =>
      t.endsAt !== null && t.endsAt <= Date.now() ? { ...t, done: true, endsAt: null, left: 0 } : t,
    );
    timers.forEach(schedule);
  } catch {
    timers = [];
  }
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => {
  load();
  return timers;
};
const empty: readonly KitchenTimer[] = [];

/** Every timer, live. */
export function useKitchenTimers(): readonly KitchenTimer[] {
  return useSyncExternalStore(subscribe, snapshot, () => empty);
}

/** Starts a timer (or starts it again), from a press, so the chime may play later. */
export function startTimer(
  timer: Pick<KitchenTimer, 'id' | 'recipe' | 'step' | 'label' | 'ms'>,
  onDone?: (timer: KitchenTimer) => void,
) {
  load();
  primeChime();
  if (onDone) doneHandlers.set(timer.id, onDone);
  const next: KitchenTimer = {
    ...timer,
    endsAt: Date.now() + timer.ms,
    left: timer.ms,
    done: false,
  };
  set([...timers.filter((t) => t.id !== timer.id), next]);
  schedule(next);
}

export function pauseTimer(id: string) {
  const timer = timers.find((t) => t.id === id);
  if (!timer || timer.endsAt === null) return;
  const paused = { ...timer, endsAt: null, left: Math.max(0, timer.endsAt - Date.now()) };
  set(timers.map((t) => (t.id === id ? paused : t)));
  schedule(paused);
}

export function resumeTimer(id: string) {
  const timer = timers.find((t) => t.id === id);
  if (!timer || timer.endsAt !== null || timer.done) return;
  primeChime();
  const running = { ...timer, endsAt: Date.now() + timer.left };
  set(timers.map((t) => (t.id === id ? running : t)));
  schedule(running);
}

/** Stops it and puts it away (a finished one too). */
export function clearTimer(id: string) {
  clearTimeout(pending.get(id));
  pending.delete(id);
  doneHandlers.delete(id);
  set(timers.filter((t) => t.id !== id));
}

/** What's left on a timer, in ms, at `now`. */
export function timeLeft(timer: KitchenTimer, now: number): number {
  if (timer.done) return 0;
  return timer.endsAt === null ? timer.left : Math.min(timer.ms, Math.max(0, timer.endsAt - now));
}

/** The clock, ticking while anything shown is running; still otherwise. */
export function useNow(ticking: boolean, every = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), every);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ticking, every]);
  return now;
}

/** For tests: forget every timer. */
export function resetKitchenTimers() {
  for (const id of pending.keys()) clearTimeout(pending.get(id));
  pending.clear();
  doneHandlers.clear();
  loaded = false;
  timers = [];
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
  for (const l of listeners) l();
}
