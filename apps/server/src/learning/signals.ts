/**
 * What a chat says about how it went (ADR 0088 § 2), read by code from
 * Conch's own log — the same for every provider. Corrections and rephrasing
 * say more than thanks; a command that failed for a reason Conch knows, and
 * another program that did the same job straight after, is a fact about this
 * computer, written here from a template. No tool output ever leaves this
 * file: it's only matched against a fixed list.
 */
import type { ConversationEvent, LearningSignal } from '@conch/protocol';

import { overlap } from '../memory/tidy';
import { pleased, programsIn } from '../skills/learn';
import { needs } from '../skills/permissions';

/** "No, I meant…": the start of a message that corrects the reply before it. */
const CORRECTION =
  /^\s*(?:no\b|nope\b|nah\b|not (?:that|quite|what)\b|i meant\b|i mean\b|actually\b|wrong\b|that'?s (?:wrong|not (?:it|right|what))|instead\b|i said\b|i told you\b|i asked (?:for|you)\b|please don'?t\b|don'?t\b|stop\b|rather\b|i(?:'d| would) rather\b)/i;
/** Words that say it isn't going well. */
const FRUSTRATION =
  /\b(?:ugh+|argh+|come on|frustrat\w*|annoying|for the (?:last|second|third|\w+th) time|i already (?:said|told)|why do you keep|how many times|stop doing)\b/i;
/**
 * Something durable about the person: they speak of themselves and of what
 * lasts. Without it (and without a signal) no model is asked.
 */
const ABOUT_ME = /\b(?:i|i'm|im|i've|i'd|me|my|mine|we|our)\b/i;
const LASTING =
  /\b(?:always|never|usually|prefer\w*|rather|favou?rite|hate|love|can'?t stand|don'?t like|allergic|vegetarian|vegan|live|living|moved|move to|work(?:ing)? (?:at|for|on|as)|my (?:job|name|wife|husband|partner|son|daughter|kids?|boss|team|manager|dog|cat|birthday|time ?zone)|call me|i'?m (?:based|from)|in the future|from now on|going forward|next time)\b/i;

/**
 * Why a command failed, when this computer lacks the program itself. A file
 * that isn't there ("No such file or directory") says nothing about the
 * computer, so it isn't here.
 */
const NOT_FOUND = [
  /command not found/i,
  /is not recognized as (?:an internal or external command|the name of a cmdlet)/i,
  /\bwas not found\b.*(?:run without arguments|microsoft store|app execution alias)/i,
  /executable file not found/i,
];

export interface Said {
  seq: number;
  at: number;
  text: string;
  /** What this message says about the reply before it. */
  signal?: LearningSignal;
}

export interface EnvironmentFact {
  /** "On this computer, `python` isn't found; `py` works." */
  text: string;
  /** The command that worked, as the step label shows it. */
  quote: string;
}

export interface ChatSignals {
  /** What was noticed, each once, strongest first. */
  signals: LearningSignal[];
  /** Your words in the stretch, with what each says. */
  said: Said[];
  /** Facts about this computer, written by code. */
  environment: EnvironmentFact[];
  /** Your words speak of something lasting about you. */
  durable: boolean;
}

const ORDER: LearningSignal[] = [
  'correction',
  'memory-undone',
  'files-undone',
  'worked-another-way',
  'rephrase',
  'retry',
  'frustration',
  'stopped',
  'pleased',
];

const normal = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The command a tool call ran, if it ran one (every provider's shell is `Bash` in the log). */
function commandOf(name: string, input: unknown): string | undefined {
  const need = needs(name, input, { workspace: '' });
  return need?.capability === 'commands' && need.detail ? need.detail : undefined;
}

/** `python script.py --x` → `script.py`, `--x`: what a command did, without its program. */
function argsOf(command: string): string[] {
  return command.trim().split(/\s+/).slice(1);
}

/** How much two commands' arguments are the same, word for word (file names stay whole). */
function sameArgs(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const x = new Set(a);
  const y = new Set(b);
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** "On this computer, `python` isn't found; `py` works." — or nothing, when it isn't that plain. */
export function environmentFact(failed: string, worked: string): EnvironmentFact | undefined {
  const a = programsIn(failed);
  const b = programsIn(worked);
  // One program each, plainly named, and different.
  if (a?.length !== 1 || b?.length !== 1) return undefined;
  const [from] = a;
  const [to] = b;
  if (!from || !to || from === to) return undefined;
  // The same job: the same arguments, or near enough.
  if (sameArgs(argsOf(failed), argsOf(worked)) < 0.5) return undefined;
  return {
    text: `On this computer, \`${from}\` isn’t found; \`${to}\` works.`,
    quote: worked.slice(0, 240),
  };
}

/**
 * What a chat's log says between `afterSeq` and `beforeSeq`: your words, what
 * they say about the replies, and what this computer turned out to need.
 */
export function signalsOf(
  events: readonly ConversationEvent[],
  range: { afterSeq?: number; beforeSeq?: number } = {},
): ChatSignals {
  const inRange = (seq: number) =>
    seq > (range.afterSeq ?? Number.NEGATIVE_INFINITY) &&
    seq < (range.beforeSeq ?? Number.POSITIVE_INFINITY);
  const found = new Set<LearningSignal>();
  const said: Said[] = [];
  const environment: EnvironmentFact[] = [];
  const started = new Map<string, { name: string; input: unknown }>();
  /** A command that failed for want of a program, waiting to see what works instead. */
  let failed: { command: string; steps: number } | undefined;
  /** A reply came since your last words: what you say next is about it. */
  let replied = false;
  let last: Said | undefined;

  for (const e of events) {
    if (!inRange(e.seq)) {
      // Before the stretch: what you said last, and whether a reply followed, still count.
      if (e.type === 'user.message') {
        last = { seq: e.seq, at: e.at, text: e.text };
        replied = false;
      } else if (e.type === 'turn.completed') replied = true;
      continue;
    }
    switch (e.type) {
      case 'user.message': {
        const text = e.text.trim();
        if (!text) break;
        let signal: LearningSignal | undefined;
        if (last && normal(last.text) === normal(text)) signal = 'retry';
        else if (replied && CORRECTION.test(text)) signal = 'correction';
        else if (replied && FRUSTRATION.test(text)) signal = 'frustration';
        else if (replied && last && overlap(last.text, text) >= 0.5) signal = 'rephrase';
        else if (replied && pleased(text)) signal = 'pleased';
        const entry: Said = { seq: e.seq, at: e.at, text, ...(signal && { signal }) };
        if (signal) found.add(signal);
        said.push(entry);
        last = entry;
        replied = false;
        failed = undefined;
        break;
      }
      case 'turn.completed':
        replied = true;
        if (e.outcome === 'interrupted') found.add('stopped');
        break;
      case 'files.restored':
        if (e.direction === 'undo') found.add('files-undone');
        break;
      case 'memory.decided':
        if (!e.kept) found.add('memory-undone');
        break;
      case 'tool.started':
        started.set(e.toolUseId, { name: e.name, input: e.input });
        break;
      case 'tool.finished': {
        const call = started.get(e.toolUseId);
        const command = call && commandOf(call.name, call.input);
        if (!command) break;
        // Some shells say a program is missing and still end "successfully".
        if (missing(command, e.output)) {
          failed = { command, steps: 0 };
          break;
        }
        if (e.status !== 'success') break;
        if (failed) {
          const fact = environmentFact(failed.command, command);
          if (fact && !environment.some((f) => f.text === fact.text)) {
            environment.push(fact);
            found.add('worked-another-way');
          }
          // Only the next few steps count as "instead".
          failed.steps += 1;
          if (fact || failed.steps >= 3) failed = undefined;
        }
        break;
      }
    }
  }
  const words = said.map((s) => s.text).join('\n');
  return {
    signals: ORDER.filter((s) => found.has(s)),
    said,
    environment,
    durable: ABOUT_ME.test(words) && LASTING.test(words),
  };
}

/** The command's own program is what wasn't found: the output says so, and names it. */
function missing(command: string, output: string | undefined): boolean {
  if (!output) return false;
  const program = programsIn(command)?.[0];
  if (!program) return false;
  const head = output.slice(0, 2000);
  return (
    NOT_FOUND.some((pattern) => pattern.test(head)) &&
    head.toLowerCase().includes(program.toLowerCase())
  );
}
