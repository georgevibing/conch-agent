import { SKILL_DESCRIPTION_MAX, SkillName, type SkillDraft, type Usage } from '@conch/protocol';

import { cheapestModel } from '../conversations/title';
import type { Engine } from '../engines/types';
import { splitTitle } from './frontmatter';

/** Give up on a model after this long; the fallback is instant. */
const DRAFT_TIMEOUT_MS = 25_000;
/** Enough of the instructions to know what they're for. */
const MAX_PROMPT_CHARS = 6_000;
const MAX_TITLE_CHARS = 40;
const MAX_TITLE_WORDS = 5;

/**
 * The house style, so every skill in the list reads alike: a title of a few
 * words, and a description that says what it does and when to use it — in one
 * line short enough for the strictest reader (OpenClaw, under 160).
 */
export const DRAFT_SYSTEM = [
  'You name and describe skills for a personal AI assistant. A skill is a saved set of instructions for one kind of task.',
  'Reply with JSON only, no code fence: {"title": "...", "does": "...", "when": "..."}.',
  'title: 1 to 4 words in sentence case naming the task, e.g. "Weekly review", "Release notes", "Tidy downloads". No quotes, emoji or trailing punctuation.',
  'does: one short clause, at most 75 characters, starting with a third-person verb, saying what it does or produces, e.g. "Drafts a weekly review from your calendar and notes". Never start with "This skill", "Helps" or "Assists".',
  'when: one short clause, at most 65 characters, starting with "Use when", naming the request or situation that should trigger it, e.g. "Use when asked to review or plan the week".',
  'Concrete, plain words, no trailing punctuation. Write all three in the language of the instructions.',
].join('\n');

export function draftPrompt(instructions: string): string {
  return `Name and describe the skill with these instructions:\n\n<instructions>\n${instructions.trim().slice(0, MAX_PROMPT_CHARS)}\n</instructions>`;
}

const WRAP = /^["'“”‘’`*_#\s]+|["'“”‘’`*_\s]+$/g;
const REFUSAL = /\b(?:i can(?:no|')t|i cannot|i'm sorry|as an ai|i'm unable)\b/i;

/** The two halves, in the house shape: "Does X. Use when Y." — dropping the second if it won't fit. */
export function composeDescription(does: string | undefined, when: string | undefined) {
  const part = (text: string | undefined) =>
    text
      ?.replace(WRAP, '')
      .replace(/\s+/g, ' ')
      .replace(/[.!?。]+$/u, '')
      .trim();
  const first = part(does);
  if (!first) return undefined;
  const lead = `${first.charAt(0).toLocaleUpperCase()}${first.slice(1)}.`;
  const second = part(when);
  const trigger = second ? `${second.charAt(0).toLocaleUpperCase()}${second.slice(1)}.` : '';
  const both = trigger ? `${lead} ${trigger}` : lead;
  return both.length <= SKILL_DESCRIPTION_MAX ? both : lead;
}

/** A model's title, or undefined if it isn't a usable one. */
export function cleanSkillTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const title = raw
    .split('\n')[0]
    ?.replace(/^title\s*[:：-]\s*/i, '')
    .replace(WRAP, '')
    .replace(/[.!?:;,。]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || title.length < 2 || title.length > MAX_TITLE_CHARS) return undefined;
  if (title.split(' ').length > MAX_TITLE_WORDS || REFUSAL.test(title)) return undefined;
  return title.charAt(0).toLocaleUpperCase() + title.slice(1);
}

/** A model's description, or undefined if it isn't a usable one. */
export function cleanSkillDescription(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let text = raw
    .replace(/^description\s*[:：-]\s*/i, '')
    .replace(WRAP, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || REFUSAL.test(text)) return undefined;
  if (!/[.!?。]$/u.test(text)) text += '.';
  if (text.length > SKILL_DESCRIPTION_MAX) {
    // Keep whole sentences rather than cutting one in half.
    const sentences = text.match(/[^.!?。]+[.!?。]+/gu) ?? [];
    let kept = '';
    for (const sentence of sentences) {
      if ((kept + sentence).trim().length > SKILL_DESCRIPTION_MAX) break;
      kept += sentence;
    }
    text = kept.trim();
  }
  if (text.length < 12) return undefined;
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** `Weekly review` → `weekly-review`; always a valid skill name. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return SkillName.safeParse(slug).success && slug ? slug : 'skill';
}

/** `weekly-review` → `Weekly review`. */
export function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : name;
}

const LITTLE = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'into',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'your',
]);

/**
 * Title and description without a model: the heading or first line, and the
 * first sentence. Plain, but never wrong about what the person wrote.
 */
export function fallbackDraft(instructions: string): { title: string; description: string } {
  const { title: heading, instructions: body } = splitTitle(instructions.trim());
  const firstLine = body
    .split('\n')
    .map((l) => l.replace(/^[-*>#\d.)\s]+/, '').trim())
    .find(Boolean);
  // The first clause, at most four words, not ending on a little word ("look at").
  const words =
    (firstLine ?? '')
      .split(/[,.;:!?—–(]/)[0]
      ?.trim()
      .split(/\s+/)
      .slice(0, 4) ?? [];
  while (words.length > 1 && LITTLE.has((words.at(-1) ?? '').toLowerCase())) words.pop();
  const title = cleanSkillTitle(heading) ?? cleanSkillTitle(words.join(' ')) ?? 'New skill';
  const flat = body
    .replace(/^#+\s.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = /^(.+?[.!?。])(?:\s|$)/u.exec(flat)?.[1] ?? flat;
  let description = sentence;
  if (description.length > SKILL_DESCRIPTION_MAX) {
    const cut = description.slice(0, SKILL_DESCRIPTION_MAX - 1);
    description = `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:\s]+$/, '')}…`;
  }
  return { title, description: description || title };
}

export interface DraftReply {
  title?: string;
  /** "Drafts a weekly review from your calendar" */
  does?: string;
  /** "Use when asked to review the week" */
  when?: string;
  /** A whole description, from a model that ignored the halves. */
  description?: string;
}

/** Pull the fields out of a reply, forgiving a code fence or a chatty line. */
export function parseDraftReply(text: string): DraftReply {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (json) {
    try {
      const value = JSON.parse(json) as unknown;
      if (value && typeof value === 'object') {
        const fields = value as Record<string, unknown>;
        const field = (key: string) =>
          typeof fields[key] === 'string' ? (fields[key] as string) : undefined;
        return {
          title: field('title'),
          does: field('does'),
          when: field('when'),
          description: field('description'),
        };
      }
    } catch {
      // Fall through to the line-based reading.
    }
  }
  const line = (label: string) =>
    new RegExp(`^\\s*${label}\\s*[:：-]\\s*(.+)$`, 'im').exec(text)?.[1]?.trim();
  return {
    title: line('title'),
    does: line('does'),
    when: line('when'),
    description: line('description'),
  };
}

export interface DraftResult {
  draft: Omit<SkillDraft, 'name'>;
  usage?: Usage;
}

/**
 * A title and description for these instructions, written by the engine's
 * cheapest model — or, if there's no engine that can, or it fails, taken from
 * the text itself. Never throws.
 */
export async function draftSkill(
  engine: Pick<Engine, 'capabilities' | 'complete' | 'smallModel'> | undefined,
  instructions: string,
  signal?: AbortSignal,
): Promise<DraftResult> {
  const fallback = fallbackDraft(instructions);
  if (!engine?.complete) return { draft: { ...fallback, generated: false } };
  const models = await engine
    .capabilities()
    .then((c) => c.models)
    .catch(() => []);
  const cheap = cheapestModel(models) ?? engine.smallModel;
  const timeout = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(DRAFT_TIMEOUT_MS),
  ]);
  for (const model of cheap ? [cheap, undefined] : [undefined]) {
    if (timeout.aborted) break;
    try {
      const reply = await engine.complete({
        system: DRAFT_SYSTEM,
        prompt: draftPrompt(instructions),
        model,
        signal: timeout,
      });
      const parsed = parseDraftReply(reply.text);
      const title = cleanSkillTitle(parsed.title);
      const description = cleanSkillDescription(
        composeDescription(parsed.does, parsed.when) ?? parsed.description,
      );
      if (!title && !description)
        return { draft: { ...fallback, generated: false }, usage: reply.usage };
      return {
        draft: {
          title: title ?? fallback.title,
          description: description ?? fallback.description,
          generated: true,
        },
        usage: reply.usage,
      };
    } catch {
      // Try the next model, if any.
    }
  }
  return { draft: { ...fallback, generated: false } };
}
