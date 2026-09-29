import type { ModelInfo, Usage } from '@conch/protocol';

import type { Engine } from '../engines/types';

/** Give up on a title after this long; the first line stays. */
const TITLE_TIMEOUT_MS = 20_000;
/** Enough of the opener to know what it's about, without paying for a pasted log. */
const MAX_PROMPT_CHARS = 2_000;
const MAX_TITLE_CHARS = 60;
const MAX_TITLE_WORDS = 8;

export const TITLE_SYSTEM = [
  'You name chat conversations for a sidebar.',
  'Reply with only the title: 2 to 6 words, sentence case, in the language of the message.',
  "Capture what the person wants or is talking about — its essence, not its first words. For small talk, describe it (e.g. 'Friendly check-in').",
  'No quotes, no trailing punctuation, no emoji, no preamble.',
].join(' ');

/** Tiers we know are cheap. The first model whose id or name matches wins. */
const CHEAP = [/haiku/i, /\b(mini|nano|flash|lite)\b/i];

/** The cheapest model the engine offers, or undefined to use its default. */
export function cheapestModel(
  models: readonly Pick<ModelInfo, 'id' | 'label'>[],
): string | undefined {
  for (const pattern of CHEAP) {
    const hit = models.find((m) => pattern.test(m.id) || pattern.test(m.label));
    if (hit) return hit.id;
  }
  return undefined;
}

const PREFIX = /^(?:title|conversation title|chat title)\s*[:：-]\s*/i;
const WRAP = /^["'“”‘’`*_#\s]+|["'“”‘’`*_\s]+$/g;
const REFUSAL =
  /\b(?:i can(?:no|')t|i cannot|i'm sorry|i am sorry|sorry,|as an ai|i'm unable|i am unable|unable to (?:help|comply)|here(?: i|')s a title)\b/i;
const GENERIC =
  /^(?:untitled|new (?:chat|conversation)|(?:a )?conversation|chat|title|none|n\/a|null)$/i;

/**
 * Turn a model's reply into a sidebar title — or undefined if it isn't good
 * enough (empty, too long, a refusal, a placeholder), so the caller keeps the
 * first-line title instead.
 */
export function cleanTitle(raw: string): string | undefined {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return undefined;
  if (REFUSAL.test(line)) return undefined;
  const title = line
    .replace(PREFIX, '')
    .replace(WRAP, '')
    .replace(/[.!?:;,。]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length < 3 || title.length > MAX_TITLE_CHARS) return undefined;
  if (title.split(' ').length > MAX_TITLE_WORDS) return undefined;
  if (GENERIC.test(title)) return undefined;
  return title.charAt(0).toLocaleUpperCase() + title.slice(1);
}

export function titlePrompt(text: string): string {
  const opener = text.trim().slice(0, MAX_PROMPT_CHARS);
  return `Name the conversation that starts with this message:\n\n<message>\n${opener}\n</message>`;
}

export interface TitleResult {
  title?: string;
  /** What naming it cost, to add to the spend ledger. */
  usage?: Usage;
}

/**
 * Ask the engine for a descriptive title, on its cheapest model — one from its
 * list, else its small-model alias. If that model
 * fails (not on this plan, say), try once more on the default. A reply that
 * isn't a usable title is not retried: the first line is a fine fallback, and
 * paying a bigger model to name a chat isn't.
 */
export async function generateTitle(
  engine: Pick<Engine, 'capabilities' | 'complete' | 'smallModel'>,
  text: string,
  signal: AbortSignal,
): Promise<TitleResult> {
  if (!engine.complete) return {};
  const models = await engine
    .capabilities()
    .then((c) => c.models)
    .catch(() => []);
  const cheap = cheapestModel(models) ?? engine.smallModel;
  const attempts = cheap ? [cheap, undefined] : [undefined];
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(TITLE_TIMEOUT_MS)]);
  for (const model of attempts) {
    if (timeout.aborted) break;
    try {
      const reply = await engine.complete({
        system: TITLE_SYSTEM,
        prompt: titlePrompt(text),
        model,
        signal: timeout,
      });
      return { title: cleanTitle(reply.text), usage: reply.usage };
    } catch {
      // Try the next model, if any.
    }
  }
  return {};
}
