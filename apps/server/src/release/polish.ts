/**
 * Notes, polished by a model (ADR 0048) — optional, and held to the
 * deterministic notes it starts from.
 *
 * The model gets the groups `notes.ts` found (each a line and the commits it
 * came from) and gives the notes back as JSON, each line naming the groups it
 * speaks for. What comes back is checked before anyone sees it: every line
 * traceable to a group, a few short lines a section, no hype, no exclamation
 * marks, nothing that isn't plain text. Anything off and the deterministic
 * notes stand. The maintainer reads the result in the preview before saying
 * yes, and `--no-ai` skips this.
 *
 * Claude Code (`claude -p`) when it's installed; else the Anthropic API with
 * `ANTHROPIC_API_KEY`. Nothing else is sent: commit subjects, never code.
 */
import { z } from 'zod';

import { findExecutable, run } from '../lib/proc';
import { LIMITS, SECTIONS, type Group, type Notes } from './notes';

const MODEL = 'claude-opus-5-5';
const TIMEOUT_MS = 120_000;

/** Words a release note never needs. */
const HYPE =
  /\b(revolutionary|blazing|lightning|amazing|awesome|incredible|game[- ]chang\w*|seamless(ly)?|magical|supercharg\w*|unleash\w*|delight\w*|cutting[- ]edge|world[- ]class|next[- ]level|powerful|robust)\b/i;

const Line = z.object({ text: z.string().min(3).max(110), from: z.array(z.number().int()).min(1) });
const Reply = z.object({
  headsUp: z.array(Line).max(LIMITS.headsUp).default([]),
  new: z.array(Line).max(LIMITS.new).default([]),
  better: z.array(Line).max(LIMITS.better).default([]),
  fixed: z.array(Line).max(LIMITS.fixed).default([]),
});

export function prompt(version: string, groups: Group[], notes: Notes): string {
  const list = groups
    .map(
      (g, i) =>
        `${i}. [${g.section}] ${g.line}\n${g.commits.map((c) => `     - ${c.subject}`).join('\n')}`,
    )
    .join('\n');
  return `You write the release notes for Conch ${version}, a personal AI assistant people run on their own computer.

Below are the changes in this release, already grouped: each numbered group is one feature or fix, with the commits it came from. A plain first draft follows.

Rewrite the notes so a person who uses Conch (not a developer) sees at a glance what they can now do.

Rules:
- One line per benefit, from the person's side ("Edit pages by hand, with a live preview"), never how it was built. No component names, file names, protocol, ADRs or tests.
- Concise and plain: under 90 characters a line, no hype, no exclamation marks, no emoji, no marketing words.
- Only what the groups say. Never invent a feature or a detail. Several related groups may become one line.
- Every line lists the numbers of the groups it comes from in "from".
- Sections: "headsUp" (only for groups marked headsUp: what changes and what the person must do), "new", "better", "fixed". At most ${LIMITS.headsUp}, ${LIMITS.new}, ${LIMITS.better} and ${LIMITS.fixed} lines. Leave out what few people would notice when there is too much.
- Answer with only the JSON object, nothing before or after it:
{"headsUp":[{"text":"…","from":[0]}],"new":[],"better":[],"fixed":[]}

Groups:
${list}

First draft:
${JSON.stringify(notes)}
`;
}

/** The model's answer, checked; `undefined` when it isn't good enough to show. */
export function readReply(
  text: string,
  groups: Group[],
): { notes: Notes; problem?: undefined } | { notes?: undefined; problem: string } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { problem: 'the answer wasn’t JSON' };
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { problem: 'the answer wasn’t JSON' };
  }
  const reply = Reply.safeParse(json);
  if (!reply.success) return { problem: 'the answer had too many or too long lines' };
  const notes: Notes = { headsUp: [], new: [], better: [], fixed: [] };
  const breaking = new Set(groups.flatMap((g, i) => (g.section === 'headsUp' ? [i] : [])));
  for (const [key] of SECTIONS) {
    for (const line of reply.data[key]) {
      const text = line.text.replace(/\s+/g, ' ').trim();
      if (line.from.some((i) => i < 0 || i >= groups.length))
        return { problem: 'a line came from nowhere' };
      if (key === 'headsUp' && !line.from.every((i) => breaking.has(i)))
        return { problem: 'a heads-up wasn’t about a breaking change' };
      if (HYPE.test(text) || /[!<>`]|https?:/.test(text) || /\p{Extended_Pictographic}/u.test(text))
        return { problem: 'a line didn’t read plainly' };
      notes[key].push(text.charAt(0).toUpperCase() + text.slice(1).replace(/\.$/, ''));
    }
  }
  // Every breaking change still says what to do.
  if (breaking.size && !notes.headsUp.length) return { problem: 'the heads-up went missing' };
  if (!notes.new.length && !notes.better.length && !notes.fixed.length && !notes.headsUp.length)
    return { problem: 'the answer was empty' };
  return { notes };
}

export interface PolishDeps {
  /** Claude Code's path, if it's installed. */
  claude?: () => Promise<string | undefined>;
  /** Asks the API; tests answer for it. */
  api?: (prompt: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

export type Polished =
  { kind: 'polished'; notes: Notes; by: string } | { kind: 'skipped'; why: string };

async function viaApi(text: string): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: text }],
  });
  if (response.stop_reason === 'refusal') throw new Error('it declined');
  return response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
}

/** Ask a model to polish the notes; the deterministic ones stand whenever that doesn't work. */
export async function polish(
  version: string,
  groups: Group[],
  notes: Notes,
  deps: PolishDeps = {},
): Promise<Polished> {
  if (!groups.length) return { kind: 'skipped', why: 'nothing to polish' };
  const env = deps.env ?? process.env;
  const ask = prompt(version, groups, notes);
  const claude = await (deps.claude ?? (() => findExecutable('claude')))();
  let answer: string | undefined;
  let by = '';
  if (claude) {
    const result = await run(claude, ['-p', '--output-format', 'text'], {
      input: ask,
      timeout: TIMEOUT_MS,
      env: Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    });
    if (result.code === 0 && result.stdout.trim()) {
      answer = result.stdout;
      by = 'Claude Code';
    }
  }
  if (answer === undefined && (deps.api || env.ANTHROPIC_API_KEY)) {
    try {
      answer = await (deps.api ?? viaApi)(ask);
      by = 'the Anthropic API';
    } catch (error) {
      return {
        kind: 'skipped',
        why: `the Anthropic API didn’t answer (${(error as Error).message})`,
      };
    }
  }
  if (answer === undefined)
    return {
      kind: 'skipped',
      why: claude ? 'Claude Code didn’t answer' : 'no Claude Code or ANTHROPIC_API_KEY here',
    };
  const read = readReply(answer, groups);
  if (!read.notes)
    return { kind: 'skipped', why: `${by}’s version was set aside: ${read.problem}` };
  return { kind: 'polished', notes: read.notes, by };
}
