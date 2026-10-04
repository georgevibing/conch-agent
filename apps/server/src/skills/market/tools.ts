/**
 * `find_skills` (ADR 0072): the assistant looks for a skill people share,
 * to `offer` it with kind `market`. It never adds anything.
 *
 * What comes back is only what Conch can vouch for the shape of: each
 * skill's id, its name as plain words (letters, digits and spaces, from the
 * skill's own name), the shelf Conch put it on, where it's from and how many
 * use it. A stranger's description never reaches the model, so a listing
 * can't steer the chat or talk it into offering anything. The person reads
 * the description on the card, drawn by Conch.
 *
 * Not in a chat that has read something from outside (a page must not get a
 * skill offered), nor when nobody is there to press the card.
 */
import { MARKET_CATEGORY_LABELS, type MarketListing } from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../../conversations/manager';
import type { HostTool } from '../../engines/types';
import type { SkillMarket } from './service';

const MAX_FOUND = 5;

/** The words a search may send out: at most eight plain words, nothing a search engine reads as an operator. */
export function searchWords(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && w.length <= 30 && !['and', 'or', 'not'].includes(w))
    .slice(0, 8)
    .join(' ')
    .slice(0, 100);
}

/** A name as plain words: `pdf-tools_v2` → `pdf tools v2`. */
const words = (name: string) =>
  name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .slice(0, 64);

const many = (n: number) =>
  n >= 1000 ? `${Math.round(n / 100) / 10}k people use it`.replace('.0k', 'k') : `${n} use it`;

function line(l: MarketListing): string {
  const about = [
    l.category && MARKET_CATEGORY_LABELS[l.category],
    l.sourceLabel,
    l.trust === 'official'
      ? 'from the model’s maker'
      : l.trust === 'verified'
        ? 'publisher vouched for by the registry'
        : undefined,
    l.installs ? many(l.installs) : undefined,
  ].filter(Boolean);
  return `- \`${l.id}\`: ${words(l.name)} (${about.join(', ')})`;
}

export function marketTools(
  market: Pick<SkillMarket, 'search'>,
  ctx: Pick<ToolContext, 'unattended' | 'taints' | 'signal'>,
): HostTool[] {
  const find: HostTool<{ words: z.ZodString }> = {
    name: 'find_skills',
    description:
      'Search skills people share (Anthropic, ClawHub, skills.sh) for one that would help with what the person asked. Give a few plain words for the kind of task ("meeting notes", "presentation slides"). Returns ids to `offer` with kind `market`; the person reads the skill and decides. Never adds anything.',
    input: { words: z.string().min(1).max(200) },
    // The map tells the model to call it, so it must be there, not waiting to be searched for.
    alwaysLoad: true,
    searchHint: 'search marketplace skills people share to offer one',
    run: async ({ words: asked }) => {
      if (ctx.unattended)
        return 'Nobody is here to look at a skill, so Conch didn’t search. Do what you can without one.';
      if (ctx.taints?.().length)
        return 'This chat has read something from outside, so Conch doesn’t look for skills to offer in it. Answer with what you have; the person can look in Skills → Discover.';
      const q = searchWords(asked);
      if (!q) return 'Give a few plain words for the kind of task.';
      const found = await market.search({ q }, ctx.signal).catch(() => undefined);
      if (!found) return 'Conch couldn’t search for skills just now. Answer with what you have.';
      const usable = found.listings
        .filter((l) => !l.installed && l.trust !== 'flagged' && l.trust !== 'blocked')
        .slice(0, MAX_FOUND);
      if (!usable.length)
        return found.stale
          ? 'Conch couldn’t reach the places skills come from, and found nothing from before. Answer with what you have.'
          : `No skill people share matches “${q}”. Answer with what you have.`;
      return [
        'Skills people share that match. Offer at most one, with `offer` (kind `market`), only if it clearly fits; the person reads it before anything is added.',
        ...usable.map(line),
      ].join('\n');
    },
  };
  return [find as HostTool];
}
