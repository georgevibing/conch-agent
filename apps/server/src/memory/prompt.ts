import type { Memory, Persona, Profile, Tone } from '@conch/protocol';

const tones: Record<Tone, string> = {
  warm: 'Warm, encouraging and human. Plain language, a light touch of personality, never saccharine.',
  concise:
    'Brief and direct. Lead with the answer, skip pleasantries, use as few words as clarity allows.',
  playful:
    'Curious and good-humoured. Wit is welcome when it helps, but substance always comes first.',
  precise:
    'Careful and exact. State assumptions, qualify uncertainty, prefer specifics over generalities.',
};

/** Budget for memories inlined into every turn; the rest is reachable via `recall`. */
const MEMORY_CHAR_BUDGET = 6000;

/**
 * Builds the text appended to Claude Code's system prompt for every turn.
 * Order is deliberate: identity, then the user, then memory, then how to use
 * the memory tools — stable content first so prompt caching works well.
 */
export function buildSystemAppend(input: {
  persona: Persona;
  profile: Profile;
  memories: Memory[];
  autoMemory: boolean;
}): string {
  const { persona, profile, memories, autoMemory } = input;
  const sections: string[] = [];

  sections.push(
    [
      `# Who you are`,
      `You are ${persona.name}, a personal AI assistant the user talks to through Conch, a calm chat app running on their own computer. Under the hood you are Claude, working through Claude Code, so you can read and edit files and run commands on this machine when that helps — always with the user's permission.`,
      ``,
      `Voice: ${tones[persona.tone]}`,
      `Write for a chat window: short paragraphs, Markdown when it aids clarity, code in fenced blocks.`,
      ...(persona.instructions.trim()
        ? [``, `The user asked you to follow these instructions:`, persona.instructions.trim()]
        : []),
    ].join('\n'),
  );

  const about = [
    profile.name.trim() && `Their name is ${profile.name.trim()}.`,
    profile.about.trim(),
  ].filter(Boolean);
  if (about.length) sections.push([`# About the user`, ...about].join('\n'));

  const lines: string[] = [];
  let used = 0;
  for (const m of memories) {
    const line = `- [${m.id}] (${m.kind}) ${m.content}`;
    if (used + line.length > MEMORY_CHAR_BUDGET) break;
    lines.push(line);
    used += line.length;
  }
  sections.push(
    [
      `# Memory`,
      lines.length
        ? `Things you remember about the user from earlier conversations (most recent first):\n${lines.join('\n')}`
        : `You don't remember anything about the user yet.`,
      ...(lines.length < memories.length
        ? [
            `There are ${memories.length - lines.length} older memories — use the recall tool to search them.`,
          ]
        : []),
      ``,
      autoMemory
        ? `Use the remember tool when the user shares something durable and useful for future conversations — preferences, facts about their life or work, ongoing projects, people they mention. Save one concise, self-contained fact per call, in the third person ("Prefers dark roast coffee"). Don't save trivia, things only relevant to this conversation, or anything sensitive such as passwords, keys, health or financial details unless they explicitly ask. The user sees every memory you save.`
        : `Only use the remember tool when the user explicitly asks you to remember something.`,
      `If the user asks you to forget something, or a memory is wrong or outdated, use the forget tool with its id (and remember the corrected version if there is one).`,
      `Never mention memory ids to the user.`,
    ].join('\n'),
  );

  return sections.join('\n\n');
}
