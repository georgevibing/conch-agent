/**
 * A shell command in plain words (ADR 0103). The command is read the way a
 * shell would split it (quotes, pipes, `&&`, heredocs), the wrappers that
 * don't change what it does come off (`cd x &&`, `sudo`, `npx`, env vars),
 * and the part that matters most says what the whole command did. Never
 * raw shell in the words: the command itself goes in the subject.
 */
import type { ActivityChip, ActivityEffect, ActivityFamily } from '../activity';
import type { ReadKind } from './output';
import {
  baseName,
  clip,
  favicon,
  folderName,
  hostOf,
  isLocal,
  oneLine,
  plural,
  quote,
  say,
  words,
  type Words,
} from './words';

/** One command's meaning, before its output is read. */
export interface Act {
  family: ActivityFamily;
  words: Words;
  /** How much it says about the whole command: a push outranks the `git add` before it. */
  rank: number;
  /** What it is, to say "Started the tests", "Checked on the dev server". */
  noun: string;
  read?: ReadKind;
  effects?: ActivityEffect[];
  chips?: ActivityChip[];
  push?: { branch?: string; force?: boolean };
  commit?: { message?: string; amend?: boolean };
}

interface Segment {
  words: string[];
  /** What joined it to the one before: `&&`, `|`, `;`, a newline. */
  op: string;
  redirects: { op: string; target: string }[];
  heredoc?: string;
}

interface Context {
  depth: number;
  piped: boolean;
  /** A heredoc piped in from the step before: `cat <<'EOF' | python3`. */
  stdin?: string;
  bodies: string[];
}

const MAX_COMMAND = 8_000;
const MAX_BODY = 20_000;
const MAX_SEGMENTS = 80;
const HOLE = '\u0001';

/** Heredoc bodies come out of the text (they're not commands), each leaving a mark where it was. */
function heredocs(command: string): { text: string; bodies: string[] } {
  const lines = command.split('\n');
  const out: string[] = [];
  const bodies: string[] = [];
  for (let i = 0; i < lines.length && i < 4_000; i++) {
    const line = lines[i] ?? '';
    const tags: { tag: string; dash: boolean }[] = [];
    const marked = line.replace(
      /<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]{0,40})\2/g,
      (match, dash: string, _q: string, tag: string, at: number) => {
        if (line[at - 1] === '<' || line[at + 2] === '<') return match;
        tags.push({ tag, dash: dash === '-' });
        return ` ${HOLE}${bodies.length + tags.length - 1}${HOLE} `;
      },
    );
    out.push(marked);
    for (const { tag, dash } of tags) {
      const body: string[] = [];
      while (i + 1 < lines.length) {
        i++;
        const next = lines[i] ?? '';
        if ((dash ? next.replace(/^\t+/, '') : next).trim() === tag) break;
        body.push(next);
      }
      bodies.push(body.join('\n').slice(0, MAX_BODY));
    }
  }
  return { text: out.join('\n'), bodies };
}

/** The end of a `$(…)` starting at `from` (its `$`), skipping quotes and nested parens. */
function substitutionEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === "'") {
      const close = text.indexOf("'", i + 1);
      i = close < 0 ? text.length : close;
    } else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth <= 0) return i;
    }
  }
  return text.length - 1;
}

/** The command split the way a shell would: words, joins and redirects. */
function split(text: string): Segment[] {
  const segments: Segment[] = [];
  let list: string[] = [];
  let redirects: Segment['redirects'] = [];
  let word = '';
  let started = false;
  let op = '';
  let redirect: string | undefined;
  let quote: '"' | "'" | undefined;
  const pushWord = () => {
    if (!started) return;
    if (redirect) redirects.push({ op: redirect, target: word });
    else list.push(word);
    redirect = undefined;
    word = '';
    started = false;
  };
  const end = (next: string) => {
    pushWord();
    if (list.length || redirects.length) segments.push({ words: list, op, redirects });
    list = [];
    redirects = [];
    redirect = undefined;
    op = next;
  };
  for (let i = 0; i < text.length && segments.length < MAX_SEGMENTS; i++) {
    const c = text[i] ?? '';
    const next = text[i + 1];
    if (quote === "'") {
      if (c === "'") quote = undefined;
      else word += c;
      continue;
    }
    if (c === '\\') {
      if (next === '\n') i++;
      else if (next !== undefined) {
        word += quote === '"' && !/["\\$`]/.test(next) ? `\\${next}` : next;
        started = true;
        i++;
      }
      continue;
    }
    if (c === '$' && next === '(') {
      const close = substitutionEnd(text, i);
      word += text.slice(i, close + 1);
      started = true;
      i = close;
      continue;
    }
    if (c === '`') {
      const close = text.indexOf('`', i + 1);
      const stop = close < 0 ? text.length - 1 : close;
      word += text.slice(i, stop + 1);
      started = true;
      i = stop;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = undefined;
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (c === ' ' || c === '\t') {
      pushWord();
      continue;
    }
    if (c === '\n') {
      end('\n');
      continue;
    }
    if (c === '#' && !started) {
      const stop = text.indexOf('\n', i);
      i = (stop < 0 ? text.length : stop) - 1;
      continue;
    }
    if (c === '&' && next === '&') {
      end('&&');
      i++;
      continue;
    }
    if (c === '|' && next === '|') {
      end('||');
      i++;
      continue;
    }
    if (c === '|') {
      end('|');
      if (next === '&') i++;
      continue;
    }
    if (c === ';') {
      end(';');
      if (next === ';') i++;
      continue;
    }
    if (c === '&' && next === '>') {
      pushWord();
      redirect = text[i + 2] === '>' ? '>>' : '>';
      i += redirect.length;
      continue;
    }
    if (c === '&') {
      end('&');
      continue;
    }
    if (c === '>' || c === '<') {
      // `2>&1`, `2>/dev/null`: the number was the stream, not a word.
      if (started && /^\d+$/.test(word)) {
        word = '';
        started = false;
      } else pushWord();
      let made: string = c;
      if (next === c) {
        made += c;
        i++;
        if (c === '<' && text[i + 1] === '<') {
          made += '<';
          i++;
        }
      }
      if (text[i + 1] === '&') {
        // `>&2`: to another stream, no file.
        i++;
        while (/[\d-]/.test(text[i + 1] ?? '')) i++;
        continue;
      }
      redirect = made;
      continue;
    }
    if ((c === '(' || c === ')' || c === '{' || c === '}') && !started) {
      if (c === '(' || c === '{' || next === undefined || /[\s;&|]/.test(next)) continue;
    }
    word += c;
    started = true;
  }
  end('');
  return segments;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const NOISE_WORDS = new Set([
  'then',
  'do',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
  '{',
  '(',
  'time',
]);

function programName(word: string): string {
  const base = word.replace(/\\/g, '/').split('/').pop() ?? word;
  return base.replace(/\.exe$/i, '');
}

/** The command without what doesn't change its meaning: env vars, sudo, npx, `pnpm exec`. */
function unwrap(input: string[]): string[] {
  let w = input.filter((word) => !word.startsWith(HOLE) || !word.endsWith(HOLE));
  for (let guard = 0; guard < 12 && w.length; guard++) {
    const first = w[0] ?? '';
    const name = programName(first);
    const second = w[1] ?? '';
    if (ASSIGNMENT.test(first) || NOISE_WORDS.has(first)) w = w.slice(1);
    else if (name === 'sudo' || name === 'doas') {
      let i = 1;
      while (i < w.length && (w[i] ?? '').startsWith('-'))
        i += /^-[ugCDhpr]$/.test(w[i] ?? '') ? 2 : 1;
      w = w.slice(i);
    } else if (name === 'env') {
      let i = 1;
      while (i < w.length && (ASSIGNMENT.test(w[i] ?? '') || (w[i] ?? '').startsWith('-'))) i++;
      w = w.slice(i);
    } else if (
      ['nohup', 'exec', 'builtin', 'caffeinate', 'unbuffer', 'stdbuf', 'chronic'].includes(name)
    )
      w = w.slice(1).filter((word, i) => i > 0 || !word.startsWith('-'));
    else if (name === 'command' && second !== '-v' && second !== '-V') w = w.slice(1);
    else if (name === 'nice' || name === 'ionice') {
      let i = 1;
      while (i < w.length && (w[i] ?? '').startsWith('-')) i += /^-[nc]$/.test(w[i] ?? '') ? 2 : 1;
      w = w.slice(i);
    } else if (name === 'timeout' || name === 'gtimeout') {
      let i = 1;
      while (i < w.length && (w[i] ?? '').startsWith('-')) i += /^-[sk]$/.test(w[i] ?? '') ? 2 : 1;
      w = w.slice(i + 1);
    } else if (name === 'xargs') {
      let i = 1;
      while (i < w.length && (w[i] ?? '').startsWith('-'))
        i += /^-[IinPLsdE]$|^--(?:max-args|max-procs|replace|delimiter)$/.test(w[i] ?? '') ? 2 : 1;
      w = w.slice(i);
    } else if (['npx', 'bunx', 'pnpx'].includes(name)) {
      let i = 1;
      while (i < w.length && (w[i] ?? '').startsWith('-'))
        i += /^(?:-p|--package)$/.test(w[i] ?? '') ? 2 : 1;
      w = w.slice(i);
    } else if (
      ['pnpm', 'yarn', 'npm', 'bun'].includes(name) &&
      ['exec', 'dlx', 'x'].includes(second)
    ) {
      let i = 2;
      while (i < w.length && (w[i] ?? '').startsWith('-')) i++;
      w = w.slice(i);
    } else if (
      ['uv', 'poetry', 'pipenv', 'bundle', 'pdm', 'hatch', 'rye', 'conda', 'mamba'].includes(
        name,
      ) &&
      (second === 'run' || second === 'exec')
    ) {
      let i = 2;
      while (i < w.length && (w[i] ?? '').startsWith('-'))
        i += /^(?:-n|--name|--with|-p)$/.test(w[i] ?? '') ? 2 : 1;
      w = w.slice(i);
    } else break;
  }
  return w;
}

/** Arguments that aren't flags, skipping the values of the flags that take one. */
function positional(args: string[], valued: readonly string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') {
      out.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (valued.includes(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function has(args: string[], ...names: string[]): boolean {
  return args.some(
    (a) => names.includes(a) || names.some((n) => n.startsWith('--') && a.startsWith(`${n}=`)),
  );
}

/** A flag's value: `-m x`, `--message=x`, `--message x`. */
function valueOf(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    for (const n of names) {
      if (a === n) return args[i + 1];
      if (n.startsWith('--') && a.startsWith(`${n}=`)) return a.slice(n.length + 1);
    }
  }
  return undefined;
}

function act(
  family: ActivityFamily,
  said: Words,
  rank: number,
  noun: string,
  extra: Partial<Omit<Act, 'family' | 'words' | 'rank' | 'noun'>> = {},
): Act {
  return { family, words: said, rank, noun, ...extra };
}

const fileChip = (path: string): ActivityChip => ({
  kind: 'file',
  label: baseName(path),
  href: path.slice(0, 2000),
});

/** One file by name, two by both names, more by how many. */
function files(paths: string[], noun = 'file'): string {
  const name = (p: string) =>
    /^(?:\/|~|\.{1,2})\/?$/.test(p.trim()) ? folderName(p) : baseName(p);
  if (!paths.length) return `the ${noun}s`;
  if (paths.length === 1) return name(paths[0] ?? '');
  if (paths.length === 2) return `${name(paths[0] ?? '')} and ${name(paths[1] ?? '')}`;
  return plural(paths.length, noun);
}

/** A placeholder in a word put back as the heredoc it stood for. */
function filled(word: string, bodies: string[]): string {
  if (!word.includes(HOLE)) return word;
  const whole = new RegExp(`^\\$\\(\\s*cat\\s*${HOLE}(\\d+)${HOLE}\\s*\\)$`).exec(word.trim());
  if (whole) return bodies[Number(whole[1])] ?? '';
  return word.replace(
    new RegExp(`${HOLE}(\\d+)${HOLE}`, 'g'),
    (_m, n: string) => bodies[Number(n)] ?? '',
  );
}

function bodyOf(seg: Segment, ctx: Context): string | undefined {
  return seg.heredoc ?? ctx.stdin;
}

/** Display names for programs worth a capital. */
const PROGRAM_NAMES: Record<string, string> = {
  node: 'Node',
  python: 'Python',
  python3: 'Python',
  java: 'Java',
  go: 'Go',
  rustc: 'Rust',
  ruby: 'Ruby',
  docker: 'Docker',
  deno: 'Deno',
  bun: 'Bun',
};

function shown(program: string): string {
  return PROGRAM_NAMES[program] ?? program;
}

// ---------------------------------------------------------------- scripts

const PY_FILE =
  /(?:Path|open|read_text|write_text|load|dump)\s*\(\s*(?:r|f)?['"]([^'"\n]{1,300})['"]/g;
const ANY_FILE = /['"]((?:[\w.@~-]+\/)*[\w@-][\w.@-]*\.[A-Za-z][A-Za-z0-9]{0,5})['"]/g;

/** What a script does, read from its code: what it opens, writes, runs or fetches. */
export function scriptAct(
  language: 'python' | 'node' | 'ruby' | 'other',
  code: string,
  ctx: Context,
): Act {
  const text = code.slice(0, 12_000);
  const lang = {
    python: 'a Python script',
    node: 'a Node script',
    ruby: 'a Ruby script',
    other: 'a script',
  }[language];
  const fallback = act('run', say('run', lang), 50, lang);
  if (!text.trim()) return fallback;

  const named = new Set<string>();
  for (const m of text.matchAll(PY_FILE)) if (m[1] && !/^https?:/.test(m[1])) named.add(m[1]);
  if (!named.size)
    for (const m of text.matchAll(ANY_FILE)) {
      const path = m[1] ?? '';
      if (
        !/^(?:https?:|\d)/.test(path) &&
        !/\.(?:com|org|net|io|dev)$/.test(path) &&
        named.size < 20
      )
        named.add(path);
    }
  const paths = [...named].slice(0, 20);

  const writes =
    /\.write_text\(|\.write_bytes\(|open\([^)\n]{0,300},\s*['"][wax]b?\+?['"]|json\.dump\(|writeFileSync\(|writeFile\(|appendFileSync\(|appendFile\(|\.writelines\(|shutil\.(?:copy|move)|os\.replace\(|File\.write/.test(
      text,
    );
  const deletes =
    /os\.remove\(|os\.unlink\(|shutil\.rmtree\(|\.unlink\(|rmSync\(|unlinkSync\(|rmdirSync\(/.test(
      text,
    );
  const runs =
    /subprocess\.|os\.system\(|os\.popen\(|child_process|execSync\(|spawnSync\(|execFileSync\(|\bspawn\(/.test(
      text,
    );
  const url = /['"`](https?:\/\/[^'"`\s]{1,500})['"`]/.exec(text)?.[1];
  const fetches =
    /requests\.(?:get|post|put|patch|delete)\(|urllib|httpx|urlopen\(|\bfetch\(|axios/.test(text);
  const walks =
    /os\.walk\(|\.rglob\(|\.glob\(|os\.listdir\(|\.iterdir\(|glob\.glob\(|readdirSync\(|readdir\(|os\.scandir\(/.test(
      text,
    );
  const searches =
    /re\.(?:search|findall|finditer|match|compile)\(|\.match\(|\bin\s+line\b|\.includes\(|\.search\(/.test(
      text,
    );
  const reads =
    /\.read_text\(|\.read_bytes\(|\bopen\(|json\.load\(|readFileSync\(|readFile\(|\.readlines\(/.test(
      text,
    );

  if (deletes) {
    const target = paths.length === 1 ? baseName(paths[0] ?? '') : 'files';
    return act('edit', say('delete', `${target} with ${lang}`), 60, lang, {
      effects: [
        {
          kind: 'delete',
          text: `Deleted ${target}`,
          ...(paths.length === 1 && { target: paths[0] }),
        },
      ],
    });
  }
  if (writes) {
    const target =
      paths.length === 1
        ? baseName(paths[0] ?? '')
        : paths.length > 1 && paths.length <= 6
          ? plural(paths.length, 'file')
          : undefined;
    if (target)
      return act('edit', say('edit', target), 55, target, {
        effects: paths
          .slice(0, 6)
          .map((p) => ({ kind: 'file' as const, text: `Changed ${baseName(p)}`, target: p })),
        chips: paths.slice(0, 3).map(fileChip),
      });
    return act('edit', say('change', `files with ${lang}`), 55, lang);
  }
  if (runs) {
    const listed =
      /(?:subprocess\.\w+|check_output|check_call|run|call|Popen)\(\s*\[\s*['"]([\w./-]{1,40})['"](?:\s*,\s*['"]([\w./:-]{1,40})['"])?(?:\s*,\s*['"]([\w./:=-]{1,60})['"])?/.exec(
        text,
      );
    const string =
      /(?:subprocess\.\w+|os\.system|os\.popen|execSync|execFileSync|spawnSync)\(\s*[fr]?['"`]([^'"`\n]{1,300})['"`]/.exec(
        text,
      );
    const calls = (
      text.match(/subprocess\.\w+\(|os\.system\(|execSync\(|spawnSync\(|execFileSync\(/g) ?? []
    ).length;
    const inner = listed ? listed.slice(1).filter(Boolean).join(' ') : string?.[1];
    if (inner && ctx.depth < 2) {
      const described = describeCommand(inner, ctx.depth + 1);
      if (described.rank >= 20 && calls <= 1)
        return { ...described, rank: Math.max(described.rank, 50) };
      if (described.rank >= 20)
        return act(
          described.family,
          say('run', `${programName(inner.split(' ')[0] ?? '')} with ${lang}`),
          50,
          lang,
          {
            ...(described.read && { read: described.read }),
          },
        );
    }
    return act('run', say('run', `commands with ${lang}`), 50, lang);
  }
  if (fetches) {
    const host = url ? hostOf(url) : undefined;
    return act('research', say('fetch', host ?? 'a page'), 45, host ?? 'a page', {
      ...(host && url && !isLocal(host) && { chips: [siteChip(url, host)] }),
    });
  }
  if (/sqlite3|psycopg|pymysql|sqlalchemy|better-sqlite3|\bpg\b/.test(text))
    return act('run', say('query', 'a database'), 45, 'a database');
  if (/matplotlib|plotly|seaborn/.test(text))
    return act('make', say('draw', 'a chart'), 45, 'a chart');
  if (/from PIL|import PIL|\bsharp\(|import cv2/.test(text))
    return act('make', say('work', 'on a picture'), 45, 'a picture');
  if (/pandas|import csv|csv\.reader|numpy/.test(text))
    return act(
      'run',
      say('work', paths.length === 1 ? `through ${baseName(paths[0] ?? '')}` : 'through the data'),
      45,
      'the data',
    );
  if (walks && searches)
    return act('explore', say('search', 'the files'), 30, 'the files', { read: 'none' });
  if (walks) return act('explore', say('look', 'through the files'), 30, 'the files');
  if (reads && paths.length)
    return act('explore', say('read', files(paths)), 30, files(paths), {
      chips: paths.slice(0, 3).map(fileChip),
    });
  return fallback;
}

export function siteChip(url: string, host: string): ActivityChip {
  return { kind: 'site', label: clip(host, 120), href: url.slice(0, 2000), image: favicon(host) };
}

// ---------------------------------------------------------------- what kind of script a name means

type Kind =
  | 'tests'
  | 'types'
  | 'lint'
  | 'format-check'
  | 'format'
  | 'build'
  | 'checks'
  | 'serve'
  | 'deploy'
  | 'clean';

function kindOf(name: string): Kind | undefined {
  const n = name.toLowerCase();
  if (/(?:format|fmt|prettier)[:-]?check|check[:-]?(?:format|fmt)/.test(n)) return 'format-check';
  if (/typecheck|type-check|^tsc\b|^types\b|check[:-]?types|^typescript/.test(n)) return 'types';
  if (/lint|eslint|stylelint/.test(n)) return 'lint';
  if (/^(?:format|fmt|prettier|pretty)\b/.test(n)) return 'format';
  if (/test|spec|e2e|vitest|jest|pytest|coverage/.test(n)) return 'tests';
  if (/^(?:build|compile|bundle|dist|package)\b/.test(n)) return 'build';
  if (/^(?:check|verify|validate|ci|precommit|pre-commit|preflight|all)\b/.test(n)) return 'checks';
  if (/^(?:dev|start|serve|preview|watch|storybook)\b/.test(n)) return 'serve';
  if (/^(?:deploy|release|publish|ship)\b/.test(n)) return 'deploy';
  if (/^clean\b/.test(n)) return 'clean';
  return undefined;
}

function kindAct(kind: Kind, name: string, target?: string): Act {
  const inFile = target && /\.[a-z]{1,5}$/i.test(target) ? ` in ${baseName(target)}` : '';
  switch (kind) {
    case 'tests':
      return act('verify', say('run', `the tests${inFile}`), 80, 'the tests', { read: 'tests' });
    case 'types':
      return act('verify', say('check', 'the types'), 78, 'the type check', { read: 'types' });
    case 'lint':
      return act('verify', say('run', 'the linter'), 76, 'the linter', { read: 'lint' });
    case 'format-check':
      return act('verify', say('check', 'the formatting'), 72, 'the format check', {
        read: 'format',
      });
    case 'format':
      return act(
        'edit',
        say('format', target ? baseName(target) : 'the code'),
        55,
        'the formatter',
        { read: 'format' },
      );
    case 'build':
      return act('verify', say('build', 'the project'), 75, 'the build', { read: 'build' });
    case 'checks':
      return act('verify', say('run', 'the checks'), 77, 'the checks', { read: 'checks' });
    case 'serve': {
      const what = /storybook/i.test(name)
        ? 'Storybook'
        : /preview/i.test(name)
          ? 'the preview'
          : /^start/i.test(name)
            ? 'the app'
            : /watch/i.test(name)
              ? 'the watcher'
              : 'the dev server';
      return act('run', say('start', what), 50, what);
    }
    case 'deploy': {
      const verb = /release/i.test(name) ? 'release' : /publish/i.test(name) ? 'publish' : 'deploy';
      const said = say(verb, verb === 'publish' ? 'the package' : 'the project');
      return act('ship', said, 93, 'the deploy', {
        effects: [{ kind: 'publish', text: said.done }],
      });
    }
    case 'clean':
      return act('edit', say('clean', 'up the build files'), 40, 'the clean-up');
  }
}

// ---------------------------------------------------------------- programs

const TEST_RUNNERS = new Set([
  'vitest',
  'jest',
  'mocha',
  'ava',
  'jasmine',
  'pytest',
  'py.test',
  'tap',
  'uvu',
  'karma',
  'rspec',
  'phpunit',
  'tox',
  'nox',
  'ctest',
  'bats',
]);
const TYPE_CHECKERS = new Set([
  'tsc',
  'vue-tsc',
  'tsgo',
  'mypy',
  'pyright',
  'basedpyright',
  'flow',
]);
const LINTERS = new Set([
  'eslint',
  'oxlint',
  'flake8',
  'pylint',
  'stylelint',
  'golangci-lint',
  'shellcheck',
  'rubocop',
  'markdownlint',
  'hadolint',
  'tflint',
  'swiftlint',
  'ktlint',
  'actionlint',
]);
const FORMATTERS = new Set([
  'prettier',
  'black',
  'gofmt',
  'rustfmt',
  'dprint',
  'isort',
  'autopep8',
  'yapf',
  'clang-format',
  'shfmt',
  'stylua',
]);
const FILTERS = new Set([
  'head',
  'tail',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'sort',
  'uniq',
  'wc',
  'cut',
  'awk',
  'gawk',
  'sed',
  'tr',
  'jq',
  'yq',
  'less',
  'more',
  'cat',
  'column',
  'fmt',
  'nl',
  'rev',
  'paste',
  'fold',
  'bat',
  'pbcopy',
  'xclip',
  'tac',
  'ts',
  'cat',
  'strings',
  'base64',
  'md5sum',
  'shasum',
  'sha256sum',
  'xxd',
  'od',
  'hexdump',
  'iconv',
  'ag',
  'ack',
  'grcat',
  'diff-so-fancy',
  'delta',
]);
const FEEDERS = new Set(['echo', 'printf', 'yes', 'true']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const SYSTEM_INSTALLERS = new Set([
  'brew',
  'apt',
  'apt-get',
  'dnf',
  'yum',
  'pacman',
  'apk',
  'port',
  'snap',
  'gem',
  'pip',
  'pip3',
  'pipx',
  'conda',
  'mamba',
  'winget',
  'choco',
  'scoop',
  'composer',
  'nix-env',
  'zypper',
  'flatpak',
  'mas',
  'asdf',
  'mise',
  'rustup',
]);
const READERS = new Set([
  'cat',
  'bat',
  'less',
  'more',
  'head',
  'tail',
  'nl',
  'tac',
  'xxd',
  'hexdump',
  'od',
  'strings',
  'batcat',
]);
const LISTERS = new Set(['ls', 'll', 'la', 'exa', 'eza', 'lsd', 'tree', 'dir']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh']);
const CODE_FILE =
  /\.(?:py|js|mjs|cjs|ts|mts|cts|tsx|jsx|sh|bash|zsh|rb|pl|php|lua|r|jl|swift|go|ps1|command)$/i;

function describeSegment(seg: Segment, ctx: Context): Act | undefined {
  const all = unwrap(seg.words);
  const first = all[0];
  const writeTo = seg.redirects.find((r) => r.op === '>' || r.op === '>>' || r.op === '>|');
  const target =
    writeTo && !/^\/dev\/(?:null|stdout|stderr|tty)$/.test(writeTo.target) ? writeTo : undefined;
  if (!first) {
    // `> file` on its own empties it; a bare heredoc does nothing we can say.
    return target ? writeAct(target.target, target.op === '>>') : undefined;
  }
  const program = programName(first);
  const args = all.slice(1).map((a) => filled(a, ctx.bodies));
  if (ctx.piped && FILTERS.has(program) && program !== 'tee') return undefined;

  // Where the output goes, when that's what the command is for: `cat > notes.md <<EOF`, `echo x >> log`.
  if (
    target &&
    (READERS.has(program) || FEEDERS.has(program) || program === 'tee' || program === 'printf')
  )
    if (program !== 'cat' || !positional(args).length || seg.heredoc)
      return writeAct(target.target, target.op === '>>');

  if (args.length === 1 && /^(?:--version|-v|-V|version)$/.test(args[0] ?? ''))
    return act(
      'explore',
      say('check', `the ${shown(program)} version`),
      15,
      `the ${shown(program)} version`,
    );
  if (args.length >= 1 && /^(?:--help|-h)$/.test(args.at(-1) ?? '') && args.length <= 3)
    return act('explore', say('read', `the help for ${program}`), 15, `the help for ${program}`);

  if (program === 'git') return git(args);
  if (program === 'gh') return gh(args);
  if (PACKAGE_MANAGERS.has(program)) return packageManager(program, args, ctx);
  if (SYSTEM_INSTALLERS.has(program)) return installer(program, args);
  if (TEST_RUNNERS.has(program)) {
    const pos = positional(args, [
      '-c',
      '--config',
      '-k',
      '-m',
      '--reporter',
      '-t',
      '--testNamePattern',
      '--project',
      '-p',
    ]);
    return kindAct(
      'tests',
      program,
      pos.find((p) => p !== 'run' && p !== 'watch'),
    );
  }
  if (TYPE_CHECKERS.has(program)) {
    if (program === 'tsc' && has(args, '-b', '--build')) return kindAct('build', 'build');
    if (program === 'tsc' && has(args, '--init'))
      return act('edit', say('set', 'up TypeScript'), 40, 'TypeScript');
    return kindAct('types', 'types');
  }
  if (LINTERS.has(program)) return kindAct('lint', 'lint');
  if (
    FORMATTERS.has(program) ||
    (program === 'ruff' && args[0] === 'format') ||
    (program === 'biome' && args[0] === 'format')
  ) {
    if (
      has(args, '--check', '-c', '--list-different', '-l', '--diff') ||
      (program === 'gofmt' && has(args, '-l'))
    )
      return kindAct('format-check', 'format');
    const pos = positional(args, ['--config', '--parser', '--log-level', '--ignore-path']).filter(
      (p) => p !== 'format',
    );
    return kindAct('format', 'format', pos.length === 1 ? pos[0] : undefined);
  }
  if (program === 'ruff' || program === 'biome') return kindAct('lint', 'lint');
  if (program === 'playwright' || program === 'cypress') {
    if (args[0] === 'test' || args[0] === 'run') return kindAct('tests', 'test');
    if (args[0] === 'install')
      return act('run', say('install', 'the test browsers'), 60, 'the test browsers', {
        read: 'install',
      });
  }
  if (
    [
      'vite',
      'next',
      'nuxt',
      'astro',
      'remix',
      'svelte-kit',
      'webpack',
      'rollup',
      'esbuild',
      'tsup',
      'parcel',
      'rspack',
      'turbo',
      'nx',
      'lerna',
    ].includes(program)
  )
    return bundler(program, args);
  if (program === 'cargo') return cargo(args);
  if (program === 'go') return goTool(args);
  if (['make', 'gmake', 'just', 'task', 'rake', 'mise'].includes(program))
    return makeTool(program, args);
  if (
    [
      'mvn',
      'mvnw',
      'gradle',
      'gradlew',
      'sbt',
      'dotnet',
      'swift',
      'xcodebuild',
      'bazel',
      'bazelisk',
      'buck',
      'ant',
      'lein',
      'mix',
      'flutter',
      'dart',
    ].includes(program)
  )
    return buildTool(program, args);
  if (program === 'deno') return deno(args, seg, ctx);
  if (/^python(?:\d(?:\.\d+)?)?$|^py$|^pypy3?$|^ipython$/.test(program))
    return python(args, seg, ctx);
  if (['node', 'nodejs', 'tsx', 'ts-node', 'esno', 'vite-node'].includes(program))
    return nodeTool(program, args, seg, ctx);
  if (
    [
      'ruby',
      'perl',
      'php',
      'rscript',
      'lua',
      'julia',
      'osascript',
      'groovy',
      'elixir',
      'Rscript',
    ].includes(program)
  )
    return otherScript(program, args, seg, ctx);
  if (SHELLS.has(program)) return shellTool(args, seg, ctx);
  if (LISTERS.has(program)) {
    const dir = positional(args, ['-L', '-I', '--ignore', '-P'])[0];
    return act('explore', say('look', `through ${folderName(dir)}`), 25, folderName(dir), {
      read: 'entries',
    });
  }
  if (program === 'find') return find(args);
  if (program === 'fd' || program === 'fdfind') {
    const [pattern, dir] = positional(args, [
      '-e',
      '--extension',
      '-t',
      '--type',
      '-E',
      '--exclude',
      '-d',
      '--max-depth',
      '-x',
      '--exec',
    ]);
    return act(
      'explore',
      pattern
        ? say('look', `for files named ${quote(pattern)}`)
        : say('look', `through ${folderName(dir)}`),
      25,
      'the files',
      { read: 'files' },
    );
  }
  if (['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'ugrep'].includes(program))
    return search(program, args);
  if (READERS.has(program)) return reader(program, args);
  if (program === 'wc') {
    const paths = positional(args);
    return act('explore', say('count', `the lines in ${files(paths)}`), 22, files(paths));
  }
  if (
    ['stat', 'file', 'md5sum', 'shasum', 'sha256sum', 'sha1sum', 'md5', 'cksum'].includes(program)
  ) {
    const paths = positional(args, ['-a', '-f', '-c']);
    return act('explore', say('look', `at ${files(paths)}`), 22, files(paths));
  }
  if (program === 'sed' || program === 'perl' || program === 'gsed') return sed(program, args);
  if (program === 'awk' || program === 'gawk') {
    const paths = positional(args, ['-F', '-v', '-f']).slice(1);
    return paths.length
      ? act('explore', say('read', files(paths)), 25, files(paths), {
          chips: paths.slice(0, 1).map(fileChip),
        })
      : undefined;
  }
  if (program === 'jq' || program === 'yq') {
    const paths = positional(args, ['--arg', '--argjson', '-f', '--slurpfile', '--rawfile']).slice(
      1,
    );
    return paths.length
      ? act('explore', say('read', files(paths)), 25, files(paths), {
          chips: paths.slice(0, 1).map(fileChip),
        })
      : undefined;
  }
  if (program === 'tee') {
    const paths = positional(args);
    return paths[0] ? { ...writeAct(paths[0], has(args, '-a', '--append')), rank: 20 } : undefined;
  }
  if (['curl', 'wget', 'http', 'https', 'xh', 'curlie'].includes(program))
    return fetcher(program, args);
  if (program === 'mkdir') {
    const dirs = positional(args, ['-m']);
    const what =
      dirs.length === 1
        ? `the ${baseName(dirs[0] ?? '')} folder`
        : dirs.length
          ? plural(dirs.length, 'folder')
          : 'a folder';
    return act('edit', say('make', what), 30, what);
  }
  if (program === 'touch') {
    const paths = positional(args, ['-t', '-d', '-r']);
    return act('edit', say('create', files(paths)), 45, files(paths), {
      effects: paths
        .slice(0, 10)
        .map((p) => ({ kind: 'file' as const, text: `Created ${baseName(p)}`, target: p })),
      chips: paths.slice(0, 3).map(fileChip),
    });
  }
  if (program === 'cp' || program === 'mv' || program === 'rsync' || program === 'scp')
    return copier(program, args);
  if (['rm', 'rmdir', 'unlink', 'trash', 'trash-put', 'shred', 'del'].includes(program)) {
    const paths = positional(args);
    const what = files(paths);
    return act('edit', say('delete', what), 60, what, {
      effects: (paths.length ? paths.slice(0, 10) : ['']).map((p) => ({
        kind: 'delete' as const,
        text: `Deleted ${p ? baseName(p) : 'files'}`,
        ...(p && { target: p.slice(0, 300) }),
      })),
    });
  }
  if (program === 'ln') {
    const paths = positional(args, ['-t']);
    return act('edit', say('link', files(paths.slice(0, 1))), 30, 'a link');
  }
  if (program === 'chmod' || program === 'chown' || program === 'chgrp') {
    const [mode, ...paths] = positional(args);
    const what = files(paths);
    if (program === 'chmod' && /\+x|^\d*7\d*$/.test(mode ?? ''))
      return act('edit', say('make', `${what} runnable`), 30, what);
    return act(
      'edit',
      say('change', `${program === 'chmod' ? 'who can use' : 'the owner of'} ${what}`),
      30,
      what,
    );
  }
  if (
    ['tar', 'zip', 'unzip', 'gzip', 'gunzip', '7z', 'xz', 'unxz', 'bzip2', 'zstd'].includes(program)
  )
    return archive(program, args);
  if (['diff', 'cmp', 'colordiff', 'delta', 'difft', 'icdiff'].includes(program)) {
    const paths = positional(args, ['-U', '-C', '--label']);
    return act(
      'explore',
      say(
        'compare',
        paths.length === 2
          ? `${baseName(paths[0] ?? '')} and ${baseName(paths[1] ?? '')}`
          : 'files',
      ),
      25,
      'the files',
      { read: 'diff' },
    );
  }
  if (program === 'patch') return act('edit', say('apply', 'a patch'), 55, 'a patch');
  if (
    [
      'sqlite3',
      'psql',
      'mysql',
      'mongo',
      'mongosh',
      'redis-cli',
      'duckdb',
      'clickhouse',
      'pgcli',
      'mycli',
      'litecli',
    ].includes(program)
  ) {
    const db = program === 'sqlite3' || program === 'duckdb' ? positional(args)[0] : undefined;
    const what = db ? `the ${baseName(db)} database` : 'the database';
    return act('run', say('query', what), 45, what);
  }
  if (['open', 'xdg-open', 'start', 'explorer'].includes(program)) {
    const thing = positional(args, ['-a', '-b'])[0] ?? valueOf(args, '-a');
    const host = thing ? hostOf(thing) : undefined;
    if (host && thing)
      return act('run', say('open', host), 40, host, {
        ...(!isLocal(host) && { chips: [siteChip(thing, host)] }),
      });
    return act(
      'run',
      say('open', thing ? baseName(thing) : 'it'),
      40,
      thing ? baseName(thing) : 'it',
    );
  }
  if (['kill', 'pkill', 'killall'].includes(program)) {
    const name = program === 'kill' ? undefined : positional(args, ['-s', '-signal', '-u'])[0];
    const what = name ? baseName(name) : 'a process';
    return act('run', say('stop', what), 40, what);
  }
  if (['ps', 'pgrep', 'top', 'htop', 'btop', 'pstree', 'jobs'].includes(program))
    return act('explore', say('check', 'what’s running'), 20, 'what’s running');
  if (program === 'lsof') {
    const port = /:(\d{2,5})\b/.exec(args.join(' '))?.[1];
    const what = port ? `what’s using port ${port}` : 'open files';
    return act('explore', say('check', what), 22, what);
  }
  if (['netstat', 'ss', 'nc', 'netcat', 'telnet'].includes(program))
    return act('explore', say('check', 'the network ports'), 22, 'the network ports');
  if (['ping', 'traceroute', 'mtr', 'dig', 'nslookup', 'host', 'whois'].includes(program)) {
    const name = positional(args, ['-c', '-t', '-W', '-i', '@'])[0];
    const what = name ? (hostOf(`//${name}`) ?? name) : 'the network';
    return act(
      'explore',
      program === 'ping' || program === 'traceroute' || program === 'mtr'
        ? say('check', `the connection to ${clip(what, 40)}`)
        : say('look', `up ${clip(what, 40)}`),
      25,
      what,
    );
  }
  if (
    ['which', 'whereis', 'where', 'type'].includes(program) ||
    (program === 'command' && /^-[vV]$/.test(args[0] ?? ''))
  ) {
    const names = positional(args);
    const what =
      names.length === 1 ? (names[0] ?? 'a program') : names.length ? 'some programs' : 'a program';
    return act('explore', say('look', `for ${clip(what, 40)}`), 15, what);
  }
  if (program === 'pwd')
    return act('explore', say('check', 'the current folder'), 5, 'the current folder');
  if (program === 'date' || program === 'cal')
    return act('explore', say('check', 'the date'), 5, 'the date');
  if (['whoami', 'id', 'groups', 'who', 'w'].includes(program))
    return act('explore', say('check', 'the user'), 5, 'the user');
  if (
    [
      'uname',
      'sw_vers',
      'hostname',
      'arch',
      'nproc',
      'sysctl',
      'system_profiler',
      'lscpu',
      'free',
      'uptime',
      'vm_stat',
      'lsb_release',
      'neofetch',
    ].includes(program)
  )
    return act('explore', say('check', 'the system'), 10, 'the system');
  if (program === 'env' || program === 'printenv' || program === 'set' || program === 'locale')
    return act('explore', say('check', 'the environment'), 8, 'the environment');
  if (program === 'du') {
    const dir = positional(args, ['-d', '--max-depth'])[0];
    return act(
      'explore',
      say('check', `how much space ${folderName(dir)} takes`),
      22,
      folderName(dir),
    );
  }
  if (program === 'df')
    return act('explore', say('check', 'free disk space'), 20, 'free disk space');
  if (program === 'echo' || program === 'printf')
    return act('run', words('Writing a note', 'Wrote a note'), 5, 'a note');
  if (program === 'sleep') {
    const raw = args[0] ?? '';
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(raw);
    const n = m ? Number(m[1]) : NaN;
    const unit =
      { '': 'second', s: 'second', m: 'minute', h: 'hour', d: 'day' }[m?.[2] ?? ''] ?? 'second';
    const what = Number.isFinite(n) ? plural(n, unit) : 'a moment';
    return act('run', say('wait', what), 8, what);
  }
  if (program === 'wait')
    return act('run', say('wait', 'for the commands to finish'), 6, 'the commands');
  if (program === 'cd' || program === 'pushd' || program === 'popd' || program === 'z')
    return act('explore', say('go', `to ${folderName(args[0])}`), 2, folderName(args[0]));
  if (program === 'source' || program === '.') {
    const file = args[0];
    return act(
      'run',
      say('load', file ? baseName(file) : 'settings'),
      10,
      file ? baseName(file) : 'settings',
    );
  }
  if (
    [
      'export',
      'unset',
      'alias',
      'shopt',
      'trap',
      'local',
      'declare',
      'typeset',
      'readonly',
      'set',
      'ulimit',
      'umask',
      'history',
      'clear',
      'reset',
      'true',
      'false',
      ':',
      'exit',
      'return',
      'fi',
      'done',
      'esac',
      'for',
      'case',
      'select',
      'test',
      '[',
      '[[',
      'read',
      'shift',
      'break',
      'continue',
      'eval',
      'hash',
      'rehash',
      'setopt',
      'unsetopt',
      'disown',
      '}',
      ')',
    ].includes(program)
  )
    return undefined;
  if (['docker', 'podman', 'docker-compose', 'nerdctl', 'colima', 'orbctl'].includes(program))
    return docker(program, args);
  if (program === 'kubectl' || program === 'k' || program === 'helm' || program === 'oc')
    return kube(program, args);
  if (['terraform', 'tofu', 'pulumi', 'cdk', 'sam', 'serverless', 'sls'].includes(program))
    return infra(program, args);
  if (
    [
      'vercel',
      'netlify',
      'fly',
      'flyctl',
      'wrangler',
      'firebase',
      'heroku',
      'railway',
      'surge',
      'amplify',
      'render',
    ].includes(program)
  ) {
    const sub = args[0];
    if (!sub || /^(?:deploy|publish|--prod|up|release)$/.test(sub) || has(args, '--prod')) {
      const said = say('deploy', 'the project');
      return act('ship', said, 93, 'the deploy', {
        effects: [{ kind: 'publish', text: said.done }],
      });
    }
    if (sub === 'dev') return act('run', say('start', 'the dev server'), 50, 'the dev server');
    return act('run', say('run', `${program} ${clip(sub, 20)}`), 35, program);
  }
  if (['ssh', 'mosh'].includes(program)) {
    const pos = positional(args, [
      '-i',
      '-p',
      '-l',
      '-o',
      '-F',
      '-J',
      '-L',
      '-R',
      '-D',
      '-W',
      '-b',
      '-c',
      '-E',
      '-e',
      '-m',
      '-O',
      '-Q',
      '-S',
      '-w',
    ]);
    const host = (pos[0] ?? '').replace(/^.*@/, '') || 'a server';
    return act(
      'run',
      pos.length > 1
        ? say('run', `a command on ${clip(host, 40)}`)
        : say('connect', `to ${clip(host, 40)}`),
      45,
      clip(host, 40),
    );
  }
  if (
    ['systemctl', 'service', 'launchctl', 'brew-services', 'pm2', 'supervisorctl'].includes(program)
  ) {
    const pos = positional(args);
    const verb = pos.find((p) =>
      /^(?:start|stop|restart|reload|status|enable|disable|load|unload|kickstart|bootout)$/.test(p),
    );
    const name = pos.find((p) => p !== verb && !/^(?:--user|gui\/\d+)$/.test(p));
    const what = name ? baseName(name).replace(/\.(?:service|plist)$/, '') : 'a service';
    if (verb === 'status') return act('explore', say('check', clip(what, 40)), 25, what);
    if (verb === 'stop' || verb === 'unload' || verb === 'bootout' || verb === 'disable')
      return act('run', say('stop', clip(what, 40)), 45, what);
    if (verb === 'restart' || verb === 'reload' || verb === 'kickstart')
      return act('run', say('restart', clip(what, 40)), 45, what);
    return act('run', say('start', clip(what, 40)), 45, what);
  }
  if (program === 'crontab')
    return has(args, '-l')
      ? act('explore', say('look', 'at the scheduled jobs'), 20, 'the scheduled jobs')
      : act('edit', say('change', 'the scheduled jobs'), 45, 'the scheduled jobs');
  if (
    ['code', 'cursor', 'vim', 'nvim', 'vi', 'nano', 'emacs', 'subl', 'mate', 'zed', 'hx'].includes(
      program,
    )
  ) {
    const file = positional(args)[0];
    return act(
      'run',
      say('open', `${file ? baseName(file) : 'a file'} in an editor`),
      30,
      file ? baseName(file) : 'a file',
    );
  }
  if (['tmux', 'screen', 'zellij'].includes(program))
    return act('run', say('use', 'a terminal session'), 20, 'a terminal session');
  if (['aws', 'gcloud', 'az', 'doctl', 'gsutil', 's3cmd'].includes(program)) {
    const pos = positional(args, ['--profile', '--region', '--project', '--output', '-o']);
    const what = `${program} ${pos.slice(0, 2).join(' ')}`.trim();
    return act('run', say('run', clip(what, 40)), 40, clip(what, 40));
  }
  if (
    ['ffmpeg', 'convert', 'magick', 'sips', 'pandoc', 'imagemagick', 'cwebp', 'exiftool'].includes(
      program,
    )
  ) {
    const out = positional(args).at(-1);
    return act(
      'make',
      say('convert', out ? `to ${baseName(out)}` : 'a file'),
      45,
      out ? baseName(out) : 'a file',
      {
        ...(out &&
          /\.\w{2,5}$/.test(out) && {
            effects: [{ kind: 'file' as const, text: `Made ${baseName(out)}`, target: out }],
          }),
      },
    );
  }

  // Something to run by its path: ./scripts/check.sh, bin/dev.
  if (first.includes('/') || CODE_FILE.test(first)) {
    const name = baseName(first);
    const kind = kindOf(name.replace(/\.\w+$/, ''));
    if (kind && kind !== 'clean') return kindAct(kind, name);
    return act('run', say('run', name), 50, name);
  }
  // Something we don't know, said by its name when that's safe to show.
  if (/^[\w][\w.+-]{0,30}$/.test(program)) {
    const sub = args[0] && /^[a-z][\w-]{0,20}$/.test(args[0]) ? ` ${args[0]}` : '';
    return act('run', say('run', `${program}${sub}`), 35, program);
  }
  return act('run', say('run', 'a command'), 30, 'a command');
}

function writeAct(path: string, append: boolean): Act {
  const name = baseName(path);
  return act('edit', append ? say('add', `to ${name}`) : say('write', name), 55, name, {
    effects: [
      {
        kind: 'file',
        text: append ? `Added to ${name}` : `Wrote ${name}`,
        target: path.slice(0, 300),
      },
    ],
    chips: [fileChip(path)],
  });
}

function git(input: string[]): Act {
  let i = 0;
  while (i < input.length && (input[i] ?? '').startsWith('-')) {
    const a = input[i] ?? '';
    if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace')
      i += 2;
    else i++;
  }
  const sub = input[i] ?? '';
  const args = input.slice(i + 1);
  const pos = positional(args, [
    '-m',
    '--message',
    '-F',
    '--file',
    '-C',
    '-c',
    '-b',
    '-B',
    '--author',
    '--date',
    '-o',
    '--push-option',
    '--max-count',
    '--format',
    '--pretty',
    '--since',
    '--until',
    '--grep',
    '-S',
    '-G',
    '--depth',
    '--branch',
    '-X',
    '--strategy',
    '-s',
    '--onto',
    '--set-upstream-to',
    '-U',
    '--unified',
  ]);
  switch (sub) {
    case 'status':
      return act('explore', say('check', 'what’s changed'), 28, 'what’s changed', {
        read: 'status',
      });
    case 'diff': {
      const staged = has(args, '--cached', '--staged');
      const paths = pos.filter((p) => /[./]/.test(p) && !/\.\.|^HEAD|^origin\//.test(p));
      const what = paths.length
        ? `the changes to ${files(paths)}`
        : staged
          ? 'the staged changes'
          : 'the changes';
      return act('explore', say('look', `at ${what}`), 28, what, { read: 'diff' });
    }
    case 'log':
    case 'reflog':
    case 'shortlog':
      return act('explore', say('look', 'at recent commits'), 28, 'recent commits', {
        read: 'log',
      });
    case 'show': {
      const ref = pos[0] ?? '';
      const file = /:(.+)$/.exec(ref)?.[1];
      if (file)
        return act('explore', say('read', `${baseName(file)} as it was`), 28, baseName(file));
      return act('explore', say('look', 'at a commit'), 28, 'a commit', { read: 'diff' });
    }
    case 'blame':
    case 'annotate': {
      const file = pos.at(-1);
      return act(
        'explore',
        say('look', `at who changed ${file ? baseName(file) : 'the file'}`),
        28,
        file ? baseName(file) : 'the file',
      );
    }
    case 'grep': {
      const pattern = valueOf(args, '-e') ?? pos[0];
      return act(
        'explore',
        say('search', `the code for ${quote(unescape(pattern ?? ''))}`),
        30,
        'the code',
        { read: 'matches' },
      );
    }
    case 'ls-files':
    case 'ls-tree':
      return act('explore', say('list', 'the files in the repo'), 25, 'the files', {
        read: 'files',
      });
    case 'rev-parse':
    case 'describe':
    case 'remote':
    case 'config':
    case 'symbolic-ref':
    case 'for-each-ref':
    case 'rev-list':
    case 'cat-file':
    case 'merge-base':
    case 'check-ignore':
    case 'count-objects': {
      if (sub === 'remote' && (pos[0] === 'add' || pos[0] === 'set-url'))
        return act('run', say('set', 'up the remote'), 40, 'the remote');
      if (sub === 'config' && pos.length >= 2 && !has(args, '--get', '--list', '-l'))
        return act('run', say('change', 'a git setting'), 35, 'a git setting');
      return act('explore', say('check', 'the repo'), 15, 'the repo');
    }
    case 'add': {
      const paths = pos.filter((p) => p !== '.' && p !== '-A');
      const what =
        has(args, '-A', '--all', '-u') || pos.includes('.') || !paths.length
          ? 'the changes'
          : files(paths);
      return act('ship', say('stage', what), 40, what);
    }
    case 'commit': {
      const raw = valueOf(args, '-m', '--message') ?? commitFlagMessage(args);
      const message = raw ? oneLine(raw.split('\n').find((l) => l.trim()) ?? raw) : undefined;
      const amend = has(args, '--amend');
      const said = amend
        ? say('amend', 'the last commit')
        : message
          ? words(
              'Committing the changes',
              `Committed ${quote(message, 50)}`,
              'Couldn’t commit the changes',
            )
          : say('commit', 'the changes');
      return act('ship', said, 90, 'the commit', {
        read: 'commit',
        commit: { ...(message && { message }), amend },
        effects: [
          {
            kind: 'commit',
            text: message
              ? `Committed ${quote(message, 80)}`
              : amend
                ? 'Amended the last commit'
                : 'Made a commit',
            ...(message && { target: clip(message, 300) }),
          },
        ],
      });
    }
    case 'push': {
      if (has(args, '--delete', '-d')) {
        const branch = pos[1] ?? pos[0];
        const what = branch ? `branch ${clip(branch, 40)} on the remote` : 'a branch on the remote';
        return act('ship', say('delete', what), 85, what, {
          effects: [{ kind: 'delete', text: `Deleted ${what}` }],
        });
      }
      if (has(args, '--tags'))
        return act('ship', say('push', 'the tags'), 88, 'the tags', {
          read: 'push',
          effects: [{ kind: 'push', text: 'Pushed the tags' }],
        });
      const ref = pos[1];
      const branch =
        ref && ref !== 'HEAD'
          ? (ref.split(':').pop() ?? ref).replace(/^\+/, '').replace(/^refs\/heads\//, '')
          : undefined;
      const force =
        has(args, '-f', '--force', '--force-with-lease', '--force-if-includes') ||
        (ref ?? '').startsWith('+');
      return pushAct(branch || undefined, force);
    }
    case 'pull':
      return act('run', say('pull', 'the latest changes'), 61, 'the latest changes', {
        read: 'pull',
      });
    case 'fetch':
      return act('run', say('fetch', 'the latest from the remote'), 45, 'the latest');
    case 'clone': {
      const url = pos[0] ?? '';
      const name = (pos[1] ?? url)
        .replace(/\.git$/, '')
        .split(/[/:]/)
        .filter(Boolean)
        .pop();
      const what = name ? clip(name, 40) : 'a repo';
      return act('run', say('clone', what), 62, what);
    }
    case 'checkout':
    case 'switch': {
      const created = valueOf(args, '-b', '-B', '-c', '-C', '--create');
      if (created)
        return act(
          'run',
          say('make', `branch ${clip(created, 40)}`),
          50,
          `branch ${clip(created, 40)}`,
        );
      const dashIndex = args.indexOf('--');
      if (dashIndex >= 0 || pos.some((p) => /\.\w{1,6}$|\//.test(p) && !/^origin\//.test(p))) {
        const paths = dashIndex >= 0 ? args.slice(dashIndex + 1) : pos;
        const what = paths.includes('.') ? 'the changes' : `the changes to ${files(paths)}`;
        return act('edit', say('undo', what), 56, what, {
          effects: [{ kind: 'file', text: `Undid ${what}` }],
        });
      }
      const branch = pos[0];
      const what = branch ? (branch === '-' ? 'the last branch' : clip(branch, 40)) : 'a branch';
      return act('run', say('switch', `to ${what}`), 50, what);
    }
    case 'restore': {
      const paths = pos;
      if (has(args, '--staged', '-S') && !has(args, '--worktree', '-W'))
        return act('ship', say('unstage', files(paths)), 45, files(paths));
      const what =
        paths.includes('.') || !paths.length ? 'the changes' : `the changes to ${files(paths)}`;
      return act('edit', say('undo', what), 56, what, {
        effects: [{ kind: 'file', text: `Undid ${what}` }],
      });
    }
    case 'branch': {
      const del = valueOf(args, '-d', '-D', '--delete');
      if (del)
        return act('run', say('delete', `branch ${clip(del, 40)}`), 50, `branch ${clip(del, 40)}`, {
          effects: [{ kind: 'delete', text: `Deleted branch ${clip(del, 40)}` }],
        });
      const moved = valueOf(args, '-m', '-M', '--move');
      if (moved) return act('run', say('rename', 'the branch'), 45, 'the branch');
      if (
        pos[0] &&
        !has(args, '--list', '-a', '-r', '-v', '-vv', '--show-current', '--contains', '--merged')
      )
        return act(
          'run',
          say('make', `branch ${clip(pos[0], 40)}`),
          45,
          `branch ${clip(pos[0], 40)}`,
        );
      return act('explore', say('look', 'at the branches'), 20, 'the branches');
    }
    case 'stash': {
      const action = pos[0] ?? 'push';
      if (action === 'list' || action === 'show')
        return act('explore', say('look', 'at the stash'), 20, 'the stash');
      if (action === 'pop' || action === 'apply')
        return act('edit', say('bring', 'back the stashed changes'), 50, 'the stashed changes');
      if (action === 'drop' || action === 'clear')
        return act('edit', say('throw', 'away stashed changes'), 50, 'the stash', {
          effects: [{ kind: 'delete', text: 'Threw away stashed changes' }],
        });
      return act('edit', say('put', 'the changes aside'), 50, 'the changes');
    }
    case 'merge':
      if (has(args, '--abort')) return act('ship', say('stop', 'the merge'), 60, 'the merge');
      return act('ship', say('merge', pos[0] ? clip(pos[0], 40) : 'the changes'), 85, 'the merge');
    case 'rebase': {
      if (has(args, '--continue'))
        return act('ship', say('continue', 'the rebase'), 70, 'the rebase');
      if (has(args, '--abort')) return act('ship', say('stop', 'the rebase'), 60, 'the rebase');
      const onto = valueOf(args, '--onto') ?? pos[0];
      return act(
        'ship',
        say('rebase', onto ? `onto ${clip(onto, 40)}` : 'the branch'),
        84,
        'the rebase',
      );
    }
    case 'cherry-pick':
      return act('ship', say('copy', 'a commit over'), 80, 'a commit', {
        effects: [{ kind: 'commit', text: 'Copied a commit over' }],
      });
    case 'revert':
      return act('ship', say('undo', 'a commit'), 82, 'a commit', {
        effects: [{ kind: 'commit', text: 'Undid a commit' }],
      });
    case 'reset': {
      if (has(args, '--hard'))
        return act('edit', say('throw', 'away local changes'), 58, 'local changes', {
          effects: [{ kind: 'delete', text: 'Threw away local changes' }],
        });
      if (pos.some((p) => /^HEAD[~^]/.test(p)) || has(args, '--soft'))
        return act('ship', say('undo', 'the last commit'), 58, 'the last commit', {
          effects: [{ kind: 'commit', text: 'Undid the last commit' }],
        });
      return act('ship', say('unstage', 'the changes'), 45, 'the changes');
    }
    case 'tag': {
      if (!pos.length || has(args, '-l', '--list'))
        return act('explore', say('look', 'at the tags'), 20, 'the tags');
      if (has(args, '-d', '--delete'))
        return act('ship', say('delete', `tag ${clip(pos[0] ?? '', 30)}`), 60, 'a tag');
      return act('ship', say('tag', clip(pos[0] ?? 'a release', 30)), 84, 'a tag', {
        effects: [{ kind: 'other', text: `Tagged ${clip(pos[0] ?? 'a release', 30)}` }],
      });
    }
    case 'rm': {
      const what = files(pos);
      return act('edit', say('remove', `${what} from the repo`), 60, what, {
        effects: pos
          .slice(0, 10)
          .map((p) => ({ kind: 'delete' as const, text: `Deleted ${baseName(p)}`, target: p })),
      });
    }
    case 'mv': {
      const [from, to] = pos;
      return act(
        'edit',
        say('move', from ? `${baseName(from)}${to ? ` to ${baseName(to)}` : ''}` : 'a file'),
        50,
        'a file',
        { effects: [{ kind: 'file', text: `Moved ${from ? baseName(from) : 'a file'}` }] },
      );
    }
    case 'worktree':
      if (pos[0] === 'add') return act('run', say('make', 'a working copy'), 45, 'a working copy');
      if (pos[0] === 'remove')
        return act('run', say('remove', 'a working copy'), 45, 'a working copy');
      return act('explore', say('look', 'at the working copies'), 20, 'the working copies');
    case 'init':
      return act('run', say('make', 'a new repo'), 45, 'a new repo');
    case 'clean':
      return act('edit', say('clean', 'out untracked files'), 58, 'untracked files', {
        effects: [{ kind: 'delete', text: 'Cleaned out untracked files' }],
      });
    case 'submodule':
      return act('run', say('update', 'the submodules'), 40, 'the submodules');
    case 'apply':
    case 'am':
      return act('edit', say('apply', 'a patch'), 55, 'a patch');
    case 'bisect':
      return act('explore', say('narrow', 'down the bad commit'), 40, 'the bad commit');
    default:
      return act('run', say('run', sub ? `git ${clip(sub, 20)}` : 'git'), 30, 'git');
  }
}

function commitFlagMessage(args: string[]): string | undefined {
  // `-am "msg"`: the message follows the bundle that ends in m.
  for (let i = 0; i < args.length; i++) if (/^-[a-zA-Z]*m$/.test(args[i] ?? '')) return args[i + 1];
  return undefined;
}

/** "Pushing to main", "Force-pushing to fix/x", "Pushing the commits". */
export function pushAct(branch: string | undefined, force: boolean): Act {
  const verb = force ? 'force-push' : 'push';
  const what = branch ? `to ${clip(branch, 50)}` : 'the commits';
  const said = say(verb, what);
  return act('ship', said, 95, branch ? clip(branch, 50) : 'the push', {
    read: 'push',
    push: { ...(branch && { branch }), force },
    effects: [{ kind: 'push', text: said.done, ...(branch && { target: branch.slice(0, 300) }) }],
  });
}

function unescape(pattern: string): string {
  return pattern.replace(/\\([^\w\s])/g, '$1');
}

function gh(args: string[]): Act {
  const [area = '', sub = ''] = positional(args, ['-R', '--repo']);
  const pos = positional(args, [
    '-R',
    '--repo',
    '-t',
    '--title',
    '-b',
    '--body',
    '-B',
    '--base',
    '-H',
    '--head',
    '-l',
    '--label',
    '-a',
    '--assignee',
    '-F',
    '--body-file',
    '-L',
    '--limit',
    '-s',
    '--state',
    '--json',
    '-q',
    '--jq',
    '-m',
    '--message',
    '--notes',
    '-n',
  ]).slice(2);
  const number = pos.find((p) => /^#?\d+$/.test(p) || /\/(?:pull|issues)\/\d+/.test(p));
  const ref = number ? ` #${/\d+$/.exec(number)?.[0] ?? number}` : '';
  const title = valueOf(args, '-t', '--title');
  if (area === 'pr') {
    if (sub === 'create' || sub === 'new') {
      const said = say('open', 'a pull request');
      return act('ship', said, 94, 'the pull request', {
        effects: [
          {
            kind: 'publish',
            text: title ? `Opened a pull request ${quote(title, 60)}` : said.done,
          },
        ],
      });
    }
    if (sub === 'merge')
      return act('ship', say('merge', `pull request${ref}`), 92, 'the pull request', {
        effects: [{ kind: 'push', text: `Merged pull request${ref}` }],
      });
    if (sub === 'comment' || sub === 'review')
      return act('connect', say('comment', `on pull request${ref}`), 70, 'the pull request', {
        effects: [{ kind: 'send', text: `Commented on pull request${ref}` }],
      });
    if (sub === 'checks')
      return act('verify', say('check', `the checks on pull request${ref}`), 60, 'the checks');
    if (sub === 'checkout')
      return act('run', say('switch', `to pull request${ref}`), 50, 'the pull request');
    if (sub === 'close')
      return act('ship', say('close', `pull request${ref}`), 70, 'the pull request', {
        effects: [{ kind: 'other', text: `Closed pull request${ref}` }],
      });
    if (sub === 'edit')
      return act('ship', say('update', `pull request${ref}`), 70, 'the pull request', {
        effects: [{ kind: 'other', text: `Updated pull request${ref}` }],
      });
    if (sub === 'list' || sub === 'status')
      return act('research', say('look', 'at the pull requests'), 30, 'the pull requests');
    return act('research', say('look', `at pull request${ref}`), 30, 'the pull request');
  }
  if (area === 'issue') {
    if (sub === 'create' || sub === 'new')
      return act('connect', say('open', 'an issue'), 80, 'the issue', {
        effects: [
          { kind: 'send', text: title ? `Opened an issue ${quote(title, 60)}` : 'Opened an issue' },
        ],
      });
    if (sub === 'comment')
      return act('connect', say('comment', `on issue${ref}`), 70, 'the issue', {
        effects: [{ kind: 'send', text: `Commented on issue${ref}` }],
      });
    if (sub === 'close')
      return act('connect', say('close', `issue${ref}`), 70, 'the issue', {
        effects: [{ kind: 'other', text: `Closed issue${ref}` }],
      });
    if (sub === 'list') return act('research', say('look', 'at the issues'), 30, 'the issues');
    return act('research', say('look', `at issue${ref}`), 30, 'the issue');
  }
  if (area === 'run' || area === 'workflow') {
    if (sub === 'watch')
      return act('verify', say('watch', 'the CI run'), 60, 'the CI run', { read: 'checks' });
    if (sub === 'rerun' || sub === 'run')
      return act('verify', say('start', 'the CI run again'), 60, 'the CI run');
    return act('verify', say('check', 'the CI runs'), 55, 'the CI runs');
  }
  if (area === 'release') {
    if (sub === 'create') {
      const tag = pos[0] ? clip(pos[0], 30) : 'a release';
      return act('ship', say('publish', tag), 93, 'the release', {
        effects: [{ kind: 'publish', text: `Published ${tag}` }],
      });
    }
    return act('research', say('look', 'at the releases'), 30, 'the releases');
  }
  if (area === 'repo' && sub === 'clone')
    return act('run', say('clone', clip(pos[0]?.split('/').pop() ?? 'a repo', 40)), 62, 'the repo');
  if (area === 'repo' && sub === 'create')
    return act('ship', say('make', 'a new repo on GitHub'), 80, 'a repo', {
      effects: [{ kind: 'publish', text: 'Made a new repo on GitHub' }],
    });
  if (area === 'auth')
    return act('explore', say('check', 'the GitHub sign-in'), 15, 'the GitHub sign-in');
  if (area === 'api') return act('research', say('ask', 'GitHub'), 35, 'GitHub');
  if (area === 'search') return act('research', say('search', 'GitHub'), 35, 'GitHub');
  return act('research', say('use', 'GitHub'), 30, 'GitHub');
}

function packageNames(pkgs: string[]): string {
  const names = pkgs.map((p) =>
    p
      .replace(/(.)@[^/@]*$/, '$1')
      .replace(/[<>=~^!].*$/, '')
      .replace(/\[.*\]$/, ''),
  );
  if (names.length === 1) return clip(names[0] ?? 'a package', 40);
  if (names.length === 2) return clip(`${names[0]} and ${names[1]}`, 60);
  return plural(names.length, 'package');
}

function installAct(pkgs: string[]): Act {
  const what = packageNames(pkgs);
  return act('run', say('add', what), 70, what, {
    read: 'install',
    effects: [{ kind: 'install', text: `Installed ${what}`, target: clip(pkgs.join(' '), 300) }],
  });
}

function removeAct(pkgs: string[]): Act {
  const what = pkgs.length ? packageNames(pkgs) : 'a package';
  return act('run', say('remove', what), 60, what, {
    effects: [
      {
        kind: 'delete',
        text: `Removed ${what}`,
        ...(pkgs.length && { target: clip(pkgs.join(' '), 300) }),
      },
    ],
  });
}

const dependencies = () =>
  act('run', say('install', 'the dependencies'), 65, 'the install', { read: 'install' });

function packageManager(program: string, args: string[], ctx: Context): Act | undefined {
  const valued = [
    '--filter',
    '-F',
    '-C',
    '--dir',
    '--prefix',
    '--cwd',
    '--workspace',
    '-w',
    '--reporter',
    '--loglevel',
    '--registry',
    '--tag',
    '--otp',
  ];
  const pos = positional(args, program === 'npm' ? valued : valued.filter((v) => v !== '-w'));
  const sub = pos[0];
  const rest = pos.slice(1);
  if (!sub) return program === 'npm' ? undefined : dependencies();
  if (['install', 'i', 'add', 'ci', 'isntall', 'in'].includes(sub)) {
    if (sub === 'ci' || !rest.length) return dependencies();
    return installAct(rest);
  }
  if (['remove', 'rm', 'uninstall', 'un', 'r', 'unlink'].includes(sub)) return removeAct(rest);
  if (['update', 'upgrade', 'up', 'dedupe'].includes(sub))
    return act(
      'run',
      say('update', rest.length ? packageNames(rest) : 'the dependencies'),
      60,
      'the update',
      { read: 'install' },
    );
  if (['test', 't', 'tst'].includes(sub))
    return kindAct(
      'tests',
      'test',
      rest.find((r) => r !== 'run'),
    );
  if (sub === 'run' || sub === 'run-script') {
    const script = rest[0];
    if (!script) return act('explore', say('look', 'at the scripts'), 15, 'the scripts');
    const kind = kindOf(script);
    return kind
      ? kindAct(kind, script, rest[1])
      : act(
          'run',
          say('run', `the ${clip(script, 30)} script`),
          45,
          `the ${clip(script, 30)} script`,
        );
  }
  if (['exec', 'dlx', 'x'].includes(sub)) {
    const inner = unwrap(args.slice(args.indexOf(sub) + 1).filter((a) => !a.startsWith('-')));
    return inner.length ? describeSegment({ words: inner, op: '', redirects: [] }, ctx) : undefined;
  }
  if (sub === 'publish') {
    const said = say('publish', 'the package');
    return act('ship', said, 92, 'the package', {
      effects: [{ kind: 'publish', text: said.done }],
    });
  }
  if (sub === 'version') return act('ship', say('bump', 'the version'), 70, 'the version');
  if (
    [
      'view',
      'info',
      'show',
      'ls',
      'list',
      'why',
      'outdated',
      'explain',
      'search',
      'docs',
      'repo',
    ].includes(sub)
  )
    return act(
      'explore',
      say('look', rest[0] ? `up ${clip(rest[0], 40)}` : 'at the packages'),
      25,
      'the packages',
    );
  if (sub === 'audit')
    return act('verify', say('check', 'the dependencies for known problems'), 60, 'the audit');
  if (sub === 'init' || sub === 'create')
    return act('make', say('set', 'up a new project'), 55, 'a new project');
  if (sub === 'config' || sub === 'get' || sub === 'set')
    return act('explore', say('check', `the ${program} settings`), 15, 'the settings');
  if (sub === 'pack') return act('make', say('pack', 'the package'), 50, 'the package');
  if (sub === 'link') return act('run', say('link', 'the package'), 40, 'the package');
  if (sub === 'cache' || sub === 'store' || sub === 'prune')
    return act('run', say('tidy', `the ${program} cache`), 30, 'the cache');
  if (sub === 'start' || sub === 'stop' || sub === 'restart') return kindAct('serve', sub);
  if (sub === 'build' && program === 'bun') return kindAct('build', 'build');
  if (program === 'bun' && CODE_FILE.test(sub))
    return act('run', say('run', baseName(sub)), 50, baseName(sub));
  if (program !== 'npm' || sub === 'start') {
    const kind = kindOf(sub);
    if (kind) return kindAct(kind, sub, rest[0]);
    return act('run', say('run', `the ${clip(sub, 30)} script`), 45, `the ${clip(sub, 30)} script`);
  }
  return act('run', say('run', `npm ${clip(sub, 20)}`), 35, 'npm');
}

function installer(program: string, args: string[]): Act {
  const pos = positional(args, [
    '-r',
    '--requirement',
    '-c',
    '--constraint',
    '-i',
    '--index-url',
    '--extra-index-url',
    '-t',
    '--target',
    '--python',
    '-n',
    '--name',
    '-p',
  ]);
  const sub =
    program === 'pacman'
      ? args.find((a) => /^-S/.test(a))
        ? 'install'
        : args.find((a) => /^-R/.test(a))
          ? 'remove'
          : 'list'
      : pos[0];
  const rest = program === 'pacman' ? pos : pos.slice(1);
  if (['install', 'add', 'i', 'require', 'get', 'reinstall', 'tap', 'cask'].includes(sub ?? '')) {
    if (has(args, '-r', '--requirement')) return dependencies();
    if (has(args, '-e', '--editable') || rest[0] === '.')
      return act('run', say('install', 'the project'), 65, 'the project', { read: 'install' });
    const pkgs = rest.filter((p) => !/^(?:install|--cask)$/.test(p));
    return pkgs.length ? installAct(pkgs) : dependencies();
  }
  if (['uninstall', 'remove', 'rm', 'purge', 'autoremove'].includes(sub ?? ''))
    return removeAct(rest);
  if (['update', 'upgrade', 'outdated', 'self-update', 'selfupdate'].includes(sub ?? ''))
    return act(
      'run',
      say('update', rest.length ? packageNames(rest) : 'the installed programs'),
      55,
      'the update',
      { read: 'install' },
    );
  if (program === 'brew' && sub === 'services') {
    const verb =
      rest[0] === 'stop'
        ? 'stop'
        : rest[0] === 'restart'
          ? 'restart'
          : rest[0] === 'list'
            ? 'check'
            : 'start';
    return act('run', say(verb, clip(rest[1] ?? 'the services', 30)), 45, 'the service');
  }
  return act('explore', say('look', 'at the installed packages'), 20, 'the installed packages');
}

function bundler(program: string, args: string[]): Act {
  const pos = positional(args, [
    '--config',
    '-c',
    '--mode',
    '--port',
    '-p',
    '--filter',
    '--scope',
    '--project',
    '-t',
    '--target',
  ]);
  if (program === 'turbo' || program === 'nx' || program === 'lerna') {
    const task =
      pos[0] === 'run' || pos[0] === 'run-many'
        ? (pos[1] ?? valueOf(args, '-t', '--target'))
        : pos[0];
    const kind = task ? kindOf(task) : undefined;
    return kind
      ? kindAct(kind, task ?? '')
      : act('run', say('run', `the ${clip(task ?? 'tasks', 30)} task`), 45, 'the tasks');
  }
  const sub = pos[0];
  if (
    sub === 'build' ||
    (['webpack', 'rollup', 'esbuild', 'tsup', 'parcel', 'rspack'].includes(program) &&
      sub !== 'serve' &&
      sub !== 'watch' &&
      !has(args, '--watch', '-w', 'serve'))
  )
    return kindAct('build', 'build');
  if (sub === 'preview') return kindAct('serve', 'preview');
  if (sub === 'start') return kindAct('serve', 'start');
  if (sub === 'lint') return kindAct('lint', 'lint');
  return kindAct('serve', 'dev');
}

function cargo(args: string[]): Act {
  const pos = positional(args, [
    '-p',
    '--package',
    '--bin',
    '--features',
    '-F',
    '--target',
    '-j',
    '--manifest-path',
  ]);
  const sub = pos[0] ?? '';
  if (sub === 'test' || sub === 't' || sub === 'nextest') return kindAct('tests', 'test');
  if (sub === 'build' || sub === 'b') return kindAct('build', 'build');
  if (sub === 'check' || sub === 'c')
    return act('verify', say('check', 'the code'), 76, 'the check', { read: 'build' });
  if (sub === 'clippy') return kindAct('lint', 'lint');
  if (sub === 'fmt')
    return has(args, '--check') ? kindAct('format-check', 'fmt') : kindAct('format', 'fmt');
  if (sub === 'run' || sub === 'r') return act('run', say('run', 'the program'), 50, 'the program');
  if (sub === 'add' || sub === 'install')
    return pos.length > 1 ? installAct(pos.slice(1)) : dependencies();
  if (sub === 'remove' || sub === 'rm' || sub === 'uninstall') return removeAct(pos.slice(1));
  if (sub === 'bench') return act('verify', say('run', 'the benchmarks'), 70, 'the benchmarks');
  if (sub === 'doc') return act('make', say('build', 'the docs'), 50, 'the docs');
  if (sub === 'publish') return kindAct('deploy', 'publish');
  if (sub === 'update') return act('run', say('update', 'the dependencies'), 55, 'the update');
  if (sub === 'new' || sub === 'init')
    return act('make', say('set', 'up a new project'), 55, 'a new project');
  return act('run', say('run', `cargo ${clip(sub, 20)}`.trim()), 35, 'cargo');
}

function goTool(args: string[]): Act {
  const pos = positional(args, ['-run', '-o', '-tags', '-count', '-timeout', '-p', '-bench']);
  const sub = pos[0] ?? '';
  if (sub === 'test') return kindAct('tests', 'test');
  if (sub === 'build' || (sub === 'install' && pos[1]?.startsWith('./')))
    return kindAct('build', 'build');
  if (sub === 'vet') return kindAct('lint', 'vet');
  if (sub === 'fmt') return kindAct('format', 'fmt');
  if (sub === 'run')
    return act('run', say('run', pos[1] ? baseName(pos[1]) : 'the program'), 50, 'the program');
  if (sub === 'mod') return act('run', say('tidy', 'the Go modules'), 50, 'the Go modules');
  if (sub === 'get' || sub === 'install')
    return pos.length > 1 ? installAct(pos.slice(1)) : dependencies();
  if (sub === 'version' || sub === 'env')
    return act('explore', say('check', 'the Go setup'), 15, 'the Go setup');
  if (sub === 'generate') return act('make', say('generate', 'code'), 50, 'code');
  return act('run', say('run', `go ${clip(sub, 20)}`.trim()), 35, 'go');
}

function makeTool(program: string, args: string[]): Act {
  const pos = positional(args, [
    '-C',
    '-f',
    '--file',
    '-j',
    '--jobs',
    '-l',
    '--directory',
    '-d',
  ]).filter((p) => !ASSIGNMENT.test(p));
  const target =
    program === 'mise'
      ? pos[0] === 'run'
        ? pos[1]
        : pos[0] === 'install'
          ? undefined
          : pos[0]
      : pos[0];
  if (program === 'mise' && pos[0] === 'install') return dependencies();
  if (!target) return kindAct('build', 'build');
  const kind = kindOf(target);
  if (kind) return kindAct(kind, target);
  if (target === 'install' || target === 'setup' || target === 'deps') return dependencies();
  const what = `${program} ${clip(target, 24)}`;
  return act('run', say('run', what), 45, what);
}

function buildTool(program: string, args: string[]): Act {
  const pos = positional(args, [
    '-p',
    '--project',
    '-c',
    '--configuration',
    '-f',
    '-s',
    '-scheme',
    '-D',
    '--parallel',
  ]).map((p) => p.replace(/^:?(?:[\w-]+:)*/, ''));
  const sub =
    pos.find(
      (p) => kindOf(p) || /^(?:run|install|package|assemble|compile|bootRun|clean|verify)$/.test(p),
    ) ??
    pos[0] ??
    '';
  if (/^(?:package|assemble|compile|install|jar|war)$/.test(sub)) return kindAct('build', 'build');
  if (/^(?:run|bootRun|start)$/.test(sub)) return act('run', say('run', 'the app'), 50, 'the app');
  if (sub === 'verify') return kindAct('checks', 'check');
  if (sub === 'pub' && pos[1] === 'get') return dependencies();
  const kind = kindOf(sub);
  if (kind) return kindAct(kind, sub);
  return act('run', say('run', `${program} ${clip(sub, 20)}`.trim()), 40, program);
}

function deno(args: string[], seg: Segment, ctx: Context): Act {
  const pos = positional(args, ['--allow-read', '--config', '-c']);
  const sub = pos[0] ?? '';
  if (sub === 'test') return kindAct('tests', 'test');
  if (sub === 'lint') return kindAct('lint', 'lint');
  if (sub === 'fmt')
    return has(args, '--check') ? kindAct('format-check', 'fmt') : kindAct('format', 'fmt');
  if (sub === 'check') return kindAct('types', 'check');
  if (sub === 'task') {
    const kind = pos[1] ? kindOf(pos[1]) : undefined;
    return kind
      ? kindAct(kind, pos[1] ?? '')
      : act('run', say('run', `the ${clip(pos[1] ?? 'deno', 30)} task`), 45, 'the task');
  }
  if (sub === 'eval') return scriptAct('node', pos.slice(1).join(' '), ctx);
  if (sub === 'run' && pos[1])
    return act('run', say('run', baseName(pos[1])), 50, baseName(pos[1]));
  if (sub === 'install' || sub === 'add')
    return pos.length > 1 ? installAct(pos.slice(1)) : dependencies();
  const body = bodyOf(seg, ctx);
  if (body) return scriptAct('node', body, ctx);
  return act('run', say('run', 'Deno'), 35, 'Deno');
}

function python(args: string[], seg: Segment, ctx: Context): Act {
  const module = valueOf(args, '-m');
  if (module) {
    const rest = args.slice(args.indexOf('-m') + 2);
    if (module === 'pytest' || module === 'unittest' || module === 'nose2' || module === 'tox')
      return kindAct('tests', 'test', positional(rest, ['-k', '-m', '-c'])[0]);
    if (module === 'pip' || module === 'pip3') return installer('pip', rest);
    if (module === 'mypy' || module === 'pyright') return kindAct('types', 'types');
    if (module === 'black' || module === 'isort' || module === 'autopep8')
      return has(rest, '--check') ? kindAct('format-check', 'fmt') : kindAct('format', 'fmt');
    if (module === 'flake8' || module === 'pylint' || module === 'ruff')
      return kindAct('lint', 'lint');
    if (module === 'http.server' || module === 'SimpleHTTPServer')
      return act('run', say('start', 'a web server'), 50, 'the web server');
    if (module === 'venv' || module === 'virtualenv')
      return act('run', say('make', 'a virtual environment'), 45, 'a virtual environment');
    if (module === 'json.tool') return act('explore', say('read', 'the JSON'), 20, 'the JSON');
    if (module === 'build') return kindAct('build', 'build');
    if (module === 'py_compile' || module === 'compileall')
      return act('verify', say('check', 'the code compiles'), 60, 'the check');
    if (module === 'doctest') return kindAct('tests', 'test');
    return act(
      'run',
      say('run', `the ${clip(module, 30)} module`),
      45,
      `the ${clip(module, 30)} module`,
    );
  }
  const code = valueOf(args, '-c');
  if (code !== undefined) return scriptAct('python', code, ctx);
  const file = positional(args, ['-W', '-X', '-Q'])[0];
  if (file && file !== '-') {
    const name = baseName(file);
    const pos = positional(args).slice(1);
    if (name === 'manage.py' && pos[0] === 'test') return kindAct('tests', 'test');
    if (name === 'manage.py' && pos[0] === 'runserver') return kindAct('serve', 'dev');
    if (name === 'manage.py' && pos[0])
      return act('run', say('run', `manage.py ${clip(pos[0], 20)}`), 50, 'manage.py');
    const kind = kindOf(name.replace(/\.py$/, ''));
    if (kind === 'tests') return kindAct('tests', name);
    return act('run', say('run', name), 50, name);
  }
  const body = bodyOf(seg, ctx);
  return body !== undefined
    ? scriptAct('python', body, ctx)
    : act('run', say('start', 'Python'), 20, 'Python');
}

function nodeTool(program: string, args: string[], seg: Segment, ctx: Context): Act {
  const code = valueOf(args, '-e', '--eval', '-p', '--print');
  if (code !== undefined) return scriptAct('node', code, ctx);
  if (has(args, '--test')) return kindAct('tests', 'test');
  const file = positional(args, [
    '-r',
    '--require',
    '--import',
    '--loader',
    '--env-file',
    '--input-type',
    '--max-old-space-size',
  ])[0];
  if (file && file !== '-') {
    const name = baseName(file);
    const kind = kindOf(name.replace(/\.[mc]?[jt]sx?$/, ''));
    if (kind === 'tests') return kindAct('tests', name);
    return act('run', say('run', name), 50, name);
  }
  const body = bodyOf(seg, ctx);
  return body !== undefined
    ? scriptAct('node', body, ctx)
    : act('run', say('start', shown(program)), 20, shown(program));
}

function otherScript(program: string, args: string[], seg: Segment, ctx: Context): Act {
  const code = valueOf(args, '-e', '-E', '-r');
  const language = program === 'ruby' ? 'ruby' : 'other';
  if (code !== undefined) return scriptAct(language, code, ctx);
  const file = positional(args, ['-I', '-M'])[0];
  if (file && file !== '-') return act('run', say('run', baseName(file)), 50, baseName(file));
  const body = bodyOf(seg, ctx);
  return body !== undefined
    ? scriptAct(language, body, ctx)
    : act('run', say('run', program), 35, program);
}

function shellTool(args: string[], seg: Segment, ctx: Context): Act {
  const flagIndex = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
  if (flagIndex >= 0 && args[flagIndex + 1] !== undefined && ctx.depth < 3)
    return describeCommand(args[flagIndex + 1] ?? '', ctx.depth + 1);
  const file = positional(args, ['-o', '+o'])[0];
  if (file) {
    const name = baseName(file);
    const kind = kindOf(name.replace(/\.\w+$/, ''));
    if (kind && kind !== 'clean') return kindAct(kind, name);
    return act('run', say('run', name), 50, name);
  }
  const body = bodyOf(seg, ctx);
  if (body && ctx.depth < 3) return describeCommand(body, ctx.depth + 1);
  return act('run', say('run', 'a shell'), 20, 'a shell');
}

function find(args: string[]): Act {
  const dir = args.find((a) => !a.startsWith('-') && a !== '(' && a !== '!' && a !== ')');
  const name = valueOf(args, '-name', '-iname', '-path', '-ipath', '-regex');
  const removes = has(args, '-delete') || /-exec(?:dir)?\s+rm\b/.test(args.join(' '));
  if (removes)
    return act(
      'edit',
      say('delete', name ? `files named ${quote(name)}` : 'files'),
      60,
      'the files',
      {
        effects: [
          { kind: 'delete', text: `Deleted ${name ? `files named ${quote(name)}` : 'files'}` },
        ],
      },
    );
  const grep = /-exec\s+(?:grep|rg)\s+(?:-\S+\s+)*(\S+)/.exec(args.join(' '));
  if (grep?.[1])
    return act(
      'explore',
      say('search', `the files for ${quote(unescape(grep[1]))}`),
      30,
      'the files',
      { read: 'matches' },
    );
  const folders = valueOf(args, '-type') === 'd';
  const what = name ? `${folders ? 'folders' : 'files'} named ${quote(name)}` : undefined;
  return act(
    'explore',
    what ? say('look', `for ${what}`) : say('look', `through ${folderName(dir)}`),
    25,
    what ?? folderName(dir),
    { read: 'files' },
  );
}

function search(program: string, args: string[]): Act {
  const valued = [
    '-e',
    '-f',
    '-m',
    '-A',
    '-B',
    '-C',
    '-g',
    '--glob',
    '-t',
    '--type',
    '-T',
    '--type-not',
    '--max-count',
    '-M',
    '--max-columns',
    '-j',
    '--threads',
    '--context',
    '-r',
    '--replace',
    '--sort',
    '--sortr',
    '--iglob',
    '--type-add',
    '-E',
    '--encoding',
    '--include',
    '--exclude',
    '--exclude-dir',
    '-d',
    '-D',
    '--color',
    '--colour',
    '--max-depth',
  ];
  const effective = program === 'rg' ? valued : valued.filter((v) => v !== '-r' && v !== '-E');
  const pos = positional(args, effective);
  const explicit = valueOf(args, '-e', '--regexp');
  const pattern = explicit ?? pos[0] ?? '';
  const paths = explicit !== undefined ? pos : pos.slice(1);
  const shownPattern = quote(unescape(pattern));
  const path = paths.length === 1 ? (paths[0] ?? '') : undefined;
  const place =
    path && path !== '.'
      ? /\.\w{1,6}$/.test(path) && !path.endsWith('/')
        ? baseName(path)
        : folderName(path)
      : 'the code';
  const listsFiles = has(args, '-l', '--files-with-matches', '-L', '--files-without-match');
  return act('explore', say('search', `${place} for ${shownPattern}`), 30, place, {
    read: listsFiles ? 'files' : 'matches',
    ...(path && /\.\w{1,6}$/.test(path) && { chips: [fileChip(path)] }),
  });
}

function reader(program: string, args: string[]): Act | undefined {
  const paths = positional(args, [
    '-n',
    '-c',
    '--lines',
    '--bytes',
    '-s',
    '-l',
    '-H',
    '--line-range',
    '-r',
    '--language',
    '-m',
  ]).filter((p) => !/^[+-]?\d+$/.test(p));
  if (!paths.length) return undefined;
  if ((program === 'tail' && has(args, '-f', '-F', '--follow')) || program === 'less')
    return act(
      'explore',
      program === 'less' ? say('read', files(paths)) : say('watch', files(paths)),
      25,
      files(paths),
      { chips: paths.slice(0, 1).map(fileChip) },
    );
  return act('explore', say('read', files(paths)), 25, files(paths), {
    chips: paths.slice(0, 3).map(fileChip),
  });
}

function sed(program: string, input: string[]): Act | undefined {
  // BSD's `sed -i ''`: the empty word is -i's suffix, not the script.
  const args = input.filter((a) => a !== '');
  const inPlace = args.some(
    (a) => (/^-[a-zA-Z]*i/.test(a) && !a.startsWith('--')) || a.startsWith('--in-place'),
  );
  if (program === 'perl') {
    const code = valueOf(args, '-e', '-E');
    const pos = positional(args, ['-e', '-E', '-I', '-M']);
    if (!inPlace && code === undefined && pos[0])
      return act('run', say('run', baseName(pos[0])), 50, baseName(pos[0]));
    if (!inPlace)
      return pos.length ? act('explore', say('read', files(pos)), 25, files(pos)) : undefined;
    return editAct(pos);
  }
  const script = valueOf(args, '-e', '--expression');
  const pos = positional(args, ['-e', '--expression', '-f', '--file', '-l']).filter(
    (p) => !/^\.\w+$/.test(p) || p.length > 5,
  );
  const paths = script !== undefined ? pos : pos.slice(1);
  if (inPlace) return editAct(paths);
  return paths.length
    ? act('explore', say('read', files(paths)), 25, files(paths), {
        chips: paths.slice(0, 1).map(fileChip),
      })
    : undefined;
}

function editAct(paths: string[]): Act {
  const what = files(paths);
  return act('edit', say('edit', what), 55, what, {
    effects: paths.slice(0, 10).map((p) => ({
      kind: 'file' as const,
      text: `Changed ${baseName(p)}`,
      target: p.slice(0, 300),
    })),
    chips: paths.slice(0, 3).map(fileChip),
  });
}

function fetcher(program: string, args: string[]): Act {
  const valued = [
    '-X',
    '--request',
    '-H',
    '--header',
    '-d',
    '--data',
    '--data-raw',
    '--data-binary',
    '--data-urlencode',
    '-F',
    '--form',
    '-o',
    '--output',
    '-u',
    '--user',
    '-A',
    '--user-agent',
    '-e',
    '--referer',
    '-b',
    '--cookie',
    '-c',
    '--cookie-jar',
    '-m',
    '--max-time',
    '--connect-timeout',
    '-w',
    '--write-out',
    '-x',
    '--proxy',
    '-T',
    '--upload-file',
    '--json',
    '-O',
    '--output-document',
    '-P',
    '--retry',
    '-K',
    '--config',
    '-E',
    '--cert',
    '--key',
    '--cacert',
  ];
  const pos = positional(args, program === 'wget' ? valued : valued.filter((v) => v !== '-O'));
  const url =
    pos.find((p) =>
      /^(?:https?:)?\/\/|^[\w.-]+\.[a-z]{2,}(?:[:/]|$)|^localhost\b|^127\.0\.0\.1\b/i.test(p),
    ) ??
    pos[0] ??
    '';
  const host = hostOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `//${url}`);
  const method = (
    valueOf(args, '-X', '--request') ??
    (has(args, '-d', '--data', '--data-raw', '--data-binary', '-F', '--form', '--json', '-T')
      ? 'POST'
      : 'GET')
  ).toUpperCase();
  const output =
    program === 'wget'
      ? valueOf(args, '-O', '--output-document')
      : (valueOf(args, '-o', '--output') ??
        (has(args, '-O', '--remote-name') ? baseName(url.split('?')[0] ?? url) : undefined));
  const where = host ?? 'a site';
  const read: ReadKind = 'http';
  const chips = host && !isLocal(host) && /^https?:/i.test(url) ? [siteChip(url, host)] : undefined;
  if (output && output !== '-' && output !== '/dev/null')
    return act('research', say('download', baseName(output)), 45, baseName(output), {
      effects: [
        { kind: 'file', text: `Downloaded ${baseName(output)}`, target: output.slice(0, 300) },
      ],
      ...(chips && { chips }),
    });
  if (host && isLocal(host)) return act('verify', say('check', host), 40, host, { read });
  if (method !== 'GET' && method !== 'HEAD')
    return act('run', say('send', `a request to ${where}`), 45, where, {
      read,
      ...(chips && { chips }),
    });
  return act('research', say('fetch', where), 40, where, { read, ...(chips && { chips }) });
}

function copier(program: string, args: string[]): Act {
  const pos = positional(args, [
    '-t',
    '--target-directory',
    '-S',
    '--suffix',
    '-e',
    '--exclude',
    '-P',
    '-i',
    '-o',
    '-F',
    '--include',
    '--rsh',
    '--port',
  ]);
  const dest = pos.at(-1) ?? '';
  const sources = pos.slice(0, -1);
  const remote = (p: string) => /^[\w.-]+@?[\w.-]*:/.test(p) && !/^[A-Za-z]:\\/.test(p);
  if (program === 'scp' || program === 'rsync') {
    const to = remote(dest) ? dest.split(':')[0]?.replace(/^.*@/, '') : undefined;
    const from = sources.find(remote)?.split(':')[0]?.replace(/^.*@/, '');
    if (to) return act('run', say('copy', `files to ${clip(to, 40)}`), 50, clip(to, 40));
    if (from) return act('run', say('copy', `files from ${clip(from, 40)}`), 50, clip(from, 40));
  }
  const what = sources.length ? files(sources) : 'files';
  const destName =
    dest.endsWith('/') || !/\.\w{1,6}$/.test(dest) ? folderName(dest) : baseName(dest);
  if (program === 'mv') {
    const sameFolder =
      sources.length === 1 &&
      dirOf(sources[0] ?? '') === dirOf(dest) &&
      /\.\w{1,6}$|^[^/]+$/.test(dest);
    const said = sameFolder
      ? say('rename', `${what} to ${baseName(dest)}`)
      : say('move', `${what} to ${destName}`);
    return act('edit', said, 50, what, {
      effects: [{ kind: 'file', text: said.done, target: dest.slice(0, 300) }],
    });
  }
  const said = say('copy', `${what} to ${destName}`);
  return act('edit', said, 45, what, {
    effects: [{ kind: 'file', text: said.done, target: dest.slice(0, 300) }],
  });
}

function dirOf(path: string): string {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/');
  return cut < 0 ? '.' : path.slice(0, cut);
}

function archive(program: string, args: string[]): Act {
  const flags = args.filter((a) => a.startsWith('-') || /^[cxtzvfjJ]+$/.test(a)).join('');
  const file =
    positional(args, ['-C', '--directory', '-d', '-x', '-o']).find((p) =>
      /\.(?:tar|tgz|gz|zip|xz|bz2|7z|zst|tbz2?)$/i.test(p),
    ) ??
    valueOf(args, '-f') ??
    positional(args)[0];
  const name = file ? baseName(file) : 'an archive';
  const unpacking =
    ['unzip', 'gunzip', 'unxz'].includes(program) ||
    (program === 'tar' && /x/.test(flags)) ||
    has(args, '-d', '--decompress') ||
    (program === '7z' && args[0] === 'x');
  if (program === 'tar' && /t/.test(flags))
    return act('explore', say('look', `inside ${name}`), 25, name);
  if (unpacking) return act('edit', say('unpack', name), 45, name);
  return act('make', say('pack', `files into ${name}`), 45, name, {
    ...(file && {
      effects: [{ kind: 'file' as const, text: `Made ${name}`, target: file.slice(0, 300) }],
    }),
  });
}

function docker(program: string, input: string[]): Act {
  const args = program === 'docker-compose' ? ['compose', ...input] : input;
  const pos = positional(args, [
    '-f',
    '--file',
    '-p',
    '--project-name',
    '-t',
    '--tag',
    '-e',
    '--env',
    '-v',
    '--volume',
    '-p',
    '--publish',
    '--name',
    '-w',
    '--workdir',
    '--network',
    '--platform',
    '--build-arg',
    '--target',
    '-u',
    '--user',
    '--entrypoint',
    '--context',
    '-H',
  ]);
  const [sub = '', next = ''] = pos;
  if (sub === 'compose') {
    if (next === 'up' || next === 'start')
      return act('run', say('start', 'the services'), 55, 'the services');
    if (next === 'down' || next === 'stop')
      return act('run', say('stop', 'the services'), 50, 'the services');
    if (next === 'build') return kindAct('build', 'build');
    if (next === 'logs')
      return act('explore', say('read', 'the service logs'), 30, 'the service logs');
    if (next === 'ps') return act('explore', say('check', 'the services'), 20, 'the services');
    if (next === 'exec' || next === 'run')
      return act('run', say('run', 'a command in a container'), 45, 'a container');
    if (next === 'restart') return act('run', say('restart', 'the services'), 50, 'the services');
    if (next === 'pull') return act('run', say('pull', 'the images'), 50, 'the images');
    return act('run', say('run', `compose ${clip(next, 20)}`.trim()), 40, 'the services');
  }
  const name = (n: string) => clip(n.replace(/^.*\//, ''), 30);
  if (
    sub === 'build' ||
    (sub === 'image' && next === 'build') ||
    (sub === 'buildx' && next === 'build')
  )
    return act('verify', say('build', 'the image'), 70, 'the image build', { read: 'build' });
  if (sub === 'run' || sub === 'create')
    return act('run', say('start', 'a container'), 50, 'a container');
  if (sub === 'exec') return act('run', say('run', 'a command in a container'), 45, 'a container');
  if (
    sub === 'ps' ||
    sub === 'images' ||
    sub === 'inspect' ||
    sub === 'stats' ||
    sub === 'info' ||
    sub === 'version'
  )
    return act(
      'explore',
      say('check', sub === 'images' ? 'the images' : 'the containers'),
      20,
      'the containers',
    );
  if (sub === 'logs')
    return act('explore', say('read', 'the container logs'), 30, 'the container logs');
  if (sub === 'stop' || sub === 'kill')
    return act('run', say('stop', 'a container'), 45, 'a container');
  if (sub === 'start' || sub === 'restart')
    return act('run', say(sub, 'a container'), 45, 'a container');
  if (sub === 'rm' || sub === 'rmi' || sub === 'prune' || next === 'prune')
    return act('run', say('remove', sub === 'rmi' ? 'an image' : 'containers'), 50, 'containers', {
      effects: [
        { kind: 'delete', text: sub === 'rmi' ? 'Removed an image' : 'Removed containers' },
      ],
    });
  if (sub === 'pull')
    return act('run', say('pull', next ? name(next) : 'an image'), 50, 'the image');
  if (sub === 'push') {
    const what = next ? name(next) : 'the image';
    return act('ship', say('push', what), 88, what, {
      effects: [{ kind: 'publish', text: `Pushed ${what}` }],
    });
  }
  if (sub === 'login') return act('run', say('sign', 'in to the registry'), 30, 'the registry');
  return act('run', say('run', `${program} ${clip(sub, 20)}`.trim()), 40, program);
}

function kube(program: string, args: string[]): Act {
  const pos = positional(args, [
    '-n',
    '--namespace',
    '-f',
    '--filename',
    '-l',
    '--selector',
    '-o',
    '--output',
    '--context',
    '-c',
    '--container',
    '--values',
    '--set',
  ]);
  const [sub = '', kind = ''] = pos;
  if (program === 'helm') {
    if (sub === 'install' || sub === 'upgrade')
      return act('ship', say('deploy', clip(kind || 'the chart', 30)), 90, 'the deploy', {
        effects: [{ kind: 'publish', text: `Deployed ${clip(kind || 'the chart', 30)}` }],
      });
    if (sub === 'uninstall' || sub === 'delete')
      return act('ship', say('remove', clip(kind || 'the chart', 30)), 80, 'the chart', {
        effects: [{ kind: 'delete', text: `Removed ${clip(kind || 'the chart', 30)}` }],
      });
    return act('explore', say('look', 'at the charts'), 25, 'the charts');
  }
  if (
    ['get', 'describe', 'top', 'explain', 'api-resources', 'version', 'cluster-info'].includes(sub)
  )
    return act('explore', say('look', `at the ${clip(kind || 'cluster', 30)}`), 25, 'the cluster');
  if (sub === 'logs') return act('explore', say('read', 'the logs'), 30, 'the logs');
  if (
    sub === 'apply' ||
    sub === 'create' ||
    sub === 'replace' ||
    sub === 'patch' ||
    sub === 'set' ||
    sub === 'scale' ||
    sub === 'rollout'
  )
    return act('ship', say('change', 'the cluster'), 85, 'the cluster', {
      effects: [{ kind: 'other', text: 'Changed the cluster' }],
    });
  if (sub === 'delete')
    return act(
      'ship',
      say('delete', clip(kind || 'something', 30) + ' in the cluster'),
      85,
      'the cluster',
      {
        effects: [
          { kind: 'delete', text: `Deleted ${clip(kind || 'something', 30)} in the cluster` },
        ],
      },
    );
  if (sub === 'exec' || sub === 'run')
    return act('run', say('run', 'a command in the cluster'), 45, 'the cluster');
  if (sub === 'port-forward')
    return act('run', say('open', 'a port to the cluster'), 40, 'the cluster');
  return act('run', say('run', `${program} ${clip(sub, 20)}`.trim()), 40, program);
}

function infra(program: string, args: string[]): Act {
  const sub =
    positional(args, [
      '-var',
      '-var-file',
      '-target',
      '--stack',
      '-s',
      '--profile',
      '--region',
    ])[0] ?? '';
  if (
    sub === 'plan' ||
    sub === 'preview' ||
    sub === 'diff' ||
    sub === 'synth' ||
    sub === 'validate'
  )
    return act('verify', say('check', 'the planned changes'), 60, 'the plan');
  if (sub === 'apply' || sub === 'up' || sub === 'deploy') {
    const said = say('deploy', 'the infrastructure');
    return act('ship', said, 93, 'the deploy', { effects: [{ kind: 'publish', text: said.done }] });
  }
  if (sub === 'destroy' || sub === 'remove')
    return act('ship', say('tear', 'down the infrastructure'), 93, 'the infrastructure', {
      effects: [{ kind: 'delete', text: 'Tore down the infrastructure' }],
    });
  if (sub === 'init') return act('run', say('set', 'up the tools'), 40, 'the tools');
  if (sub === 'fmt') return kindAct('format', 'fmt');
  return act('run', say('run', `${program} ${clip(sub, 20)}`.trim()), 40, program);
}

// ---------------------------------------------------------------- the whole command

const TRIVIAL = 10;
const VERIFY_READS = new Set<ReadKind>(['tests', 'types', 'lint', 'format', 'build', 'checks']);

/** A whole command line, said by its part that matters most, with what every part changed. */
export function describeCommand(command: string, depth = 0): Act {
  const fallback = act('run', say('run', 'a command'), 0, 'the command');
  if (typeof command !== 'string' || !command.trim()) return fallback;
  let source = command.slice(0, MAX_BODY);
  // `bash -lc '…'` the way Codex sends commands: the inside is the command.
  const wrapped = /^\s*(?:\/\S*\/)?(?:ba|z|da|k)?sh\s+-[a-z]*c[a-z]*\s+(['"])([\s\S]*)\1\s*$/.exec(
    source,
  );
  if (wrapped?.[2] !== undefined && depth < 3) source = wrapped[2].replace(/'\\''/g, "'");
  const { text, bodies } = heredocs(source);
  const segments = split(text.slice(0, MAX_COMMAND));
  for (const seg of segments) {
    const hole = seg.words.find((w) => w.startsWith(HOLE) && w.endsWith(HOLE));
    if (hole) seg.heredoc = bodies[Number(hole.slice(1, -1))];
  }
  const acts: Act[] = [];
  let before: Segment | undefined;
  let pipeHead = true;
  for (const seg of segments) {
    const piped = seg.op === '|';
    // The first program of a pipeline that isn't only feeding it ("echo x | python3").
    const feeding =
      before &&
      piped &&
      before.words.length > 0 &&
      FEEDERS.has(programName(unwrap(before.words)[0] ?? ''));
    const ctx: Context = {
      depth,
      piped: piped && !(pipeHead && feeding) && !(before?.heredoc && piped),
      ...(piped && before?.heredoc !== undefined && { stdin: before.heredoc }),
      bodies,
    };
    const described = describeSegment(seg, ctx);
    if (described) acts.push(described);
    pipeHead = !piped ? true : pipeHead && !!feeding;
    before = seg;
  }
  if (!acts.length) return fallback;

  let primary = acts.reduce((best, a) => (a.rank > best.rank ? a : best));
  const commit = acts.find((a) => a.commit && !a.commit.amend);
  const push = acts.find((a) => a.push);
  const verifies = new Set(
    acts
      .filter((a) => a.family === 'verify' && a.read && VERIFY_READS.has(a.read))
      .map((a) => a.read),
  );
  if (commit && push) {
    const where = push.push?.branch ? ` to ${clip(push.push.branch, 50)}` : '';
    primary = {
      ...push,
      words: words(
        `Committing and pushing${where}`,
        `Committed and pushed${where}`,
        `Couldn’t commit and push${where}`,
      ),
      read: 'commit-push',
      ...(commit.commit && { commit: commit.commit }),
    };
  } else if (verifies.size >= 2 && primary.family === 'verify') {
    primary = { ...primary, words: say('run', 'the checks'), noun: 'the checks', read: 'checks' };
  } else if (primary.rank < TRIVIAL && acts.length > 1) {
    primary = acts.find((a) => a.rank >= TRIVIAL) ?? primary;
  }
  const effects = dedupe(
    acts.flatMap((a) => a.effects ?? []),
    (e) => `${e.kind}:${e.text}`,
  ).slice(0, 20);
  const chips = dedupe(
    acts.flatMap((a) => a.chips ?? []),
    (c) => `${c.kind}:${c.href ?? c.label}`,
  ).slice(0, 12);
  return {
    ...primary,
    ...(effects.length ? { effects } : { effects: undefined }),
    ...(chips.length ? { chips } : { chips: undefined }),
  };
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The command as a subject: its first line, short. */
export function commandSubject(command: string): string {
  const firstLine = command.split('\n').find((l) => l.trim()) ?? command;
  return clip(oneLine(firstLine), 160);
}
