import type { CustomCommand, EngineCommand, Skill } from '@conch/protocol';

/** `/name rest…` → `{ name, args }`; anything else → undefined. */
export function parseSlash(text: string): { name: string; args: string } | undefined {
  const match = /^\/([^\s/]*)(?:\s+([\s\S]*))?$/.exec(text.trimStart());
  if (!match) return undefined;
  return { name: (match[1] ?? '').toLowerCase(), args: (match[2] ?? '').trim() };
}

/** The query the command menu filters by, while the user is still typing the name. */
export function slashQuery(text: string): string | null {
  const match = /^\/([^\s/]*)$/.exec(text);
  return match ? (match[1] ?? '') : null;
}

/**
 * While a value is typed after a command (`/effort hi`, `/model gpt 5`): the
 * command's name as typed, and the value so far. One line only: a message
 * that goes on to a second line is being written, not completed.
 */
export function slashValueQuery(text: string): { name: string; value: string } | null {
  const match = /^\/([^\s/]+) ([^\n]*)$/.exec(text);
  if (!match) return null;
  return { name: (match[1] ?? '').toLowerCase(), value: (match[2] ?? '').trimStart() };
}

/** Fill a custom command's prompt: `{{input}}` is replaced, otherwise input is appended. */
export function expandCustom(command: Pick<CustomCommand, 'prompt'>, args: string): string {
  if (command.prompt.includes('{{input}}')) {
    return command.prompt.replaceAll('{{input}}', args || 'this').trim();
  }
  return args ? `${command.prompt.trim()}\n\n${args}` : command.prompt.trim();
}

export type BuiltinAction =
  // This chat
  | 'new'
  | 'clear'
  | 'compact'
  | 'retry'
  | 'undo'
  | 'goal'
  | 'plan'
  | 'background'
  | 'rename'
  | 'copy'
  | 'export'
  | 'resume'
  // How it answers
  | 'model'
  | 'effort'
  | 'fast'
  | 'mode'
  | 'folder'
  | 'status'
  | 'review'
  | 'init'
  // Conch
  | 'remember'
  | 'memory'
  | 'routines'
  | 'skills'
  | 'commands'
  | 'apps'
  | 'providers'
  | 'usage'
  | 'doctor'
  | 'settings'
  | 'theme'
  | 'help';

/** Where a command is listed in the menu: what it acts on. */
export type BuiltinSection = 'chat' | 'answers' | 'conch';

export const sectionLabels: Record<BuiltinSection, string> = {
  chat: 'This chat',
  answers: 'How it answers',
  conch: 'Conch',
};

export interface Builtin {
  name: string;
  action: BuiltinAction;
  section: BuiltinSection;
  description: string;
  argumentHint?: string;
  aliases?: string[];
  /**
   * After its name, the menu goes on to its values (the thinking levels,
   * the models), the one in use marked. `suggest`: they're only suggestions
   * for words of your own (a goal), so Enter sends what you typed.
   */
  values?: 'choose' | 'suggest';
  /** It needs words after its name: choosing it waits for them instead of acting. */
  needsArgs?: boolean;
  /**
   * Newer than the commands people made themselves: a command or skill of
   * yours with the same name (or one of its other names) still wins.
   */
  yields?: boolean;
}

/**
 * Conch's own commands. They act on the app (or are done by the gateway, so
 * they work with every provider) and are never sent to the model as typed.
 */
export const builtins: Builtin[] = [
  // ── This chat ──
  { name: 'new', action: 'new', section: 'chat', description: 'Start a new chat' },
  {
    name: 'clear',
    action: 'clear',
    section: 'chat',
    description:
      'Start afresh in this chat: the model forgets what was said, you keep every message, and Undo puts it back',
    aliases: ['reset'],
  },
  {
    name: 'compact',
    action: 'compact',
    section: 'chat',
    description: 'Summarise the start of a long chat, so the model reads less',
    argumentHint: '[what to keep]',
    aliases: ['summarise', 'summarize', 'compress'],
  },
  {
    name: 'goal',
    action: 'goal',
    yields: true,
    section: 'chat',
    description: 'Say what this chat is for: kept in mind in every reply, with any model',
    argumentHint: '[goal | clear]',
    aliases: ['objective'],
    values: 'suggest',
  },
  {
    name: 'plan',
    action: 'plan',
    yields: true,
    section: 'chat',
    description: 'Plan first: it reads and proposes, you approve, then it acts',
    argumentHint: '[on | off | what to plan]',
    values: 'suggest',
  },
  {
    name: 'retry',
    action: 'retry',
    yields: true,
    section: 'chat',
    description: 'Send your last message again',
    aliases: ['again', 'regenerate'],
  },
  {
    name: 'undo',
    action: 'undo',
    yields: true,
    section: 'chat',
    description: 'Put back the files the assistant last changed',
    aliases: ['rewind', 'revert'],
  },
  {
    name: 'background',
    action: 'background',
    yields: true,
    section: 'chat',
    description: 'Have it done in the background while you keep chatting',
    argumentHint: '<what to do>',
    aliases: ['task', 'bg', 'delegate'],
    needsArgs: true,
  },
  {
    name: 'rename',
    action: 'rename',
    yields: true,
    section: 'chat',
    description: 'Give this chat a name',
    argumentHint: '<name>',
    aliases: ['title'],
    needsArgs: true,
  },
  {
    name: 'copy',
    action: 'copy',
    yields: true,
    section: 'chat',
    description: 'Copy the last reply',
  },
  {
    name: 'export',
    action: 'export',
    yields: true,
    section: 'chat',
    description: 'Save this chat as a Markdown file',
    aliases: ['save', 'download'],
  },
  {
    name: 'resume',
    action: 'resume',
    yields: true,
    section: 'chat',
    description: 'Find another chat to carry on',
    aliases: ['chats', 'history', 'continue'],
  },
  // ── How it answers ──
  {
    name: 'model',
    action: 'model',
    section: 'answers',
    description: 'Choose the model',
    argumentHint: '[name]',
    values: 'choose',
  },
  {
    name: 'effort',
    action: 'effort',
    section: 'answers',
    description: 'How hard the model thinks',
    argumentHint: '[auto…max]',
    aliases: ['think', 'thinking'],
    values: 'choose',
  },
  {
    name: 'fast',
    action: 'fast',
    section: 'answers',
    description: 'Turn fast mode on or off',
    values: 'choose',
  },
  {
    name: 'mode',
    action: 'mode',
    section: 'answers',
    description: 'How much it can do without asking',
    aliases: ['trust', 'permissions', 'approvals'],
    values: 'choose',
  },
  {
    name: 'folder',
    action: 'folder',
    yields: true,
    section: 'answers',
    description: 'Choose the folder it works in',
    aliases: ['cwd', 'cd', 'dir', 'add-dir'],
  },
  {
    name: 'status',
    action: 'status',
    yields: true,
    section: 'answers',
    description: 'What this chat is using: model, thinking, mode, folder and goal',
    aliases: ['info', 'context'],
  },
  {
    name: 'review',
    action: 'review',
    yields: true,
    section: 'answers',
    description: 'Review the changes in the working folder',
    argumentHint: '[what to look at]',
  },
  {
    name: 'init',
    action: 'init',
    yields: true,
    section: 'answers',
    description: 'Write an AGENTS.md that explains this project to any assistant',
  },
  // ── Conch ──
  {
    name: 'remember',
    action: 'remember',
    section: 'conch',
    description: 'Save something to memory',
    argumentHint: '<something about you>',
    needsArgs: true,
  },
  { name: 'memory', action: 'memory', section: 'conch', description: 'See what Conch remembers' },
  {
    name: 'routines',
    action: 'routines',
    section: 'conch',
    description: 'Things Conch does on a schedule',
    aliases: ['schedule', 'cron'],
  },
  {
    name: 'skills',
    action: 'skills',
    section: 'conch',
    description: 'Things Conch knows how to do',
  },
  {
    name: 'commands',
    action: 'commands',
    section: 'conch',
    description: 'Create your own commands',
  },
  {
    name: 'apps',
    action: 'apps',
    yields: true,
    section: 'conch',
    description: 'Connect apps the assistant can use, with any model',
    aliases: ['mcp', 'integrations', 'connect', 'tools'],
  },
  {
    name: 'providers',
    action: 'providers',
    yields: true,
    section: 'conch',
    description: 'Connect or sign in to the models you use',
    aliases: ['login', 'auth', 'logout', 'keys'],
  },
  {
    name: 'usage',
    action: 'usage',
    section: 'conch',
    description: 'See how much usage you have left',
    aliases: ['cost', 'limits', 'stats'],
  },
  {
    name: 'doctor',
    action: 'doctor',
    yields: true,
    section: 'conch',
    description: 'Check everything and fix what’s broken',
    aliases: ['health', 'repair', 'fix'],
  },
  {
    name: 'settings',
    action: 'settings',
    section: 'conch',
    description: 'Open settings',
    aliases: ['config', 'preferences'],
  },
  {
    name: 'theme',
    action: 'theme',
    section: 'conch',
    description: 'Switch between light and dark',
    values: 'choose',
  },
  {
    name: 'help',
    action: 'help',
    section: 'conch',
    description: 'What can I do here?',
    aliases: ['?'],
  },
];

/** A builtin by its name or one of its aliases. */
export function findBuiltin(name: string): Builtin | undefined {
  const q = name.toLowerCase();
  return builtins.find((b) => b.name === q || b.aliases?.includes(q));
}

/** Whether a command or skill of yours is called this. */
const yours = (name: string, custom: CustomCommand[], skills: Skill[]) =>
  custom.some((c) => c.name === name) || skills.some((s) => s.name.toLowerCase() === name);

/**
 * The builtin a name means, given your own commands and skills: Conch's
 * newer commands give way to yours (`yields`).
 */
export function builtinFor(
  name: string,
  custom: CustomCommand[] = [],
  skills: Skill[] = [],
): Builtin | undefined {
  const builtin = findBuiltin(name);
  return builtin?.yields && yours(name.toLowerCase(), custom, skills) ? undefined : builtin;
}

export type ResolvedCommand =
  | { kind: 'builtin'; builtin: Builtin; args: string }
  | { kind: 'custom'; command: CustomCommand; args: string }
  | { kind: 'skill'; skill: Skill; args: string }
  | { kind: 'engine'; command: EngineCommand; args: string }
  | { kind: 'unknown'; name: string };

/**
 * Work out what a `/…` message means. Conch's commands win, then yours, then
 * your skills, then the provider's own — except Conch's newer commands
 * (`yields`), which give way to a command or skill of yours of the same name.
 */
export function resolveSlash(
  text: string,
  custom: CustomCommand[],
  engine: EngineCommand[],
  skills: Skill[] = [],
): ResolvedCommand | undefined {
  const parsed = parseSlash(text);
  if (!parsed || !parsed.name) return undefined;
  const builtin = builtinFor(parsed.name, custom, skills);
  if (builtin) return { kind: 'builtin', builtin, args: parsed.args };
  const mine = custom.find((c) => c.name === parsed.name);
  if (mine) return { kind: 'custom', command: mine, args: parsed.args };
  const skill = skills.find((s) => s.name.toLowerCase() === parsed.name);
  if (skill) return { kind: 'skill', skill, args: parsed.args };
  const theirs = engine.find((c) => c.name.toLowerCase() === parsed.name);
  if (theirs) return { kind: 'engine', command: theirs, args: parsed.args };
  return { kind: 'unknown', name: parsed.name };
}

const effortAliases: Record<string, string> = { max: 'max', extra: 'xhigh', xhigh: 'xhigh' };

/** Parse `/effort high` style arguments. */
export function parseEffortArg(arg: string): string | undefined {
  const value = arg.trim().toLowerCase();
  if (['auto', 'low', 'medium', 'high'].includes(value)) return value;
  return effortAliases[value];
}

/** `on`, `off`, or nothing (toggle); anything else isn't a switch. */
export function parseSwitch(arg: string): 'on' | 'off' | 'toggle' | undefined {
  const value = arg.trim().toLowerCase();
  if (!value || value === 'toggle') return 'toggle';
  if (['on', 'yes', 'true', 'start', 'enable'].includes(value)) return 'on';
  if (['off', 'no', 'false', 'stop', 'disable', 'done', 'exit'].includes(value)) return 'off';
  return undefined;
}

/** `/goal …`: show it, take it away, or set it to the words given. */
export function parseGoalArg(
  arg: string,
): { kind: 'show' } | { kind: 'clear' } | { kind: 'set'; goal: string } {
  const value = arg.trim();
  if (!value) return { kind: 'show' };
  if (/^(?:clear|off|none|remove|delete|reset|done)$/i.test(value)) return { kind: 'clear' };
  return { kind: 'set', goal: value };
}

/** `/theme dark`: a mode, or `toggle` when nothing (or something else) is said. */
export function parseThemeArg(arg: string): 'light' | 'dark' | 'system' | 'toggle' {
  const value = arg.trim().toLowerCase();
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  if (value === 'auto') return 'system';
  return 'toggle';
}

/**
 * `/init` for a provider without its own: the same ask, in words any
 * assistant can follow, so every provider can write the file.
 */
export const INIT_PROMPT = [
  'Look around the working folder and write an AGENTS.md at its root that explains this project to an AI coding assistant.',
  'Cover: what the project is, how it’s laid out, how to install, build, test and lint it (the exact commands), the conventions the code follows, and anything easy to get wrong.',
  'Keep it short and true: only what you checked in the files. If an AGENTS.md (or CLAUDE.md) is already there, improve it instead of starting again, and tell me what you changed.',
].join('\n');

/** `/review` for a provider without its own. */
export function reviewPrompt(focus: string): string {
  return [
    'Review the changes in the working folder that aren’t committed yet (git diff, and new files), or the latest commit if there are none.',
    'Look for bugs, security problems, missing tests and anything confusing. List what you find by importance, each with the file and line and a suggested fix. Don’t change any files.',
    ...(focus ? [`Look especially at: ${focus}`] : []),
  ].join('\n');
}
