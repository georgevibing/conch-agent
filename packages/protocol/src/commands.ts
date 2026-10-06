/**
 * Conch's own slash commands (ADR 0098): one list for the web app and every
 * chat app (Telegram, Slack, WhatsApp, email…), so their names, other names,
 * words and values never drift apart. The web app draws its menu from it;
 * the gateway answers it in chat apps and hands it to each app's own `/`
 * menu where the app has one (Telegram's `setMyCommands`, Discord's
 * application commands, Slack's `/conch`, Teams' command list).
 *
 * Each command is done by Conch itself, never sent to the model as typed,
 * so it means the same whichever provider answers.
 */

/** Where a command is listed: what it acts on. */
export type CommandSection = 'chat' | 'answers' | 'conch';

export const COMMAND_SECTIONS: Record<CommandSection, string> = {
  chat: 'This chat',
  answers: 'How it answers',
  conch: 'Conch',
};

/** How a command works from a chat app. Without it, a command is only in Conch itself. */
export interface ChatAppUse {
  /**
   * Who may use it: `owner`, the person who set the channel up, in their
   * private chat (it changes how Conch works); `people`, anyone let in, on
   * their own conversation.
   */
  who: 'owner' | 'people';
  /** It also works in a group, for whoever sends it, on their own conversation there. */
  groups?: boolean;
  /** Left out of the app's own `/` menu and of `/help` (`/start`, `/cancel`). */
  hidden?: boolean;
  /** What it does in a chat app, when that differs from the web app's words. */
  description?: string;
  /** What goes after its name in a chat app, when that differs. */
  argumentHint?: string;
}

export interface CommandDef {
  name: string;
  section: CommandSection;
  /** A sentence without its full stop: the reference adds one. */
  description: string;
  argumentHint?: string;
  aliases?: string[];
  /**
   * After its name, the web menu goes on to its values (the thinking levels,
   * the models), the one in use marked; a chat app shows them as buttons, or
   * numbered. `suggest`: only suggestions for words of your own (a goal).
   */
  values?: 'choose' | 'suggest';
  /** It needs words after its name: choosing it waits for them instead of acting. */
  needsArgs?: boolean;
  /**
   * Newer than the commands people made themselves: a command or skill of
   * yours with the same name (or one of its other names) still wins.
   */
  yields?: boolean;
  /** Only in chat apps (`/stop`, `/cancel`): the web app has a button for it. */
  web?: false;
  /** How it works from a chat app; absent: only in Conch itself. */
  chat?: ChatAppUse;
}

export const COMMANDS: readonly CommandDef[] = [
  // ── This chat ──
  {
    name: 'new',
    section: 'chat',
    description: 'Start a new chat',
    chat: { who: 'people', groups: true, description: 'Start a fresh conversation' },
  },
  {
    name: 'clear',
    section: 'chat',
    description:
      'Start afresh in this chat: the model forgets what was said, you keep every message, and Undo puts it back',
    aliases: ['reset'],
    chat: {
      who: 'people',
      description: 'Start afresh: the model forgets what was said, and Undo puts it back',
    },
  },
  {
    name: 'compact',
    section: 'chat',
    description: 'Summarise the start of a long chat, so the model reads less',
    argumentHint: '[what to keep]',
    aliases: ['summarise', 'summarize', 'compress'],
    chat: { who: 'people' },
  },
  {
    name: 'goal',
    yields: true,
    section: 'chat',
    description: 'Say what this chat is for: kept in mind in every reply, with any model',
    argumentHint: '[goal | clear]',
    aliases: ['objective'],
    values: 'suggest',
    chat: { who: 'owner' },
  },
  {
    name: 'plan',
    yields: true,
    section: 'chat',
    description: 'Plan first: it reads and proposes, you approve, then it acts',
    argumentHint: '[on | off | what to plan]',
    values: 'suggest',
    chat: { who: 'owner' },
  },
  {
    name: 'retry',
    yields: true,
    section: 'chat',
    description: 'Send your last message again',
    aliases: ['again', 'regenerate'],
    chat: { who: 'people' },
  },
  {
    name: 'undo',
    yields: true,
    section: 'chat',
    description: 'Put back the files the assistant last changed',
    aliases: ['rewind', 'revert'],
    chat: { who: 'people', description: 'Take back the last /clear' },
  },
  {
    name: 'stop',
    section: 'chat',
    description: 'Stop what it’s doing',
    web: false,
    chat: { who: 'people', groups: true },
  },
  {
    name: 'background',
    yields: true,
    section: 'chat',
    description: 'Have it done in the background while you keep chatting',
    argumentHint: '<what to do>',
    aliases: ['task', 'bg', 'delegate'],
    needsArgs: true,
  },
  {
    name: 'rename',
    yields: true,
    section: 'chat',
    description: 'Give this chat a name',
    argumentHint: '<name>',
    aliases: ['title'],
    needsArgs: true,
  },
  {
    name: 'copy',
    yields: true,
    section: 'chat',
    description: 'Copy the last reply',
  },
  {
    name: 'export',
    yields: true,
    section: 'chat',
    description: 'Save this chat as a Markdown file',
    aliases: ['save', 'download'],
  },
  {
    name: 'resume',
    yields: true,
    section: 'chat',
    description: 'Find another chat to carry on',
    aliases: ['chats', 'history', 'continue'],
  },
  // ── How it answers ──
  {
    name: 'model',
    section: 'answers',
    description: 'Choose the model',
    argumentHint: '[name]',
    values: 'choose',
    chat: { who: 'owner' },
  },
  {
    name: 'effort',
    section: 'answers',
    description: 'How hard the model thinks',
    argumentHint: '[auto…max]',
    aliases: ['think', 'thinking'],
    values: 'choose',
    chat: { who: 'owner' },
  },
  {
    name: 'fast',
    section: 'answers',
    description: 'Turn fast mode on or off',
    argumentHint: '[on | off]',
    values: 'choose',
    chat: { who: 'owner' },
  },
  {
    name: 'mode',
    section: 'answers',
    description: 'How much it can do without asking',
    aliases: ['trust', 'permissions', 'approvals'],
    values: 'choose',
    chat: { who: 'owner' },
  },
  {
    name: 'folder',
    yields: true,
    section: 'answers',
    description: 'Choose the folder it works in',
    aliases: ['cwd', 'cd', 'dir', 'add-dir'],
  },
  {
    name: 'status',
    yields: true,
    section: 'answers',
    description: 'What this chat is using: model, thinking, mode, folder and goal',
    aliases: ['info', 'context'],
    chat: { who: 'owner', description: 'What this chat is using: model, thinking, mode and goal' },
  },
  {
    name: 'review',
    yields: true,
    section: 'answers',
    description: 'Review the changes in the working folder',
    argumentHint: '[what to look at]',
  },
  {
    name: 'init',
    yields: true,
    section: 'answers',
    description: 'Write an AGENTS.md that explains this project to any assistant',
  },
  // ── Conch ──
  {
    name: 'remember',
    section: 'conch',
    description: 'Save something to memory',
    argumentHint: '<something about you>',
    needsArgs: true,
  },
  { name: 'memory', section: 'conch', description: 'See what Conch remembers' },
  {
    name: 'routines',
    section: 'conch',
    description: 'Things Conch does on a schedule',
    aliases: ['schedule', 'cron'],
  },
  { name: 'skills', section: 'conch', description: 'Things Conch knows how to do' },
  { name: 'commands', section: 'conch', description: 'Create your own commands' },
  {
    name: 'apps',
    yields: true,
    section: 'conch',
    description: 'Connect apps the assistant can use, with any model',
    aliases: ['mcp', 'integrations', 'connect', 'tools'],
  },
  {
    name: 'providers',
    yields: true,
    section: 'conch',
    description: 'Connect or sign in to the models you use',
    aliases: ['login', 'auth', 'logout', 'keys'],
  },
  {
    name: 'usage',
    section: 'conch',
    description: 'See how much usage you have left',
    aliases: ['cost', 'limits', 'stats'],
  },
  {
    name: 'doctor',
    yields: true,
    section: 'conch',
    description: 'Check everything and fix what’s broken',
    aliases: ['health', 'repair', 'fix'],
  },
  {
    name: 'settings',
    section: 'conch',
    description: 'Open settings',
    aliases: ['config', 'preferences'],
    chat: { who: 'owner', description: 'Choose how Conch works here' },
  },
  {
    name: 'theme',
    section: 'conch',
    description: 'Switch between light and dark',
    values: 'choose',
  },
  {
    name: 'help',
    section: 'conch',
    description: 'What can I do here?',
    aliases: ['?'],
    chat: { who: 'people', groups: true, description: 'What I can do here' },
  },
  // ── Only in chat apps, and not listed ──
  {
    name: 'start',
    section: 'conch',
    description: 'Say hello',
    web: false,
    chat: { who: 'people', groups: true, hidden: true },
  },
  {
    name: 'cancel',
    section: 'conch',
    description: 'Leave a settings question without saving',
    web: false,
    chat: { who: 'owner', hidden: true },
  },
];

/** A command by its name or one of its other names, in the web app or in chat apps. */
export function findCommand(name: string, where: 'web' | 'chat' = 'web'): CommandDef | undefined {
  const q = name.toLowerCase();
  return COMMANDS.find(
    (c) => (where === 'web' ? c.web !== false : true) && (c.name === q || c.aliases?.includes(q)),
  );
}

/** The commands a chat app understands, in the order they're listed. */
export const CHAT_COMMANDS: readonly (CommandDef & { chat: ChatAppUse })[] = COMMANDS.filter(
  (c): c is CommandDef & { chat: ChatAppUse } => Boolean(c.chat),
);

/**
 * `/name rest…` as typed in a chat app: the name in lower case (Telegram adds
 * `@yourbot` in a group, which goes), and what follows it. A path
 * (`/Users/ada/notes.txt`) or a lone `/` isn't a command.
 */
export function parseChatCommand(text: string): { name: string; args: string } | undefined {
  const match = /^\/([\p{L}\p{N}_?-]{1,64})(?:@[\w.-]+)?(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!match?.[1]) return undefined;
  return { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

/** How far apart two short words are: letters added, taken away, changed or swapped. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const row = rows[i] as number[];
      const up = rows[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min((up[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (up[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, ((rows[i - 2] as number[])[j - 2] ?? 0) + 1);
      row[j] = best;
    }
  return (rows[a.length] as number[])[b.length] ?? 0;
}

/**
 * The names a mistyped one probably meant, closest first: a slip of a letter
 * or two (`/modle`, `/claer`), or the start of a name (`/eff`). `names` maps
 * every name people may type (other names too) to the one to suggest.
 */
export function similarCommands(
  typed: string,
  names: ReadonlyMap<string, string> | readonly string[],
  max = 2,
): string[] {
  const q = typed.toLowerCase();
  if (!q) return [];
  const pairs: [string, string][] = Array.isArray(names)
    ? names.map((n) => [n, n])
    : [...(names as ReadonlyMap<string, string>)];
  const scored = new Map<string, number>();
  for (const [name, meant] of pairs) {
    const allowed = name.length <= 4 ? 1 : 2;
    const d = distance(q, name);
    const score = name.startsWith(q) && q.length >= 2 ? 0.5 : d <= allowed ? d : undefined;
    if (score === undefined) continue;
    scored.set(meant, Math.min(score, scored.get(meant) ?? Number.POSITIVE_INFINITY));
  }
  return [...scored]
    .sort(
      (a, b) =>
        a[1] - b[1] ||
        Math.abs(a[0].length - q.length) - Math.abs(b[0].length - q.length) ||
        a[0].localeCompare(b[0]),
    )
    .slice(0, max)
    .map(([name]) => name);
}

const effortAliases: Record<string, string> = {
  max: 'max',
  maximum: 'max',
  extra: 'xhigh',
  xhigh: 'xhigh',
};

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

/** Fill a command of yours: `{{input}}` is replaced by what was typed after it, or that is added. */
export function expandCustom(command: { prompt: string }, args: string): string {
  if (command.prompt.includes('{{input}}')) {
    return command.prompt.replaceAll('{{input}}', args || 'this').trim();
  }
  return args ? `${command.prompt.trim()}\n\n${args}` : command.prompt.trim();
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
