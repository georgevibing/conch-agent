import { Question } from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import type { QuestionDesk } from './desk';

/** When to ask, in the assistant's own instructions (ADR 0060 §4). */
export const QUESTIONS_PROMPT = [
  '## Asking the user',
  'When you need the user’s choice to go on, ask with the `ask` tool: they answer with a tap, and your reply carries on with the answer. Ask only when the answer changes what happens next and you can’t reasonably work it out yourself. Never ask to confirm what was already clear. Never write the options as a numbered list in your reply instead.',
].join('\n');

const input = {
  title: Question.shape.title,
  fields: Question.shape.fields,
};

/** Two fields, or two options of one field, with the same id can't be told apart. */
function repeated(fields: Question['fields']): string | undefined {
  const ids = fields.map((f) => f.id);
  if (new Set(ids).size !== ids.length) return 'each field needs its own `id`';
  for (const field of fields)
    if (
      field.kind === 'choice' &&
      new Set(field.options.map((o) => o.id)).size !== field.options.length
    )
      return `each option of “${field.label}” needs its own \`id\``;
  return undefined;
}

/**
 * `ask`: a question with answers to tap, in chats someone is there to answer.
 * A routine, a task or a chat from a chat app gets no `ask` at all.
 */
export function questionTools(desk: QuestionDesk, ctx: ToolContext): HostTool[] {
  if (ctx.unattended) return [];
  const ask: HostTool<typeof input> = {
    name: 'ask',
    description: [
      'Ask the user something and wait for the answer. They see a card and answer with a tap: options to choose from, a date or a time, a number, or a few words. Your reply carries on with their answer.',
      'Ask only when the answer changes what you do next and you can’t reasonably work it out yourself: which of a few real options, a day and time, an amount. Never ask to confirm what was already clear, and never write options as a numbered list in your reply instead of asking.',
      'Keep it short: one field is best, four at most; `title` only when there’s more than one. A choice has 2–6 short options (a few words of `description` only when the label isn’t enough); `multiple` when several can apply; `other` (on by default) lets them write something else. Dates are `YYYY-MM-DD`, times `HH:MM`, date-times `YYYY-MM-DDTHH:MM`; give `suggested` when you have a good guess, and `min`/`max` when only some days work.',
      'If they skip it, carry on with your best judgement and say what you assumed.',
    ].join('\n\n'),
    input,
    alwaysLoad: true,
    searchHint: 'ask the user a question choose options date time pick',
    run: async (args) => {
      // Engines check the arguments too, but not all of them: read them here as well.
      const parsed = z.object(input).safeParse(args);
      if (!parsed.success)
        return `That question couldn’t be shown: ${parsed.error.issues[0]?.message ?? 'its fields don’t fit'}. Fix it and ask again.`;
      const twice = repeated(parsed.data.fields);
      if (twice) return `That question couldn’t be shown: ${twice}. Fix it and ask again.`;
      return desk.ask(ctx, parsed.data);
    },
  };
  return [ask];
}
