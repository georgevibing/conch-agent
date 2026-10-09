/**
 * Waiting for something until it changes (ADR 0124): CI, a command, a page, a
 * time. Conch watches by itself at a sensible pace and wakes the assistant
 * only when there's something to say; the model is never called to learn
 * "still running". A chat shows one waiting row per wait, kept current: these
 * are its words and its event.
 */
import { z } from 'zod';

/** What can be waited for. */
export const WaitKind = z.enum(['process', 'ci', 'url', 'time']);
export type WaitKind = z.infer<typeof WaitKind>;

/**
 * Where a wait is.
 *
 * - `watching`: Conch is looking, at its own pace.
 * - `done`: the thing settled (CI finished, the command exited, the page
 *   changed, the time came). `tone` says how it went.
 * - `timed-out`: the deadline came first.
 * - `stopped`: someone pressed Stop waiting, or the turn it was in stopped.
 * - `failed`: Conch couldn't watch it (a sign-in, an address it may not reach).
 */
export const WaitState = z.enum(['watching', 'done', 'timed-out', 'stopped', 'failed']);
export type WaitState = z.infer<typeof WaitState>;

/** One part of what's watched: a CI job, say. Drawn as a small dot that fills in. */
export const WaitPartState = z.enum(['waiting', 'running', 'passed', 'failed', 'skipped']);
export type WaitPartState = z.infer<typeof WaitPartState>;

export const WaitPart = z.object({
  name: z.string().min(1).max(120),
  state: WaitPartState,
});
export type WaitPart = z.infer<typeof WaitPart>;

/** The most parts a row keeps (a CI run with more is summed up in words). */
export const WAIT_PARTS_MAX = 40;

export const WaitNote = z.object({
  waitId: z.string().min(1).max(80),
  kind: WaitKind,
  /** What it waits for, in a few words: "CI for conch #482", "npm test", "3:30 pm". */
  title: z.string().min(1).max(160),
  state: WaitState,
  /** How it went, once it ended: good (green), bad (red), or neither. */
  tone: z.enum(['good', 'bad', 'neutral']).optional(),
  /** Now: "4 of 7 checks done". Ended: "CI finished: 2 failed — e2e, server unit". */
  status: z.string().max(300),
  parts: z.array(WaitPart).max(WAIT_PARTS_MAX).optional(),
  startedAt: z.number(),
  /** When Conch looks next, while watching. */
  nextCheckAt: z.number().optional(),
  /** When it gives up. */
  deadline: z.number(),
  endedAt: z.number().optional(),
  /** Where to see it for yourself (the CI run's page), when it has one. */
  url: z.string().url().max(2000).optional(),
  /**
   * The chat carries on by itself when it ends: the assistant's turn ended
   * while Conch watches. Unset, the wait is part of a turn still running.
   */
  wakes: z.boolean().optional(),
  /** You'll hear when it ends, on your phone and in your chat app. */
  tell: z.boolean().optional(),
});
export type WaitNote = z.infer<typeof WaitNote>;

/** Check now, or Stop waiting, from the row. */
export const WaitActionBody = z.object({ action: z.enum(['check', 'stop']) });
export type WaitActionBody = z.infer<typeof WaitActionBody>;

/** How a wait is going, said in the past or present tense, for a row and a notification. */
export function waitHeadline(note: Pick<WaitNote, 'state' | 'title' | 'kind'>): string {
  const what = note.title;
  switch (note.state) {
    case 'watching':
      return note.kind === 'time' ? `Waiting until ${what}` : `Waiting for ${what}`;
    case 'done':
      return note.kind === 'time' ? `It’s ${what}` : `${capital(what)} is done`;
    case 'timed-out':
      return `Stopped waiting for ${what}: it took too long`;
    case 'stopped':
      return `Stopped waiting ${note.kind === 'time' ? 'until' : 'for'} ${what}`;
    case 'failed':
      return `Couldn’t keep watching ${what}`;
  }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every wait still going in a chat's notes: the latest note per wait. */
export function openWaits(notes: readonly WaitNote[]): WaitNote[] {
  const latest = new Map<string, WaitNote>();
  for (const note of notes) latest.set(note.waitId, note);
  return [...latest.values()].filter((n) => n.state === 'watching');
}
