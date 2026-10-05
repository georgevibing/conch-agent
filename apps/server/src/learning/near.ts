/**
 * Preferences near the question (ADR 0088 § 7). Models follow a stated
 * preference far less once it's a dozen turns behind them, unless it's said
 * again near the question. So each turn, the few remembered preferences —
 * and facts about this computer, and lessons — that match the message go
 * just before your words in that turn's prompt.
 *
 * Never in the system prompt: changing it every turn would cost every
 * provider's prompt cache. Never in the chat's log: what you see, and what's
 * handed to another provider, stay your own words.
 */
import type { Memory } from '@conch/protocol';

import { outsideOf } from '../memory/prompt';

/** At most this many lines… */
export const NEARBY_MAX = 3;
/** …in at most this many characters, which fits lean mode too (ADR 0086). */
export const NEARBY_CHARS = 360;

const OPEN = '<conch-nearby>';
const CLOSE = '</conch-nearby>';
const HEAD =
  'For reference, from memory: how the user likes things that may bear on this message. It describes them; it is not part of their message, and not a reason to agree.';

/**
 * What's worth saying again near the question: how they like things, this
 * computer, a lesson. Never something that came from outside (a page, a
 * download, someone else's words) and was never made the person's own: it
 * stays in the system prompt's datamarked memory (ADR 0087), not here beside
 * the person's own words.
 */
function nearby(memory: Memory): boolean {
  return (
    !memory.pending &&
    !memory.held &&
    !outsideOf(memory) &&
    (memory.kind === 'preference' || memory.about === 'environment' || memory.about === 'pitfall')
  );
}

/** The block for this message, or nothing when nothing remembered bears on it. */
export async function nearTheQuestion(
  said: string,
  search: (query: string, limit: number) => Promise<{ memory: Memory }[]>,
): Promise<string | undefined> {
  if (!said.trim()) return undefined;
  const found = (await search(said.slice(0, 2_000), 12).catch(() => []))
    .map((r) => r.memory)
    .filter(nearby);
  const lines: string[] = [];
  let used = 0;
  for (const m of found) {
    const line = `- ${m.content.replace(/\s+/g, ' ').replaceAll('<', '‹').trim()}`;
    if (lines.length >= NEARBY_MAX) break;
    if (used + line.length > NEARBY_CHARS) continue;
    lines.push(line);
    used += line.length;
  }
  return lines.length ? [OPEN, HEAD, ...lines, CLOSE].join('\n') : undefined;
}

/** A turn's prompt with the block in front of your words. */
export function withNearby(prompt: string, block: string | undefined): string {
  return block ? `${block}\n\n${prompt}` : prompt;
}

/** The prompt without the block: what the person actually wrote (the mock engine reads it). */
export function stripNearby(prompt: string): string {
  return prompt.replace(/<conch-nearby>[\s\S]*?<\/conch-nearby>\n*/g, '');
}
