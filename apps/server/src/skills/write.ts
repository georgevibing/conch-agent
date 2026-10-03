import { SKILL_IDEA_MAX, type Usage } from '@conch/protocol';

import type { Engine } from '../engines/types';
import {
  cleanSkillDescription,
  cleanSkillTitle,
  composeDescription,
  fallbackDraft,
  parseDraftReply,
} from './draft';
import { splitTitle } from './frontmatter';

/** Writing the steps takes longer than naming them; past this, your words stay as they are. */
const WRITE_TIMEOUT_MS = 90_000;
/** A skill's steps, as a model should write them: enough to follow, short enough to read. */
const MAX_INSTRUCTIONS_CHARS = 12_000;
const MIN_INSTRUCTIONS_CHARS = 40;
const REFUSAL = /\b(?:i can(?:no|')t|i cannot|i'm sorry|as an ai|i'm unable)\b/i;

/**
 * The house style for a whole skill: the title and description read like every
 * other skill's (`DRAFT_SYSTEM`), and the steps are written to the assistant,
 * keeping every specific the person gave and inventing none.
 */
export const WRITE_SYSTEM = [
  'You write skills for a personal AI assistant. A skill is a saved set of instructions the assistant follows for one kind of task, in any chat, with whatever tools it has.',
  'From the person’s idea or rough notes, write the whole skill.',
  'Reply with JSON only, no code fence: {"title": "...", "does": "...", "when": "...", "instructions": "..."}.',
  'title: 1 to 4 words in sentence case naming the task, e.g. "Weekly review". No quotes, emoji or trailing punctuation.',
  'does: one short clause, at most 75 characters, starting with a third-person verb, saying what it does or produces. Never start with "This skill", "Helps" or "Assists".',
  'when: one short clause, at most 65 characters, starting with "Use when", naming the request or situation that should trigger it.',
  'instructions: Markdown, written to the assistant in the second person. One sentence on the goal; then "## Steps", a numbered list of 3 to 8 concrete steps; then "## Good to know": the tone, the shape of the result, and what to leave out. 80 to 350 words.',
  'Keep every specific the person gave: names, days, places, formats, tools, sources. Don’t invent facts about them, tools or apps they didn’t mention, or any password, key or account. Where a detail is missing, ask for it in a step (“Ask which calendar to use if it isn’t clear”) rather than guess.',
  'No front matter and no title heading. Write everything in the language of the idea.',
].join('\n');

export function writePrompt(idea: string): string {
  return `Write the skill for this idea:\n\n<idea>\n${idea.trim().slice(0, SKILL_IDEA_MAX)}\n</idea>`;
}

/** The steps from a model's reply, made into a skill body — or undefined if they aren't usable. */
export function cleanInstructions(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let text = raw
    .replace(/\r\n?/g, '\n')
    .trim()
    // A fence around the whole thing.
    .replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i, '$1')
    .trim();
  // Front matter belongs to Conch, which writes its own.
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  // The title is Conch's to add, from the title field.
  text = splitTitle(text).instructions.trim();
  if (text.length < MIN_INSTRUCTIONS_CHARS || REFUSAL.test(text.slice(0, 200))) return undefined;
  return text.slice(0, MAX_INSTRUCTIONS_CHARS).trim();
}

/** The fields of a reply, forgiving a code fence or a chatty line around the JSON. */
function parseWriteReply(
  text: string,
): { instructions?: string } & ReturnType<typeof parseDraftReply> {
  const fields = parseDraftReply(text);
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  let instructions: string | undefined;
  if (json) {
    try {
      const value = JSON.parse(json) as Record<string, unknown>;
      if (typeof value.instructions === 'string') instructions = value.instructions;
    } catch {
      // No steps, then.
    }
  }
  return { ...fields, instructions };
}

export interface WriteResult {
  skill: { instructions: string; title: string; description: string; generated: boolean };
  usage?: Usage;
}

/**
 * A whole skill from an idea, written by the engine's default model (then its
 * small one) — or, with no engine that can write, or a reply that isn't a
 * skill, the idea kept as it is, with a title and description taken from it.
 * Never throws.
 */
export async function writeSkill(
  engine: Pick<Engine, 'complete' | 'smallModel'> | undefined,
  idea: string,
  signal?: AbortSignal,
): Promise<WriteResult> {
  const kept = { instructions: idea.trim(), ...fallbackDraft(idea), generated: false };
  if (!engine?.complete) return { skill: kept };
  const timeout = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(WRITE_TIMEOUT_MS),
  ]);
  let usage: Usage | undefined;
  for (const model of [undefined, engine.smallModel]) {
    if (timeout.aborted) break;
    try {
      const reply = await engine.complete({
        system: WRITE_SYSTEM,
        prompt: writePrompt(idea),
        model,
        maxTokens: 2_000,
        signal: timeout,
      });
      usage = reply.usage ?? usage;
      const parsed = parseWriteReply(reply.text);
      const instructions = cleanInstructions(parsed.instructions);
      if (!instructions) continue;
      const fallback = fallbackDraft(instructions);
      return {
        skill: {
          instructions,
          title: cleanSkillTitle(parsed.title) ?? fallback.title,
          description:
            cleanSkillDescription(
              composeDescription(parsed.does, parsed.when) ?? parsed.description,
            ) ?? fallback.description,
          generated: true,
        },
        ...(usage && { usage }),
      };
    } catch {
      // Try the small model, if there is one.
    }
    if (!engine.smallModel) break;
  }
  return { skill: kept, ...(usage && { usage }) };
}
