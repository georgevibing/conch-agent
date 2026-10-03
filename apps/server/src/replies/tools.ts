/**
 * Replies to send next (ADR 0060 §5): the assistant's own chips. It offers up
 * to three things the person might well say next, in their words; Conch shows
 * them under the reply once it's done, and a tap sends the words as they read.
 */
import { ReplySuggestion } from '@conch/protocol';
import { z } from 'zod';

import type { HostTool } from '../engines/types';

/** Chips under one reply, at most. */
export const MAX_REPLIES = 3;
/** Words on one chip, at most: what `ReplySuggestion` allows. */
export const MAX_REPLY_LENGTH = 120;

/** Says nothing the person couldn't type faster than they'd read it: never a chip. */
const FILLER =
  /^(?:tell me more|more|go on|continue|keep going|thanks?(?: you)?|thank you|ok(?:ay)?|got it|cool|nice|great|yes|no|sure)[.!…]*$/i;

/**
 * What the assistant offered, made fit to show: one line each, trimmed, no
 * filler, no repeats (ignoring case and end punctuation), at most three, each
 * short enough to read at a glance. Too long is dropped, not cut: the words on
 * a chip are the words sent, so half a sentence would be sent as half a sentence.
 */
export function cleanReplies(raw: readonly { text: string }[]): ReplySuggestion[] {
  const seen = new Set<string>();
  const out: ReplySuggestion[] = [];
  for (const { text } of raw) {
    const line = text.replace(/\s+/g, ' ').trim();
    if (!line || line.length > MAX_REPLY_LENGTH || FILLER.test(line)) continue;
    const key = line.toLowerCase().replace(/[.!?…\s]+$/u, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = ReplySuggestion.safeParse({ text: line });
    if (parsed.success) out.push(parsed.data);
    if (out.length === MAX_REPLIES) break;
  }
  return out;
}

export const SUGGEST_REPLIES_DESCRIPTION = [
  'Offer up to three short replies the person might well send you next. They show as buttons under your reply once it’s finished, and a tap sends the words exactly as written.',
  'Call it last, after your reply, and only when there are clear, likely next steps. Most replies need none: then don’t call it.',
  'Write each one in the person’s own voice, the way they would type it to you, in the first person: “Make it shorter”, “Add Ada to the invite”, “Draft the email to Sam”.',
  'Each one concrete and specific to this reply, at most 120 characters. Never filler (“Tell me more”, “Thanks”), never a question to them, and never something you should simply have done already.',
  'Don’t list them in your reply as well. Calling it again replaces the earlier ones.',
].join('\n');

/**
 * The `suggest_replies` host tool. The last call in a turn wins; what's shown
 * is decided when the turn ends (`pickReplies`), so the tool only takes note.
 */
export function suggestRepliesTool(onSuggest: (replies: ReplySuggestion[]) => void): HostTool {
  return {
    name: 'suggest_replies',
    description: SUGGEST_REPLIES_DESCRIPTION,
    input: {
      replies: z
        .array(
          z.object({
            text: z
              .string()
              .min(1)
              .max(MAX_REPLY_LENGTH)
              .describe('What the person would send, in their words: “Make it shorter”.'),
          }),
        )
        .min(1)
        .max(MAX_REPLIES),
    },
    // Claude Code defers tools until searched for: this one must be known to be called at all.
    alwaysLoad: true,
    searchHint: 'suggest replies next steps buttons chips',
    run: async (args) => {
      const replies = cleanReplies((args as { replies: { text: string }[] }).replies);
      onSuggest(replies);
      return replies.length
        ? `Noted. ${replies.length === 1 ? 'It shows' : 'They show'} under your reply when it’s finished. Don’t repeat ${replies.length === 1 ? 'it' : 'them'} in your words.`
        : 'Nothing to show: none of those was a concrete next step in the person’s words. That’s fine; most replies need none.';
    },
  };
}
