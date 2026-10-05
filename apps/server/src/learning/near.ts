/**
 * Preferences near the question (ADR 0087 § 7). Models follow a stated
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

/** At most this many lines… */
export const NEARBY_MAX = 3;
/** …in at most this many characters, which fits lean mode too (ADR 0086). */
export const NEARBY_CHARS = 360;

const OPEN = '<conch-nearby>';
const CLOSE = '</conch-nearby>';
const HEAD =
  'From memory, what the user prefers that bears on this message (follow it where it fits; it is not a reason to agree):';

/** What's worth saying again near the question: how they like things, this computer, a lesson. */
function nearby(memory: Memory): boolean {
  return (
    !memory.pending &&
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
    if (lines.length >= NEARBY_MAX || used + line.length > NEARBY_CHARS) break;
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
