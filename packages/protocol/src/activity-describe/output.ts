/**
 * What a call's output says (ADR 0103): how many tests passed, how many type
 * errors, where a push went, what a search found, and the line that says why
 * it failed. Scans a bounded window of the text, line by line, so a 20,000
 * line log costs no more than a short one.
 */
import { clip, count, oneLine, plural } from './words';

/** How to read a call's output. */
export type ReadKind =
  | 'tests'
  | 'types'
  | 'lint'
  | 'format'
  | 'build'
  | 'checks'
  | 'push'
  | 'commit'
  | 'commit-push'
  | 'status'
  | 'diff'
  | 'log'
  | 'pull'
  | 'matches'
  | 'files'
  | 'entries'
  | 'install'
  | 'http'
  | 'none';

export interface Reading {
  outcome?: string;
  /** It went wrong, whatever its status says (tests that failed). */
  failed?: boolean;
  /** It's not a failure, whatever its status says (grep finding nothing). */
  fine?: boolean;
  /** Nothing happened, so nothing changed: "nothing to commit", "up to date". */
  nothing?: boolean;
  branch?: string;
  message?: string;
}

/** The most of an output the rules look at: its start and its end. */
const HEAD = 6_000;
const TAIL = 16_000;
const MAX_LINES = 1_500;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]{0,400}(?:\u0007|\u001b\\)/g;

/** The output as plain text: no colours, no carriage returns, its middle left out when long. */
export function plain(output: string): string {
  const text =
    output.length > HEAD + TAIL ? `${output.slice(0, HEAD)}\n${output.slice(-TAIL)}` : output;
  return text.replace(ANSI, '').replace(/\r\n?/g, '\n');
}

function lines(text: string): string[] {
  const all = text.split('\n');
  const kept =
    all.length > MAX_LINES
      ? [...all.slice(0, MAX_LINES / 3), ...all.slice(-(MAX_LINES * 2) / 3)]
      : all;
  return kept.map((line) => (line.length > 1_000 ? line.slice(0, 1_000) : line));
}

export interface TestCount {
  passed: number;
  failed: number;
  skipped: number;
  /** "package" for go test, else a test. */
  unit?: 'package';
}

function tally(line: string, into: TestCount): boolean {
  let found = false;
  for (const m of line.matchAll(
    /(\d[\d,]*)\s+(passed|passing|pass|failed|failing|fail|errors?|skipped|todo|pending|flaky)\b/gi,
  )) {
    const n = Number((m[1] ?? '0').replace(/,/g, ''));
    const word = (m[2] ?? '').toLowerCase();
    found = true;
    if (word.startsWith('pass')) into.passed += n;
    else if (word.startsWith('fail') || word.startsWith('error')) into.failed += n;
    else into.skipped += n;
  }
  return found;
}

/** A test run's summary, from any of the usual runners, or undefined when there isn't one. */
export function testSummary(text: string): TestCount | undefined {
  const all = lines(text);
  const tail = all.slice(-400);
  // Vitest ("Tests  241 passed (241)") and Jest ("Tests: 1 failed, 5 passed, 6 total"): the last one counts.
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = (tail[i] ?? '').trim();
    if (/^Tests:?\s/.test(line)) {
      const sum: TestCount = { passed: 0, failed: 0, skipped: 0 };
      if (tally(line, sum)) return sum;
    }
  }
  // Cargo: one "test result:" per crate, summed.
  const cargo: TestCount = { passed: 0, failed: 0, skipped: 0 };
  let crates = 0;
  for (const raw of tail) {
    const m = /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed(?:; (\d+) ignored)?/.exec(
      raw.trim(),
    );
    if (!m) continue;
    crates++;
    cargo.passed += Number(m[1]);
    cargo.failed += Number(m[2]);
    cargo.skipped += Number(m[3] ?? 0);
  }
  if (crates) return cargo;
  // Pytest: "==== 5 passed, 1 failed in 0.12s ====" or -q's "5 passed in 0.12s".
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = (tail[i] ?? '').trim();
    if (/^=*\s*no tests ran\b/.test(line)) return { passed: 0, failed: 0, skipped: 0 };
    if (/\b(?:passed|failed|errors?)\b.*\bin [\d.]+s\b/.test(line)) {
      const sum: TestCount = { passed: 0, failed: 0, skipped: 0 };
      if (tally(line, sum)) return sum;
    }
  }
  // unittest: "Ran 5 tests in 0.1s" then "OK" or "FAILED (failures=1, errors=1)".
  for (let i = tail.length - 1; i >= 0; i--) {
    const m = /^Ran (\d+) tests? in /.exec((tail[i] ?? '').trim());
    if (!m) continue;
    const total = Number(m[1]);
    const verdict = tail.slice(i + 1, i + 4).join(' ');
    const bad = /FAILED \(([^)]*)\)/.exec(verdict)?.[1] ?? '';
    const failed = [...bad.matchAll(/(?:failures|errors)=(\d+)/g)].reduce(
      (n, f) => n + Number(f[1]),
      0,
    );
    const skipped = Number(/skipped=(\d+)/.exec(verdict)?.[1] ?? 0);
    return { passed: Math.max(0, total - failed - skipped), failed, skipped };
  }
  // Mocha, Bun, Playwright, Deno: count lines on their own ("5 passing", " 1 fail", "3 passed (2.1s)").
  const own: TestCount = { passed: 0, failed: 0, skipped: 0 };
  let ownFound = false;
  for (const raw of tail) {
    const line = raw.trim();
    if (
      /^\d[\d,]*\s+(?:passing|failing|pending|pass|fail|passed|failed|flaky|skipped)\b(?:\s*\([^)]*\))?$/.test(
        line,
      ) ||
      /^ok \| \d+ passed \| \d+ failed/.test(line)
    )
      ownFound = tally(line, own) || ownFound;
  }
  if (ownFound) return own;
  // Go: one "ok" or "FAIL" line per package.
  let ok = 0;
  let fail = 0;
  for (const raw of tail) {
    if (/^ok\s+\S+\s/.test(raw)) ok++;
    else if (/^FAIL\s+\S+\s/.test(raw)) fail++;
  }
  if (ok || fail) return { passed: ok, failed: fail, skipped: 0, unit: 'package' };
  return undefined;
}

function testOutcome(sum: TestCount): Reading {
  const unit = sum.unit === 'package' ? 'package' : undefined;
  if (sum.failed > 0)
    return {
      outcome: unit ? `${plural(sum.failed, unit)} failed` : `${count(sum.failed)} failed`,
      failed: true,
    };
  if (sum.passed === 0) return { outcome: 'No tests ran', failed: sum.skipped === 0 };
  return { outcome: unit ? `${plural(sum.passed, unit)} passed` : `${count(sum.passed)} passed` };
}

function typeErrors(text: string, ok: boolean): Reading | undefined {
  const found = /Found (\d[\d,]*) errors?\b/.exec(text);
  if (found?.[1]) {
    const n = Number(found[1].replace(/,/g, ''));
    return n ? { outcome: plural(n, 'type error'), failed: true } : { outcome: 'No type errors' };
  }
  const pyright = /(\d+) errors?, \d+ warnings?, \d+ (?:informations|notes)/.exec(text);
  if (pyright?.[1]) {
    const n = Number(pyright[1]);
    return n ? { outcome: plural(n, 'type error'), failed: true } : { outcome: 'No type errors' };
  }
  if (/Success: no issues found/.test(text)) return { outcome: 'No type errors' };
  let n = 0;
  for (const line of lines(text)) if (/\berror TS\d+:/.test(line)) n++;
  if (n) return { outcome: plural(n, 'type error'), failed: true };
  return ok ? { outcome: 'No type errors' } : undefined;
}

function lintProblems(text: string, ok: boolean): Reading | undefined {
  const eslint = /(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/.exec(text);
  if (eslint) {
    const errors = Number(eslint[2]);
    const warnings = Number(eslint[3]);
    if (errors) return { outcome: plural(errors, 'problem'), failed: true };
    return { outcome: plural(warnings, 'warning') };
  }
  const ruff = /Found (\d+) errors?\b/.exec(text);
  if (ruff?.[1])
    return Number(ruff[1])
      ? { outcome: plural(Number(ruff[1]), 'problem'), failed: true }
      : { outcome: 'No problems' };
  if (/All checks passed!/.test(text)) return { outcome: 'No problems' };
  return ok ? { outcome: 'No problems' } : undefined;
}

function formatting(text: string): Reading | undefined {
  const issues = /Code style issues found in (?:(\d+) files|the above file)/.exec(text);
  if (issues)
    return {
      outcome: issues[1] ? `${plural(Number(issues[1]), 'file')} to format` : '1 file to format',
      failed: true,
    };
  if (/All matched files use Prettier code style/.test(text)) return { outcome: 'All formatted' };
  const black = /(\d+) files? (?:would be )?reformatted/.exec(text);
  if (black?.[1]) return { outcome: `${plural(Number(black[1]), 'file')} formatted` };
  if (/left unchanged|already formatted/.test(text)) return { outcome: 'All formatted' };
  return undefined;
}

const branchOf = (ref: string) => ref.replace(/^refs\/heads\//, '').replace(/^\+/, '');

function pushReading(text: string): Reading {
  if (/\[rejected\]|failed to push/.test(text))
    return {
      outcome: /fetch first|non-fast-forward/.test(text)
        ? 'The remote has newer commits'
        : 'Rejected',
      failed: true,
    };
  if (/Everything up-to-date/.test(text)) return { outcome: 'Already up to date', nothing: true };
  const moved =
    /^[ \t]*(?:[+*-][ \t]+)?(?:\[new branch\][ \t]+|[0-9a-f]+\.\.\.?[0-9a-f]+[ \t]+)?(\S+)[ \t]+->[ \t]+(\S+)/m.exec(
      text,
    );
  return moved?.[2] ? { branch: branchOf(moved[2]) } : {};
}

function commitReading(text: string): Reading {
  if (/nothing to commit|no changes added to commit|nothing added to commit/.test(text))
    return { outcome: 'Nothing to commit', nothing: true, fine: true };
  const head = /^\[([^\]\s]+)(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/m.exec(text);
  const files = /(\d+) files? changed/.exec(text);
  return {
    ...(head?.[1] && { branch: head[1] }),
    ...(head?.[3] && { message: head[3].trim() }),
    ...(files?.[1] && { outcome: `${plural(Number(files[1]), 'file')} changed` }),
  };
}

/** The line that says why it failed, cut short, or undefined when there's none worth saying. */
export function failureLine(output: string): string | undefined {
  const text = plain(output).replace(/<\/?[a-z_]+>/g, '\n');
  const all = lines(text)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^(?:Exit code:? -?\d+|exit status \d+|Command exited with code \d+|\$ .*|>.*|\^+|~+|at .+:\d+:\d+\)?|File ".*", line \d+.*)$/i.test(
          line,
        ),
    );
  if (!all.length) return undefined;
  let line: string | undefined;
  if (/Traceback \(most recent call last\)/.test(text)) line = all.at(-1);
  line ??= all.find((l) =>
    /\b(?:error|fatal|failed|failure|exception|not found|no such file|denied|refused|cannot|can't|couldn't|unable|invalid|missing|timed? ?out|ERR!)\b/i.test(
      l,
    ),
  );
  line ??= all[0];
  if (!line) return undefined;
  const cleaned = oneLine(line)
    .replace(
      /^(?:npm ERR!|ERR_PNPM_\w+|error(?:\[\w+\])?|fatal|ERROR|Error|FAIL|×|✖|✗|⨯)[:!]?\s*/i,
      '',
    )
    .replace(/^[-–•*>]\s*/, '');
  return cleaned ? clip(cleaned, 72) : undefined;
}

/** The exit code a shell reported, when it did. */
export function exitCode(output: string): number | undefined {
  const m = /(?:^|\n)\s*(?:Exit code:?|exit status|Command exited with code)\s*(-?\d+)/i.exec(
    output.slice(0, 400),
  );
  return m?.[1] ? Number(m[1]) : undefined;
}

/** Whether the person said no, or stopped it: not a failure of the work. */
export function refused(output: string): 'declined' | 'stopped' | undefined {
  const head = output.slice(0, 600);
  if (
    /wasn[’']t allowed|was not allowed|user (?:declined|denied|rejected)|doesn[’']t want to proceed|permission to use .* (?:was|has been) denied|Not run:/i.test(
      head,
    )
  )
    return 'declined';
  if (/user stopped|interrupted by (?:the )?user|\[Request interrupted/i.test(head))
    return 'stopped';
  return undefined;
}

function countLines(output: string, skip: RegExp): number {
  let n = 0;
  for (const line of lines(plain(output))) if (line.trim() && !skip.test(line.trim())) n++;
  return n;
}

/** What an output says, read the way its kind is written. */
export function readOutput(kind: ReadKind | undefined, output: string, ok: boolean): Reading {
  if (!kind || kind === 'none') return {};
  const text = plain(output);
  const empty = !text.trim();
  switch (kind) {
    case 'tests': {
      const sum = testSummary(text);
      return sum ? testOutcome(sum) : {};
    }
    case 'types':
      return typeErrors(text, ok) ?? {};
    case 'lint':
      return lintProblems(text, ok) ?? {};
    case 'format':
      return formatting(text) ?? {};
    case 'checks': {
      const sum = testSummary(text);
      if (sum?.failed) return testOutcome(sum);
      const types = typeErrors(text, false);
      if (types?.failed) return types;
      const lint = lintProblems(text, false);
      if (lint?.failed) return lint;
      if (sum) return testOutcome(sum);
      return ok ? { outcome: 'All passed' } : {};
    }
    case 'build':
      return {};
    case 'push':
      return pushReading(text);
    case 'commit':
      return commitReading(text);
    case 'commit-push': {
      const commit = commitReading(text);
      const push = pushReading(text);
      return {
        ...commit,
        ...push,
        ...(commit.nothing && push.nothing && { nothing: true }),
        ...(!commit.nothing && !push.nothing && { nothing: false }),
      };
    }
    case 'status': {
      if (/working tree clean|nothing to commit/.test(text) || (ok && empty))
        return { outcome: 'No changes' };
      if (/^On branch|^Changes |^Untracked files/m.test(text)) {
        let n = 0;
        for (const line of lines(text)) if (/^\t\S/.test(line)) n++;
        return n ? { outcome: `${plural(n, 'changed file')}` } : {};
      }
      const n = countLines(text, /^##/);
      return n ? { outcome: plural(n, 'changed file') } : {};
    }
    case 'diff': {
      const stat = /(\d+) files? changed/.exec(text);
      if (stat?.[1]) return { outcome: `${plural(Number(stat[1]), 'file')} changed` };
      let files = 0;
      for (const line of lines(text)) if (line.startsWith('diff --git ')) files++;
      if (files) return { outcome: `${plural(files, 'file')} changed` };
      return ok && empty ? { outcome: 'No changes' } : {};
    }
    case 'log': {
      let n = 0;
      for (const line of lines(text))
        if (/^(?:commit [0-9a-f]{40}|[*|\\/ ]*[0-9a-f]{7,40}\s)/.test(line)) n++;
      return n ? { outcome: plural(n, 'commit') } : {};
    }
    case 'pull': {
      if (/Already up[ -]to[ -]date/.test(text))
        return { outcome: 'Already up to date', nothing: true };
      const stat = /(\d+) files? changed/.exec(text);
      return stat?.[1] ? { outcome: `${plural(Number(stat[1]), 'file')} changed` } : {};
    }
    case 'matches': {
      if (empty || /^(?:No (?:matches|files) found|No files matched)/m.test(text.slice(0, 200)))
        return { outcome: 'No matches', fine: true };
      const files = /^Found (\d+) (files?|lines?|matches?)/m.exec(text.slice(0, 200));
      if (files?.[1]) {
        const n = Number(files[1]);
        return {
          outcome: (files[2] ?? '').startsWith('file')
            ? plural(n, 'file')
            : plural(n, 'match', 'matches'),
        };
      }
      let sum = 0;
      let counted = true;
      const all = lines(text).filter((l) => l.trim());
      for (const line of all.slice(0, 400)) {
        const m = /(?:^|:)(\d+)$/.exec(line.trim());
        if (!m) {
          counted = false;
          break;
        }
        sum += Number(m[1]);
      }
      if (counted && all.length && all.length <= 400)
        return { outcome: plural(sum, 'match', 'matches') };
      const n = countLines(output, /^(?:--|Found \d+|\[.*truncated.*\])$/);
      return { outcome: plural(n, 'match', 'matches') };
    }
    case 'files': {
      if (empty || /^(?:No files found|No matches found)/m.test(text.slice(0, 200)))
        return { outcome: 'No files', fine: true };
      const found = /^Found (\d+) files?/m.exec(text.slice(0, 200));
      if (found?.[1]) return { outcome: plural(Number(found[1]), 'file') };
      return {
        outcome: plural(
          countLines(output, /^(?:\(Results are truncated.*|Found \d+ files?)$/),
          'file',
        ),
      };
    }
    case 'entries': {
      if (empty) return { outcome: 'Empty' };
      const all = lines(text).filter(
        (l) => l.trim() && !/^(?:total \d+|NOTE:|There are more than)/.test(l.trim()),
      );
      // Claude Code's LS: "- /path/" then indented "- name" lines.
      const tree = all[0]?.trim().startsWith('- /') ? all.slice(1) : all;
      return { outcome: plural(tree.length, 'item') };
    }
    case 'install': {
      const added = /added (\d+) packages?/.exec(text) ?? /Packages: \+(\d+)/.exec(text);
      if (added?.[1]) return { outcome: `${plural(Number(added[1]), 'package')} added` };
      const pip = /Successfully installed (.+)$/m.exec(text);
      if (pip?.[1])
        return { outcome: `${plural(pip[1].trim().split(/\s+/).length, 'package')} added` };
      if (
        /(?:up to date|Already up[ -]to[ -]date|already installed|Requirement already satisfied)/i.test(
          text,
        )
      )
        return { outcome: 'Already up to date', nothing: true };
      return {};
    }
    case 'http': {
      const status = /^HTTP\/[\d.]+ (\d{3})/m.exec(text.slice(0, 2000));
      return status?.[1] ? { outcome: `Status ${status[1]}` } : {};
    }
    default:
      return {};
  }
}
