/**
 * The instructions a provider keeps for a whole session (ADR 0085, amendment
 * of 2026-10-09).
 *
 * Providers cache a chat's prompt as tools, then the system text, then the
 * conversation: change a word of the system text and everything after it is
 * read again at full price. Conch's system text has parts that move between
 * messages (an app's health, a routine's last run, the map's order, an edited
 * artifact, the machine's load), so every new message used to throw the
 * cached chat away; Codex and the ACP agents were sent the whole text again.
 *
 * So the system text a session started with is kept for as long as the
 * session lasts. A part that changes after that goes with the person's next
 * message instead, once, in words that say it replaces the earlier version.
 * A part that goes away, or a new agent answering, starts the instructions
 * again (a prompt cache that warms once). The memories a message brings up
 * go with it the same way: each only once a session.
 *
 * Nothing here is in the chat's log, only in what the provider is sent.
 */
import type { Memory } from '@conch/protocol';

/** One part of the system text, named so it can be compared turn to turn. */
export interface Part {
  key: string;
  text: string;
}

/** What a provider's session was given, so far. */
export interface Given {
  engine: string;
  /** The session it was given to; another one starts from nothing. */
  resumeId: string;
  /** The parts its system text was made of, in order. */
  base: Part[];
  /** Every part as the session knows it now: the base, and what came with messages since. */
  known: Map<string, string>;
  /** The memories it was told of. */
  memories: Set<string>;
}

export interface Instructions {
  /** The system text to send. */
  system: string;
  /** What goes in front of the person's words: what changed since the last message. */
  update?: string;
  /** The same for a session that starts again from the chat's log: what changed since the start. */
  fresh?: string;
  /** Which memories go with the message (and, for a new session, all of them). */
  memories: Memory[];
  freshMemories: Memory[];
  /** What the session will have been given, once this turn's session is known. */
  given(resumeId: string | undefined, restarted: boolean): Given | undefined;
}

/** The heading the changed parts go under, in front of the person's words. */
export const UPDATE_LEAD =
  'Since this chat began, part of your instructions changed. This replaces the earlier version of each part below; everything else still holds.';

/**
 * The system text for this turn, and what goes with the message.
 *
 * `given` is what the session was given before (if this is the session that
 * resumes); `firm` names the parts whose change starts the instructions again
 * rather than going as an update (who the assistant is).
 */
export function instructionsFor(input: {
  engine: string;
  resumeId: string | undefined;
  parts: readonly Part[];
  memories: readonly Memory[];
  given: Given | undefined;
  firm?: ReadonlySet<string>;
}): Instructions {
  const parts = input.parts.filter((p) => p.text.trim());
  const prior =
    input.given &&
    input.resumeId &&
    input.given.engine === input.engine &&
    input.given.resumeId === input.resumeId
      ? input.given
      : undefined;
  const now = new Map(parts.map((p) => [p.key, p.text]));
  // What the session was told of stays in it, whatever its system text becomes.
  const told = prior?.memories ?? new Set<string>();
  const memories = input.memories.filter((m) => !told.has(m.id));
  const freshMemories = [...input.memories];
  const holds =
    prior !== undefined &&
    // Every part the session knows is still there,
    [...prior.known.keys()].every((key) => now.has(key)) &&
    // and none that starts the instructions again has changed.
    [...(input.firm ?? [])].every((key) => same(prior.known.get(key), now.get(key)));
  const base = holds ? prior.base : parts;
  const given = (resumeId: string | undefined, restarted: boolean): Given | undefined =>
    resumeId
      ? {
          engine: input.engine,
          resumeId,
          base,
          known: new Map(now),
          memories: new Set([...(restarted ? [] : told), ...input.memories.map((m) => m.id)]),
        }
      : undefined;
  if (!holds) return { system: join(base), memories, freshMemories, given };

  const changed = parts.filter((p) => !same(prior.known.get(p.key), p.text));
  const sinceStart = parts.filter((p) => !same(base.find((b) => b.key === p.key)?.text, p.text));
  return {
    system: join(base),
    ...(changed.length && { update: updateText(changed) }),
    ...(sinceStart.length && { fresh: updateText(sinceStart) }),
    memories,
    freshMemories,
    given,
  };
}

function join(parts: readonly Part[]): string {
  return parts.map((p) => p.text).join('\n\n');
}

function updateText(parts: readonly Part[]): string {
  return [`<instructions-update>`, UPDATE_LEAD, '', join(parts), `</instructions-update>`].join(
    '\n',
  );
}

/**
 * The same part, whatever order its lines are in: a list put in another order
 * for this message (the map puts what was just named first) says nothing new.
 */
export function same(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const lines = (text: string) => text.split('\n').sort().join('\n');
  return lines(a) === lines(b);
}

/** The tag around what Conch sends with a message, ahead of the person's words. */
export const CONTEXT_TAG = 'context-from-conch';

/** What the system text says of that block, so it's never taken for the person's words. */
export const CONTEXT_GUIDE = `A message may start with a <${CONTEXT_TAG}> block. Conch put it there, not the user: changes to your instructions since the chat began, memories that bear on the message, and notes about right now (an app that isn't connected, who else is in the conversation, how busy this computer is). Use it, but don't mention the block itself.`;

/**
 * What goes with a message ahead of the person's words, in one block that
 * says it's Conch's (what changed, the memories it brought up, what is only
 * about now). Empty when there is nothing.
 */
export function contextNote(items: readonly (string | false | null | undefined)[]): string {
  const kept = items.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  );
  return kept.length ? [`<${CONTEXT_TAG}>`, kept.join('\n\n'), `</${CONTEXT_TAG}>`].join('\n') : '';
}

/** A prompt without that block, and the block's words: for a provider that reads them apart. */
export function splitContextNote(prompt: string): { context: string; words: string } {
  const found = new RegExp(`^<${CONTEXT_TAG}>\\n([\\s\\S]*?)\\n</${CONTEXT_TAG}>\\n*`).exec(prompt);
  return found
    ? { context: found[1] ?? '', words: prompt.slice(found[0].length) }
    : { context: '', words: prompt };
}
