/**
 * `suggest_standing_order` (ADR 0107): the assistant offers what the person
 * said as a lasting wish ("always tell me if a flight changes"); a card with
 * Keep it and Not now appears in the chat. Until the person presses Keep it,
 * the suggestion is a draft that no chat and no check-in reads. Never offered
 * where nobody can press the card (a routine's run, a task, a chat app's
 * unattended turn), and never to a guest (a guest's turn has no tools).
 */
import type { ConversationEventInput, StandingOrderKind } from '@conch/protocol';
import { z } from 'zod';

import type { HostTool } from '../engines/types';
import type { StandingOrderStore } from './orders';

export function standingOrderTools(
  orders: StandingOrderStore,
  ctx: {
    conversationId: string;
    append: (event: ConversationEventInput) => void;
    origin?: { kind: string };
    unattended?: boolean;
  },
): HostTool[] {
  if (ctx.unattended || ctx.origin) return [];
  const suggest: HostTool<{
    text: z.ZodString;
    kind: z.ZodOptional<z.ZodEnum<{ tell: 'tell'; may: 'may' }>>;
  }> = {
    name: 'suggest_standing_order',
    description: [
      'Offer the user a standing order: a lasting wish they stated, kept for every chat and for Conch’s check-ins, which tell them about new email and upcoming events only when an order asks for it.',
      'Use it when the user says something that should hold from now on: "always tell me if a flight changes", "let me know when Anna writes", "you may archive newsletters".',
      'Not for one-off tasks, preferences about how you write (those are memories), or anything someone other than the user said.',
      '`text`: their wish in their own words, one short line in the first person, e.g. "Tell me if a flight changes". `kind`: "tell" for what they want to hear about, "may" for what they welcome you to do.',
      'A card lets the user keep it or not. It is not kept until they press Keep it, and it never grants a permission: what asks still asks.',
    ].join(' '),
    input: {
      text: z.string().min(3).max(240),
      kind: z.enum(['tell', 'may']).optional(),
    },
    async run(args) {
      const added = await orders.add({
        text: args.text.replace(/[\r\n]+/g, ' '),
        ...(args.kind && { kind: args.kind as StandingOrderKind }),
        from: 'chat',
        conversationId: ctx.conversationId,
      });
      if (!added.ok) return added.message;
      ctx.append({ type: 'standing.order', orderId: added.order.id, text: added.order.text });
      return 'Offered on a card. It is only a standing order once the user presses Keep it; don’t say it’s kept.';
    },
  };
  return [suggest as HostTool];
}
