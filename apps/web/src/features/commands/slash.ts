import {
  COMMAND_SECTIONS,
  COMMANDS,
  type CommandDef,
  type CommandSection,
  type CustomCommand,
  type EngineCommand,
  expandCustom,
  parseEffortArg,
  parseGoalArg,
  parseSwitch,
  type Skill,
} from '@conch/protocol';

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

/** Fill a custom command's prompt (the protocol's, shared with chat apps). */
export { expandCustom };

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
export type BuiltinSection = CommandSection;

export const sectionLabels: Record<BuiltinSection, string> = COMMAND_SECTIONS;

export interface Builtin extends Omit<CommandDef, 'web' | 'chat'> {
  action: BuiltinAction;
}

/**
 * Conch's own commands. They act on the app (or are done by the gateway, so
 * they work with every provider) and are never sent to the model as typed.
 * The list is the protocol's (`COMMANDS`), shared with every chat app, so the
 * two never drift; the ones only chat apps have (`/stop`) are left out.
 */
export const builtins: Builtin[] = COMMANDS.filter((c) => c.web !== false).map(
  ({ web: _web, chat: _chat, ...command }) => ({
    ...command,
    action: command.name as BuiltinAction,
  }),
);

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

export { parseEffortArg, parseGoalArg, parseSwitch };

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
