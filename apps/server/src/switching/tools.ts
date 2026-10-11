/**
 * Switching models when asked (ADR 0132), for every provider that can use
 * Conch's tools. The assistant is told, in a few lines, which models it can
 * switch to; `switch_model` reads the person's words against what's
 * connected (`resolveSwitch`) and moves the chat, or offers the few that fit
 * as chips, or says nothing fits and offers to connect the provider that would.
 */
import {
  choiceOf,
  type EngineId,
  type ModelRef,
  resolveSwitch,
  type SwitchCandidate,
  switchedLine,
  switchList,
  whereWords,
} from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';

/** What the tool needs from the rest of Conch. */
export interface SwitchDeps {
  /** Every model connected now, with how each is paid for. */
  candidates(): Promise<SwitchCandidate[]>;
  chat: {
    switchContext(
      id: string,
    ): Promise<{ current: ModelRef; previous?: ModelRef; tainted: boolean }>;
    switchModel(
      id: string,
      to: ModelRef,
      how: { by: 'assistant'; label: string; message: string; carry?: boolean },
    ): Promise<
      { switched: true; carrying: boolean; note?: string } | { switched: false; why: string }
    >;
    modelChoices(id: string, choices: ReturnType<typeof choiceOf>[], carry: boolean): Promise<void>;
  };
  /**
   * Offer to connect the provider that serves what was asked for (ADR 0021):
   * true when the card is under the reply. Connected, the chat moves to it.
   */
  offerProvider?(ctx: ToolContext, engine: EngineId, words: string): Promise<boolean>;
  /** A provider's name, for one that isn't connected. */
  providerName?(engine: EngineId): string | undefined;
}

/** Runs that nobody asked from: they keep the model they were given. */
const NOT_ASKED = new Set(['routine', 'task', 'artifact', 'client', 'peer']);

/** Where a model answers from, said to the assistant. */
const about = (c: SwitchCandidate) =>
  `${c.label} on ${c.provider} (${whereWords(c)}${c.chatOnly ? '; it can only chat: no apps, files or browser' : ''})`;

const DESCRIPTION = [
  'Switch this chat to another connected model when the person asks: by name or version (“Opus 5.5”, “GPT-5.5 mini”), by family or provider (“Claude”, “try this with GPT”, “Codex”), by plan or key (“use my Claude plan”, “with my API key”), on this computer (“a local model”), relative to now (“cheaper”, “stronger for this step”, “faster”), or back (“go back to Codex”).',
  '`to` is their words for it, as they said them; Conch matches them against what’s connected, so don’t translate them into an id. `carry_on` is true when the same message also asks for work to be done on the new model (“try this with GPT”, “use Opus to fix the bug”), false when it only asks to switch.',
  'Only when the person asks, never on your own. One call per request.',
].join('\n\n');

/**
 * The assistant's part of the system text (ADR 0132): which models it can
 * switch to, a line per provider, and when to call `switch_model`.
 */
export function switchSection(
  candidates: readonly SwitchCandidate[],
  current: ModelRef | undefined,
): string {
  if (!candidates.length) return '';
  const lines = switchList(candidates, current);
  return [
    '## Models you can switch to',
    'This chat can move to any of these. When the person asks for another model, or for a stronger, cheaper, faster or local one, call `switch_model` with their words. Never say you can’t switch, and never pretend to be another model. Asked for one that isn’t here, call it anyway: Conch says what fits, or offers to connect it.',
    ...lines,
  ].join('\n');
}

/** `switch_model`, for a chat someone asked in. */
export function switchTools(deps: SwitchDeps, ctx: ToolContext): HostTool[] {
  if (ctx.origin && NOT_ASKED.has(ctx.origin.kind)) return [];
  const tool: HostTool<{
    to: z.ZodString;
    carry_on: z.ZodOptional<z.ZodBoolean>;
  }> = {
    name: 'switch_model',
    description: DESCRIPTION,
    input: {
      to: z
        .string()
        .min(1)
        .max(200)
        .describe('The person’s words for the model: “Opus 5.5”, “cheaper”, “my Claude plan”.'),
      carry_on: z
        .boolean()
        .optional()
        .describe('True when the new model should go on to do what this message asks.'),
    },
    // The section names it: it must be there, not waiting to be searched for.
    alwaysLoad: true,
    searchHint: 'switch change use another model provider cheaper stronger local',
    run: async ({ to, carry_on: carryOn = false }) => {
      const id = ctx.conversationId;
      const [candidates, chat] = await Promise.all([
        deps.candidates(),
        deps.chat.switchContext(id),
      ]);
      const found = resolveSwitch(candidates, to, chat);
      // Chips, where someone can tap them; words, where they can only type (a chat app).
      const offer = async (choices: SwitchCandidate[], lead: string) => {
        if (ctx.unattended)
          return `${lead} ${choices.map(about).join('; ')}. Ask which one they want, in a few words, and stop. Don’t switch until they say.`;
        const chips = choices.map(choiceOf);
        ctx.chips?.(chips.map((c) => ({ text: c.text })));
        await deps.chat.modelChoices(id, chips, carryOn);
        return `${lead} ${choices.map(about).join('; ')}. They’re under your reply as buttons, and a tap switches the chat${carryOn ? ' and carries on with the request' : ''}. Ask which one in one short sentence and stop; don’t do the work yourself.`;
      };
      switch (found.kind) {
        case 'already':
          return `This chat is already answering with ${about(found.choice)}. Say so in a few words.`;
        case 'some':
          return offer(
            found.choices,
            found.why === 'near'
              ? `“${to}” isn’t connected; the closest are:`
              : found.why === 'pays'
                ? 'The best fit is paid per use, so the person chooses:'
                : 'Several connected models fit:',
          );
        case 'none': {
          if (found.why === 'no-previous')
            return 'There’s no earlier model in this chat to go back to. Ask which one they mean.';
          if (found.why !== 'nothing')
            return `Nothing connected is ${found.why === 'no-stronger' ? 'stronger than' : found.why === 'no-cheaper' ? 'cheaper than' : 'faster than'} the model answering now. Say so plainly, in one sentence.`;
          const name = found.connect && deps.providerName?.(found.connect);
          const shown =
            found.connect && !ctx.unattended && deps.offerProvider
              ? await deps.offerProvider(ctx, found.connect, to).catch(() => false)
              : false;
          if (shown)
            return `Nothing connected serves “${to}”. A card to connect ${name ?? 'the provider that does'} is under your reply; once it’s connected, the chat switches to it and carries on. Say so plainly in one sentence, and don’t explain how to connect it.`;
          return `Nothing connected serves “${to}”.${name ? ` ${name} would, once it’s connected in Settings → Providers.` : ''} Say so plainly, and name what is connected: ${[...new Set(candidates.map((c) => c.provider))].join(', ') || 'nothing yet'}.`;
        }
        case 'one': {
          // A chat that read something untrusted, or a paid model nobody named: the person taps it.
          if (chat.tainted)
            return offer(
              [found.choice],
              'This chat has read something from outside, so the person confirms the switch:',
            );
          const done = await deps.chat.switchModel(id, found.choice, {
            by: 'assistant',
            label: found.choice.label,
            message: switchedLine(found.choice),
            carry: carryOn,
          });
          if (!done.switched) return `Not switched: ${done.why}`;
          const also = found.also?.length
            ? ` (Also connected: ${found.also.map((c) => `${c.label} on ${c.provider}`).join(', ')}.)`
            : '';
          const note = done.note ? ` Its permission mode is now ${done.note}.` : '';
          const chatty = found.choice.chatOnly
            ? ' It can only chat: it can’t use apps, files or the browser.'
            : '';
          return done.carrying
            ? `Switched to ${about(found.choice)}.${also}${note}${chatty} Stop here, with at most one short sentence and no work: it carries on with the request right after your reply, with this whole conversation.`
            : `Switched to ${about(found.choice)}, from the next message.${also}${note}${chatty} A line in the chat says so; confirm in a few words.`;
        }
      }
    },
  };
  return [tool as HostTool];
}
