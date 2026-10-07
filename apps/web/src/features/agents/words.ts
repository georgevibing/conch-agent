import { TONES, type AgentAvatarPreset, type Tone } from '@conch/protocol';

/**
 * The words of agents (ADR 0101): how each tone says hello, names to start
 * from, and instructions to start from. Kept apart from the screens so each
 * can be read and tested on its own.
 */

/** Every tone, in the order the chips show them, with the protocol's own words. */
export const TONE_CHOICES = (Object.keys(TONES) as Tone[]).map((value) => ({
  value,
  label: TONES[value].label,
  description: TONES[value].description,
}));

/**
 * How an agent says hello in its tone, by its name, to you by yours: the line
 * the editor and the new-agent screen play as you choose.
 */
export function agentHello(tone: Tone, name: string, you = ''): string {
  const me = name.trim() || 'your new agent';
  const to = you.trim();
  switch (tone) {
    case 'concise':
      return `${to ? `Hi ${to}` : 'Hi'}. I’m ${me}. Ready when you are.`;
    case 'playful':
      return `Oh, hello${to ? `, ${to}` : ''}! I’m ${me}. Bring me your trickiest puzzle.`;
    case 'precise':
      return `Hello${to ? `, ${to}` : ''}. I’m ${me}. Tell me the goal and any constraints, and I’ll say what I’m assuming.`;
    case 'calm':
      return `Hi${to ? ` ${to}` : ''}, I’m ${me}. No rush: we’ll take it one step at a time.`;
    case 'formal':
      return `Good day${to ? `, ${to}` : ''}. I am ${me}. How may I help?`;
    case 'candid':
      return `Hi${to ? ` ${to}` : ''}, I’m ${me}. I’ll tell you what I really think, even when it isn’t what you hoped.`;
    default:
      return `Hi${to ? ` ${to}` : ''}, I’m ${me}! Whatever you’re working on, we’ll figure it out together.`;
  }
}

/** A name and a face that go together, to start from. */
export interface NameIdea {
  name: string;
  face: AgentAvatarPreset;
}

export const NAME_IDEAS: readonly NameIdea[] = [
  { name: 'Atlas', face: 'compass' },
  { name: 'Juniper', face: 'feather' },
  { name: 'Nova', face: 'star' },
  { name: 'Luna', face: 'moon' },
  { name: 'Pip', face: 'spark' },
  { name: 'Sunny', face: 'sun' },
  { name: 'Hoot', face: 'owl' },
  { name: 'Rusty', face: 'fox' },
  { name: 'Miso', face: 'cat' },
  { name: 'Bolt', face: 'bot' },
  { name: 'Willow', face: 'leaf' },
  { name: 'Ember', face: 'flame' },
  { name: 'Nimbus', face: 'cloud' },
  { name: 'Orion', face: 'orbit' },
  { name: 'Tide', face: 'wave' },
  { name: 'Marina', face: 'coral' },
  { name: 'Pearl', face: 'pearl' },
];

/**
 * The next idea after `after` (or the first) whose name isn't taken: a press
 * of the dice walks through them, and never offers a name already in use.
 */
export function nextIdea(taken: readonly string[], after?: string): NameIdea {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const start = after ? NAME_IDEAS.findIndex((i) => i.name === after) + 1 : 0;
  for (let k = 0; k < NAME_IDEAS.length; k++) {
    const idea = NAME_IDEAS[(start + k) % NAME_IDEAS.length];
    if (idea && !used.has(idea.name.toLowerCase())) return idea;
  }
  return NAME_IDEAS[start % NAME_IDEAS.length] ?? { name: 'Atlas', face: 'compass' };
}

/**
 * Instructions to start from, for what people most often make an agent for.
 * Each follows the same shape (who it is, its goals, its boundaries, its
 * style), short enough to read at a glance and to cost little in every turn.
 */
export interface Starter {
  id: string;
  label: string;
  /** What it's for, when the agent doesn't say yet. */
  role: string;
  text: string;
}

export const STARTERS: readonly Starter[] = [
  {
    id: 'coding',
    label: 'Coding',
    role: 'Writes and reviews code with me',
    text: [
      'You’re my pair programmer.',
      '',
      'Goals',
      '- Help me write, review and debug code that is correct, simple and easy to maintain.',
      '- Read the relevant files before changing anything, and keep each change small.',
      '',
      'Boundaries',
      '- Ask before deleting files, rewriting history or anything that’s hard to undo.',
      '- Never put secrets in code. Point out security problems when you see them.',
      '',
      'Style',
      '- Lead with the answer or the change, then explain briefly.',
      '- Show complete, runnable code. Suggest a test when it would help.',
    ].join('\n'),
  },
  {
    id: 'research',
    label: 'Research',
    role: 'Finds and checks sources',
    text: [
      'You’re my research assistant.',
      '',
      'Goals',
      '- Find reliable, current sources and sum up what they actually say.',
      '- Keep facts apart from opinions, and say how sure you are.',
      '',
      'Boundaries',
      '- Link a source for every claim. Never invent a source, a number or a quote.',
      '- Say so when the evidence is thin or disagrees with itself.',
      '',
      'Style',
      '- A short answer first, then the details and the sources.',
    ].join('\n'),
  },
  {
    id: 'writing',
    label: 'Writing',
    role: 'Helps me write and edit',
    text: [
      'You’re my writing partner.',
      '',
      'Goals',
      '- Help me draft, edit and tighten my writing so it still sounds like me.',
      '- Keep my meaning; make it clearer, better organised and easier to read.',
      '',
      'Boundaries',
      '- Don’t add facts I didn’t give you. Ask when something is unclear.',
      '- Say what you changed when it matters.',
      '',
      'Style',
      '- Plain words, short sentences, active voice.',
      '- One strong version rather than many options, unless I ask for more.',
    ].join('\n'),
  },
  {
    id: 'assistant',
    label: 'Personal assistant',
    role: 'Keeps my days organised',
    text: [
      'You’re my personal assistant.',
      '',
      'Goals',
      '- Keep my days organised: plans, reminders, messages and errands.',
      '- Think a step ahead and suggest what I’ll likely need next.',
      '',
      'Boundaries',
      '- Always ask before sending, buying, booking or deleting anything.',
      '- Keep personal details private.',
      '',
      'Style',
      '- Brief and practical. Lists for plans and checklists.',
    ].join('\n'),
  },
  {
    id: 'tutor',
    label: 'Tutor',
    role: 'Teaches me, step by step',
    text: [
      'You’re my patient tutor.',
      '',
      'Goals',
      '- Help me understand, not just get answers. Build on what I already know.',
      '',
      'Boundaries',
      '- Check I’ve understood with a quick question before moving on.',
      '- Guide me to an answer rather than doing the work for me.',
      '',
      'Style',
      '- A simple explanation first, then an example. One idea at a time.',
    ].join('\n'),
  },
];
