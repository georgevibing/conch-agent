#!/usr/bin/env node
/**
 * Checks commit subjects against Conventional Commits 1.0, with Conch's types.
 * The subjects become the next version and the release notes, so a pull
 * request checks its commits and its title (a squash merge makes the title a
 * commit). No dependencies: it runs before `pnpm install`.
 *
 *   node scripts/commits.mjs                       # origin/main..HEAD
 *   node scripts/commits.mjs origin/main..HEAD --title "feat(web): …"
 *
 * Merge commits, `Revert "…"` and fixup!/squash!/amend! commits are skipped:
 * git writes those subjects itself, or they disappear before the merge.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'chore',
  'build',
  'ci',
  'style',
  'revert',
];

const EXAMPLE = '"fix: …" or "feat(web): …"';
const HEADER = /^(?<type>[^\s():!]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?:(?<rest>.*)$/;
const SCOPE = /^[a-z0-9][a-z0-9._/-]*(?:, ?[a-z0-9][a-z0-9._/-]*)*$/;

/** Subjects git writes by itself, or that are squashed away before merging. */
export function skipped(subject) {
  return (
    /^Merge (branch|branches|remote-tracking branch|pull request|tag|commit) /.test(subject) ||
    /^Revert ".*"$/.test(subject) ||
    /^(fixup|squash|amend)! /.test(subject)
  );
}

/**
 * What's wrong with one subject, in a few plain words, or `null` when it's fine.
 * @param {string} subject
 */
export function problem(subject) {
  if (!subject.trim()) return 'the subject is empty';
  const header = HEADER.exec(subject);
  if (!header?.groups) return `start with a type and a colon, like ${EXAMPLE}`;
  const { type = '', scope, rest = '' } = header.groups;
  if (!TYPES.includes(type)) {
    if (TYPES.includes(type.toLowerCase()))
      return `write the type in lowercase: "${type.toLowerCase()}"`;
    return `"${type}" isn't one of the types: ${TYPES.join(', ')}`;
  }
  if (scope !== undefined) {
    if (!scope.trim())
      return `the scope is empty: name a part of Conch, like (web), or leave out the parentheses`;
    if (!SCOPE.test(scope)) return `write the scope in lowercase, like (server) or (server,web)`;
  }
  if (!rest.startsWith(' ')) return 'put a space after the colon';
  if (!rest.trim()) return 'say what changed after the colon';
  if (rest.startsWith('  ')) return 'use one space after the colon';
  return null;
}

/**
 * The commits in a range, oldest first, without merge commits.
 * @param {string} range
 * @param {string} [cwd]
 */
export function commitsIn(range, cwd) {
  if (range.startsWith('-')) throw new Error(`That isn't a range of commits: ${range}`);
  const out = execFileSync(
    'git',
    ['log', '--no-merges', '--reverse', '--format=%h%x09%s', range, '--'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

/**
 * Checks the commits in `range` and, if given, a pull request's title.
 * @returns {{ lines: string[], failures: number }}
 */
export function check({ range, title, cwd }) {
  const lines = [];
  let commits = 0;
  let checked = 0;
  let skips = 0;
  for (const { hash, subject } of commitsIn(range, cwd)) {
    if (skipped(subject)) {
      skips++;
      continue;
    }
    checked++;
    const wrong = problem(subject);
    if (wrong) {
      commits++;
      lines.push(`${hash} "${subject}": ${wrong}.`);
    }
  }
  let failures = commits;
  if (title !== undefined) {
    // GitHub titles a revert pull request `Revert "…"`; anything else must be
    // a subject in its own right, since a squash merge makes it the commit.
    const wrong = /^Revert ".*"$/.test(title) ? null : problem(title);
    if (wrong) {
      failures++;
      lines.push(`The title "${title}": ${wrong}. Edit it, then re-run this check.`);
    }
  }
  const what =
    `${checked} commit ${checked === 1 ? 'subject' : 'subjects'}` +
    (title !== undefined ? ' and the title' : '') +
    (skips
      ? `, skipping ${skips} merge, revert or fixup ${skips === 1 ? 'commit' : 'commits'}`
      : '');
  if (failures) {
    lines.push(
      `${failures} ${failures === 1 ? 'subject needs' : 'subjects need'} a fix (checked ${what}). ` +
        `A subject looks like ${EXAMPLE}: it becomes the version and the release notes ` +
        `(CONTRIBUTING.md § Commits and pull requests).` +
        (commits ? ' Reword a commit with `git rebase -i`, then push again.' : ''),
    );
  } else {
    lines.push(`Checked ${what}: all follow Conventional Commits.`);
  }
  return { lines, failures };
}

function main(argv) {
  let range = 'origin/main..HEAD';
  let title;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--title') {
      title = argv[++i];
      if (title === undefined) throw new Error('--title needs the title.');
    } else if (arg.startsWith('--title=')) {
      title = arg.slice('--title='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      range = arg;
    }
  }
  const { lines, failures } = check({ range, title });
  for (const line of lines) (failures ? console.error : console.log)(line);
  return failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const stderr = /** @type {{ stderr?: string }} */ (error).stderr;
    console.error(String(stderr || (error instanceof Error ? error.message : error)).trim());
    process.exitCode = 2;
  }
}
