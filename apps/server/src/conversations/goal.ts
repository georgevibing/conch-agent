/**
 * A chat's goal (`/goal`), in every turn's context whichever provider answers.
 * It's the person's own words, typed in Conch, so it's framed as what they
 * want, quoted, never as instructions from somewhere else. It stays through
 * `/clear`: clearing forgets the conversation, not what it's for.
 */
import { MAX_GOAL_LENGTH } from '@conch/protocol';

/** The block for the system prompt; nothing when the chat has no goal. */
export function goalPrompt(goal: string | undefined): string | undefined {
  const text = goal?.replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL_LENGTH);
  if (!text) return undefined;
  return [
    '<chat-goal>',
    `The person set a goal for this chat, in their own words: “${text}”`,
    'Keep it in mind in every reply: work toward it, and say what stands in the way when something does. Don’t repeat the goal back unless asked. When it’s reached, say so plainly, once.',
    '</chat-goal>',
  ].join('\n');
}
