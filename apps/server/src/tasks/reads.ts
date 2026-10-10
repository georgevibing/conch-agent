/**
 * What a task's ledger may treat as only looking: the one list (ADR 0033).
 *
 * A read is evidence, never an effect: it never blocks later steps and is never
 * guarded against repeating. Erring towards "read" would let an uncertain change
 * slip past that guard, so every rule here errs the other way. A call that isn't
 * plainly a read stays an action whose result Conch can't prove. Names are exact:
 * `mcp__someone__Read` is another app's tool, whatever it calls itself.
 */
import { splitLine, wordsOf } from '../conversations/risk';

/** Provider tools that only look at files, a command's output or the web. */
const LOOKS = ['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'BashOutput', 'WebFetch', 'WebSearch'];

/** Tools about the session itself (a tool's schema, the to-do list): nothing outside changes. */
const META = ['ToolSearch', 'TodoWrite', 'TodoRead'];

const READ_TOOLS: ReadonlySet<string> = new Set([...LOOKS, ...META]);

/** Programs that only read and print, whatever their arguments. */
const PLAIN = new Set([
  'basename',
  'cat',
  'cd',
  'cmp',
  'column',
  'comm',
  'cut',
  'df',
  'diff',
  'dirname',
  'du',
  'echo',
  'egrep',
  'false',
  'fgrep',
  'grep',
  'head',
  'id',
  'jq',
  'ls',
  'md5sum',
  'nl',
  'printf',
  'pwd',
  'readlink',
  'realpath',
  'sha1sum',
  'sha256sum',
  'shasum',
  'stat',
  'tail',
  'test',
  'tr',
  'true',
  'uname',
  'wc',
  'which',
  'whoami',
]);

/** Programs that read, unless one of these arguments makes them write or run something. */
const UNLESS: Record<string, RegExp> = {
  // `-exec`, `-delete` and friends act on what they find.
  find: /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/,
  // `-o` writes the result to a file; a compressor is a program it runs.
  sort: /^(?:-[A-Za-z]*o|--output|--compress-program)/,
  tree: /^-[A-Za-z]*o/,
  // `--pre` and `--hostname-bin` run programs; `-z` runs decompressors.
  rg: /^(?:--pre|--hostname-bin|--search-zip|-[A-Za-z]*z)/,
  // `-s` sets the clock.
  date: /^(?:-[A-Za-z]*s|--set)/,
};

/** Git that only looks. A repository's own settings are the person's. */
const GIT_LOOKS = new Set([
  'blame',
  'cat-file',
  'describe',
  'diff',
  'log',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'shortlog',
  'show',
  'status',
]);
/** `git branch` and `git remote` list with these; a name or any other switch changes them. */
const GIT_LISTS = /^(?:-a|-r|-v|-vv|--all|--remotes|--verbose|--list|--show-current|--no-color)$/;

/** Ways a command line writes or runs more than it says: never a read. */
const HIDDEN = /`|\$\(|<\(|>\(|<</;
/** Output thrown away or merged is not a write. */
const HARMLESS_REDIRECT = /\s*(?:\d?>&\d|(?:\d|&)?>\s*\/dev\/null)(?=\s|$|[;|&)])/g;

function piece(words: string[]): boolean {
  const [program, ...args] = words;
  if (!program) return false;
  if (PLAIN.has(program)) return true;
  const unless = UNLESS[program];
  if (unless) return !args.some((arg) => unless.test(arg));
  if (program === 'uniq') return args.filter((arg) => !arg.startsWith('-')).length <= 1;
  if (program === 'git') {
    const [sub, ...rest] = args;
    if (!sub) return false;
    if (sub === 'branch' || sub === 'remote') return rest.every((arg) => GIT_LISTS.test(arg));
    return GIT_LOOKS.has(sub) && !rest.some((arg) => /^--(?:output|ext-diff)/.test(arg));
  }
  return false;
}

/**
 * A shell command that only reads: every part a known reader, no redirect into a
 * file, no command inside it, no variable set in front of it. Anything else isn't.
 */
export function readOnlyCommand(command: unknown): boolean {
  if (typeof command !== 'string' || !command.trim() || command.length > 4_000) return false;
  if (HIDDEN.test(command)) return false;
  const text = command.replace(HARMLESS_REDIRECT, ' ');
  if (/[<>]/.test(text.replace(/\s<\s*[^\s;|&<>]+/g, ' '))) return false;
  const parts = splitLine(text)
    .map((part) =>
      part
        .trim()
        .replace(/^[({]\s*/, '')
        .replace(/\s*[)}]+$/, ''),
    )
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => piece(wordsOf(part)));
}

/** Whether a provider's own tool call only looks, so its result is evidence, not an effect. */
export function taskReadOnly(name: string, args: Record<string, unknown>): boolean {
  if (READ_TOOLS.has(name)) return true;
  return name === 'Bash' && readOnlyCommand(args.command);
}
