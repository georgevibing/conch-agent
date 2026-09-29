import type { CustomCommand, EngineCommand } from '@conch/protocol';

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

/** Fill a custom command's prompt: `{{input}}` is replaced, otherwise input is appended. */
export function expandCustom(command: Pick<CustomCommand, 'prompt'>, args: string): string {
  if (command.prompt.includes('{{input}}')) {
    return command.prompt.replaceAll('{{input}}', args || 'this').trim();
  }
  return args ? `${command.prompt.trim()}\n\n${args}` : command.prompt.trim();
}

export type BuiltinAction =
  | 'model'
  | 'effort'
  | 'fast'
  | 'mode'
  | 'new'
  | 'remember'
  | 'routines'
  | 'memory'
  | 'settings'
  | 'commands'
  | 'theme'
  | 'help';

export interface Builtin {
  name: string;
  action: BuiltinAction;
  description: string;
  argumentHint?: string;
  aliases?: string[];
}

/** Conch's own commands. They act on the app and are never sent to the model. */
export const builtins: Builtin[] = [
  { name: 'model', action: 'model', description: 'Choose the model', argumentHint: '[name]' },
  {
    name: 'effort',
    action: 'effort',
    description: 'How hard Claude thinks',
    argumentHint: '[auto…max]',
    aliases: ['think'],
  },
  { name: 'fast', action: 'fast', description: 'Turn fast mode on or off' },
  {
    name: 'mode',
    action: 'mode',
    description: 'How much Claude can do without asking',
    aliases: ['trust', 'permissions'],
  },
  { name: 'new', action: 'new', description: 'Start a new chat', aliases: ['clear'] },
  {
    name: 'remember',
    action: 'remember',
    description: 'Save something to memory',
    argumentHint: '<something about you>',
  },
  { name: 'memory', action: 'memory', description: 'See what Conch remembers' },
  {
    name: 'routines',
    action: 'routines',
    description: 'Things Conch does on a schedule',
    aliases: ['schedule', 'cron'],
  },
  { name: 'commands', action: 'commands', description: 'Create your own commands' },
  { name: 'settings', action: 'settings', description: 'Open settings' },
  { name: 'theme', action: 'theme', description: 'Switch between light and dark' },
  { name: 'help', action: 'help', description: 'What can I do here?' },
];

export type ResolvedCommand =
  | { kind: 'builtin'; builtin: Builtin; args: string }
  | { kind: 'custom'; command: CustomCommand; args: string }
  | { kind: 'engine'; command: EngineCommand; args: string }
  | { kind: 'unknown'; name: string };

/** Work out what a `/…` message means. Conch commands win, then yours, then Claude Code's. */
export function resolveSlash(
  text: string,
  custom: CustomCommand[],
  engine: EngineCommand[],
): ResolvedCommand | undefined {
  const parsed = parseSlash(text);
  if (!parsed || !parsed.name) return undefined;
  const builtin = builtins.find((b) => b.name === parsed.name || b.aliases?.includes(parsed.name));
  if (builtin) return { kind: 'builtin', builtin, args: parsed.args };
  const mine = custom.find((c) => c.name === parsed.name);
  if (mine) return { kind: 'custom', command: mine, args: parsed.args };
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
