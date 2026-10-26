/**
 * Which chats lifted each class of step with Always allow (ADR 0128), kept in
 * `auto-lifts.json` under Conch's home. A card for a class the person already
 * lifted in another chat offers Always allow for every chat; the answer itself
 * lives in `preferences.autoAllowed`, never here. Derived: a backup doesn't
 * carry it, and losing it only means the offer comes one chat later.
 *
 * And the narrower rules (ADR 0149): one command Auto never asks about again,
 * validated here, kept in `preferences.autoRules`.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { autoRuleWords, type AutoRule } from '@conch/protocol';
import { z } from 'zod';

import { commandParts, wordsOf } from './risk';

const File = z.object({
  version: z.literal(1),
  /** Each class, with the chats that lifted it, newest last. */
  lifts: z.record(z.string(), z.array(z.string()).max(8)),
});

/** How many chats are remembered per class: the offer needs one other, not a history. */
const CHATS_KEPT = 8;

export class AutoLifts {
  readonly #path: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(home: string) {
    this.#path = join(home, 'auto-lifts.json');
  }

  /** The chats that lifted this class, by id. */
  async seen(cls: string): Promise<string[]> {
    const file = await this.#read();
    return file.lifts[cls] ?? [];
  }

  /** This chat lifted the class (the person pressed Always allow on its card). */
  note(cls: string, conversationId: string): Promise<void> {
    const run = this.#queue.then(async () => {
      const file = await this.#read();
      const chats = (file.lifts[cls] ?? []).filter((id) => id !== conversationId);
      chats.push(conversationId);
      file.lifts[cls] = chats.slice(-CHATS_KEPT);
      await this.#write(file);
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #read(): Promise<z.infer<typeof File>> {
    try {
      const parsed = File.safeParse(JSON.parse(await readFile(this.#path, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      /* Missing or unreadable: nothing lifted yet. */
    }
    return { version: 1, lifts: {} };
  }

  async #write(file: z.infer<typeof File>): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    await rename(tmp, this.#path);
  }
}

// ── Commands Auto never asks about again (ADR 0149) ─────────────────────────
//
// Narrower than a class: one command, word for word, that a person pressed **Always allow
// `…`** to on a card. Modelled on Codex's validated prefix rules and OpenClaw's human-only
// persistence, and stricter than both: a rule covers the whole command, so nothing can be
// added after it (`git push origin feature/x main` is not `git push origin feature/*`).
// Pure functions: the manager decides when one may be offered or used.

/** The tools a rule can be for: a command line, one program and its words. */
export const RULE_TOOLS: readonly string[] = ['Bash', 'PowerShell'];

/**
 * Programs no rule may start with: shells and interpreters (what they run is whatever the
 * file or the words say), wrappers that run another command, removal, admin rights, the
 * network by hand, and runners of a project's own scripts, which the assistant can rewrite.
 */
const NEVER_FIRST = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'csh',
  'tcsh',
  'pwsh',
  'powershell',
  'cmd',
  'python',
  'python2',
  'python3',
  'py',
  'node',
  'deno',
  'bun',
  'bunx',
  'ruby',
  'perl',
  'php',
  'lua',
  'osascript',
  'rscript',
  'java',
  'sudo',
  'doas',
  'su',
  'runas',
  'env',
  'xargs',
  'exec',
  'eval',
  'source',
  '.',
  'command',
  'builtin',
  'nohup',
  'time',
  'timeout',
  'nice',
  'watch',
  'rm',
  'rmdir',
  'del',
  'dd',
  'mkfs',
  'shred',
  'chmod',
  'chown',
  'chgrp',
  'curl',
  'wget',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'nc',
  'ncat',
  'netcat',
  'socat',
  'telnet',
  'ftp',
  'npx',
  'pnpx',
  'pnpm',
  'yarn',
  'uvx',
  'pipx',
  'make',
  'just',
  'crontab',
  'launchctl',
  'systemctl',
  'invoke-expression',
  'iex',
  'start-process',
]);

/** A program alone is too broad to mean one command (`git`, `terraform`). */
const TOO_BROAD: readonly (readonly string[])[] = [
  ['git'],
  ['npm'],
  ['docker'],
  ['docker', 'compose'],
  ['podman'],
  ['kubectl'],
  ['helm'],
  ['terraform'],
  ['tofu'],
  ['aws'],
  ['gcloud'],
  ['az'],
  ['gh'],
  ['cargo'],
  ['go'],
  ['uv'],
  ['poetry'],
  ['pip'],
  ['pip3'],
  ['brew'],
  ['apt'],
  ['apt-get'],
];

/**
 * Ways of running a project's own scripts, or whatever a container or a cluster is told:
 * no rule starts with them, since the assistant can rewrite what they run (`npm run deploy`
 * runs whatever `package.json` says now).
 */
const RUNS_ANYTHING: readonly (readonly string[])[] = [
  ['npm', 'run'],
  ['npm', 'run-script'],
  ['npm', 'exec'],
  ['npm', 'x'],
  ['npm', 'start'],
  ['npm', 'test'],
  ['npm', 'restart'],
  ['docker', 'exec'],
  ['podman', 'exec'],
  ['kubectl', 'exec'],
  ['cargo', 'run'],
  ['go', 'run'],
  ['uv', 'run'],
  ['poetry', 'run'],
];

/** What a command line may not carry to be a rule: chains, pipes, redirects, `$(…)`, variables, globs. */
const SHELL_SYNTAX = /[;&|<>`$(){}[\]*?!#~\\\n\r]/;

/** What `*` stands for at the end of a rule's last word: a branch's or a name's rest. */
const GLOB_REST = /^[\w./@+-]*$/;

/** The program a word names, as a disk finds it: `/usr/bin/RM` is `rm`. */
const programOf = (word: string) =>
  word
    .replace(/^.*[\\/]/, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();

/** The words of a command that can be a rule, as the shell splits them; undefined when it can't be. */
function ruleWordsOf(command: string): string[] | undefined {
  const line = command.trim();
  if (!line || line.length > 2_000 || SHELL_SYNTAX.test(line)) return undefined;
  const words = wordsOf(line);
  // One command, nothing wrapped around it: `commandParts` takes off `sudo`, `env A=1`, `nohup`.
  const parts = commandParts(line);
  if (parts.length !== 1 || wordsOf(parts[0] ?? '').join('\u0000') !== words.join('\u0000'))
    return undefined;
  if (!words.length || words.length > 24 || words.some((w) => !w || w.length > 300))
    return undefined;
  return words;
}

/** Why these words can't be a rule; undefined when they can. */
function refusedPrefix(prefix: readonly string[]): string | undefined {
  const first = prefix[0] ?? '';
  if (!first) return 'It names no program.';
  // A program run by its path is a file the assistant may have written.
  if (/[\\/]/.test(first) || first.startsWith('.')) return 'It runs a file from a folder.';
  if (first.includes('=')) return 'It sets a variable first.';
  if (NEVER_FIRST.has(programOf(first))) return `No rule can start with ${programOf(first)}.`;
  const words = prefix.map((w, i) => (i === 0 ? programOf(w) : w.toLowerCase()));
  const starts = (broad: readonly string[]) => broad.every((w, i) => w === words[i]);
  if (TOO_BROAD.some((broad) => broad.length === words.length && starts(broad)))
    return 'It would cover too much.';
  if (RUNS_ANYTHING.some(starts)) return 'It runs whatever a project’s files say.';
  for (const [i, word] of prefix.entries()) {
    const star = word.indexOf('*');
    if (star < 0) continue;
    // Only the last word, never the program, only at its end, after a name that pins it
    // down: `feature/*`.
    if (i === 0 || i !== prefix.length - 1 || star !== word.length - 1)
      return 'Only the end can vary.';
    const fixed = word.slice(0, -1);
    if (fixed.length < 2 || !/[/._-]$/.test(fixed) || fixed.startsWith('-'))
      return 'Only a name’s end can vary.';
  }
  return undefined;
}

/** Whether a rule is one Conch would make now: read back from settings, it's checked again. */
export function validRule(rule: AutoRule): boolean {
  return RULE_TOOLS.includes(rule.tool) && refusedPrefix(rule.prefix) === undefined;
}

/**
 * The rule a card may offer for this command, or undefined when none may be: a chain, a pipe,
 * a redirect, `$(…)`, a variable, a wrapper, an interpreter, or too broad. A push of a branch
 * named like `feature/login` is offered as `feature/*`; anything else, word for word.
 */
export function proposeRule(
  tool: string,
  command: string,
  cwd: string | undefined,
  now: number,
): AutoRule | undefined {
  if (!RULE_TOOLS.includes(tool)) return undefined;
  const words = ruleWordsOf(command);
  if (!words) return undefined;
  const prefix = [...words];
  const last = prefix.length - 1;
  const branch = /^([\w.-]+\/)[\w./@-]+$/.exec(prefix[last] ?? '');
  if (
    branch &&
    programOf(prefix[0] ?? '') === 'git' &&
    prefix[1] === 'push' &&
    prefix.length === 4 &&
    !prefix.some((w) => w.startsWith('-'))
  )
    prefix[last] = `${branch[1]}*`;
  if (refusedPrefix(prefix)) return undefined;
  return { tool, prefix, ...(cwd && { cwd: resolve(cwd) }), createdAt: now };
}

/** A rule's last word, matched: `feature/*` covers `feature/login`, never `feature/x:main`. */
function wordMatches(rule: string, word: string): boolean {
  if (!rule.endsWith('*')) return rule === word;
  const fixed = rule.slice(0, -1);
  if (!word.startsWith(fixed)) return false;
  const rest = word.slice(fixed.length);
  return rest.length > 0 && GLOB_REST.test(rest) && !rest.includes('..');
}

/**
 * Whether a rule covers this command, the whole of it: the same tool, the same folder when
 * it names one, one command with nothing chained or wrapped, and every word in turn.
 */
export function ruleMatches(
  rule: AutoRule,
  tool: string,
  command: string,
  cwd: string | undefined,
): boolean {
  if (rule.tool !== tool || !validRule(rule)) return false;
  if (rule.cwd && (!cwd || resolve(rule.cwd) !== resolve(cwd))) return false;
  const words = ruleWordsOf(command);
  if (!words || words.length !== rule.prefix.length) return false;
  return rule.prefix.every((w, i) => wordMatches(w, words[i] ?? ''));
}

/** The two rules are the same command (a second press keeps one). */
export function sameRule(a: AutoRule, b: AutoRule): boolean {
  return (
    a.tool === b.tool &&
    (a.cwd ?? '') === (b.cwd ?? '') &&
    a.prefix.length === b.prefix.length &&
    a.prefix.every((w, i) => w === b.prefix[i])
  );
}

/** A rule as a person reads it: `git push origin feature/*`, a word with spaces in quotes. */
export const ruleWords = autoRuleWords;
