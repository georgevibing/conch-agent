import type { ConversationEventInput } from '@conch/protocol';
import { z } from 'zod';

import type { Engine, HostTool } from '../engines/types';
import type { OfferDesk, OfferDrop } from './desk';

/** What the model is told when nothing was shown, so it answers without the card. */
const DROPPED: Record<OfferDrop, (name: string) => string> = {
  'not-in-map': () =>
    'Nothing was shown: that isn’t something Conch can turn on here (it’s on already, not in the list, or this provider has it by itself). Answer with what you have.',
  muted: (name) =>
    `Nothing was shown: the person asked not to be offered ${name}. Don’t mention it; answer with what you have.`,
  offered: (name) =>
    `Nothing was shown: ${name} was offered in this chat already. Don’t offer it again; answer with what you have.`,
  'one-per-turn': () =>
    'Nothing was shown: there’s already an offer under this reply. Answer with what you have.',
  untrusted: () =>
    'Nothing was shown: this chat has read something from outside, so Conch doesn’t show offers the assistant asks for. Answer with what you have; the person can turn things on from Apps or Skills.',
  unattended: () =>
    'Nothing was shown: nobody is here to press it. Do what you can without it, and say what it would need.',
};

/**
 * `offer` (ADR 0060 §2): the assistant proposes one app or skill from the
 * map, and the person decides. It never turns anything on.
 */
export function offerTools(
  desk: Pick<OfferDesk, 'propose'>,
  ctx: {
    conversationId: string;
    engine: Engine;
    append: (event: ConversationEventInput) => void;
    unattended?: boolean;
  },
): HostTool[] {
  const offer: HostTool<{
    kind: z.ZodEnum<{ app: 'app'; skill: 'skill' }>;
    target: z.ZodString;
    why: z.ZodOptional<z.ZodString>;
  }> = {
    name: 'offer',
    description: [
      'Offer the person one app to connect or one skill to turn on, from “What Conch can turn on”, when it would clearly do what they asked. They get a card under your reply; nothing is turned on unless they press it. An app that isn’t connected has no tools to search for: call this instead.',
      '`kind` is `app` or `skill`, `target` its id from that list, `why` one short sentence in your own voice on how it helps with this request.',
      'Answer what you can first, and don’t explain how to set it up: the card does that. When it’s on, the chat carries on with the request by itself.',
    ].join(' '),
    input: {
      kind: z.enum(['app', 'skill']),
      target: z.string().min(1).max(128),
      why: z.string().max(400).optional(),
    },
    // The map tells the model to call `offer`: it must be there, not waiting to be searched for.
    alwaysLoad: true,
    searchHint: 'offer to connect an app or turn on a skill the person needs',
    run: async ({ kind, target, why }) => {
      const result = await desk.propose({
        conversationId: ctx.conversationId,
        engine: ctx.engine,
        ...(ctx.unattended && { unattended: true }),
        kind,
        target,
        ...(why && { why }),
      });
      if ('dropped' in result) return DROPPED[result.dropped](result.name ?? 'that');
      const { offer: shown } = result;
      ctx.append({ type: 'offer', offer: shown });
      const what =
        shown.kind === 'app' ? `connect ${shown.name}` : `turn on the “${shown.name}” skill`;
      const when = shown.kind === 'app' ? 'it’s connected' : 'it’s on';
      return `A card to ${what} is under your reply. Answer what you can now; when ${when}, you’ll be asked to carry on.`;
    },
  };
  return [offer as HostTool];
}
