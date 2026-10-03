/**
 * `pnpm release`: one command and one question to make a release (ADR 0051).
 *
 *   pnpm release              a stable release (the version comes from the commits)
 *   pnpm release beta         a beta: v0.4.0-beta.1, then -beta.2…
 *   pnpm release alpha        an alpha
 *   --dry-run                 show everything, change nothing
 *   --version 0.4.0           this version, not the one worked out
 *   --no-ai                   the notes as written from the commits, without a model's polish
 *
 * It checks it can (on main, nothing uncommitted, level with origin), works
 * out the version and the notes, shows them with the commits they came from,
 * and asks once. Then: `pnpm check`, the version in package.json,
 * CHANGELOG.md, a `release: vX` commit, a signed annotated tag (git's own
 * signing; it offers to set up an SSH key you already have), a push of both,
 * and a GitHub Release when `gh` is here. Nothing is written until you say
 * yes, and nothing is pushed unless everything before it worked.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ReleaseChannel } from '@conch/protocol';

import { findExecutable, run as runProgram, type RunResult } from '../lib/proc';
import { gitIn, type Git } from '../updates/conch';
import { compareVersions } from '../updates/version';
import {
  addToChangelog,
  changelogSection,
  notesFrom,
  notesText,
  releaseBody,
  tagMessage,
  type Notes,
} from './notes';
import { polish, type PolishDeps } from './polish';
import { inChannel, nextVersion, parseRelease, releaseOfTag, tagOf, type Commit } from './semver';
import { keyOf, SIGNERS_FILE, signerKeys, signerLine, verifyTag } from './signing';

export interface ReleaseOptions {
  kind: ReleaseChannel;
  dryRun: boolean;
  version?: string;
  ai: boolean;
}

export function parseArgs(argv: string[]): ReleaseOptions | { help: true } | { error: string } {
  const options: ReleaseOptions = { kind: 'stable', dryRun: false, ai: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--') continue;
    if (arg === '-h' || arg === '--help' || arg === 'help') return { help: true };
    else if (arg === 'beta' || arg === 'alpha' || arg === 'stable') options.kind = arg;
    else if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg === '--no-ai') options.ai = false;
    else if (arg === '--version' || arg.startsWith('--version=')) {
      const value = arg.includes('=') ? arg.slice(10) : argv[++i];
      if (!value) return { error: '--version needs a version, like --version 0.4.0' };
      options.version = value.replace(/^v/, '');
    } else return { error: `Unknown option: ${arg} (try pnpm release --help)` };
  }
  return options;
}

export const HELP = `pnpm release [beta|alpha] [--dry-run] [--version x.y.z] [--no-ai]

  Makes a release of Conch: works out the version and the notes from the
  commits since the last release, shows them, and asks once. Then checks,
  commits, tags (signed), pushes and makes the GitHub Release.

  beta, alpha      a pre-release (v0.4.0-beta.1); plain pnpm release is stable
  --dry-run        show everything, change nothing
  --version x.y.z  use this version instead of the one worked out
  --no-ai          skip polishing the notes with Claude Code
`;

export interface ReleaseDeps {
  /** The repository's root. */
  root: string;
  /** Says a line. */
  say: (line: string) => void;
  /** Asks a question, answered with a line. */
  ask: (question: string) => Promise<string>;
  /** `pnpm check`, or what stands for it in a test. */
  check?: () => Promise<boolean>;
  git?: string;
  /** gh's path, if it's here. */
  gh?: () => Promise<string | undefined>;
  sshKeygen?: () => Promise<string | undefined>;
  /** Where `~/.ssh` is. */
  home?: string;
  polish?: PolishDeps;
  /** YYYY-MM-DD for the changelog. */
  today?: () => string;
}

const yes = (answer: string) => /^y(es)?$/i.test(answer.trim());

/** One line, to stop on: what's wrong and what to do. */
class Stop extends Error {}

async function must(git: Git, args: string[], what: string): Promise<RunResult> {
  const result = await git(args, { timeout: 120_000 });
  if (result.code !== 0)
    throw new Stop(
      `${what} didn’t work: ${(result.stderr || result.stdout).trim().split('\n')[0] ?? ''}`,
    );
  return result;
}

/** The commits in a range, newest first. */
async function commitsIn(git: Git, range: string): Promise<Commit[]> {
  const out = await must(
    git,
    ['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range],
    'Reading the commits',
  );
  return out.stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.split('\x1f');
      return { sha, subject, body };
    });
}

/** The public key git signs with, as text, when it's an SSH key. */
async function signingKey(
  git: Git,
  root: string,
): Promise<{ format: string; key?: string; pub?: string }> {
  const format = (await git(['config', 'gpg.format'])).stdout.trim() || 'openpgp';
  const key = (await git(['config', 'user.signingkey'])).stdout.trim();
  if (format !== 'ssh' || !key) return { format, key: key || undefined };
  if (key.startsWith('key::')) return { format, key, pub: key.slice(5) };
  const path = key.replace(/^~(?=[\\/])/, homedir());
  const file = path.endsWith('.pub') ? path : existsSync(`${path}.pub`) ? `${path}.pub` : path;
  const text = await readFile(join(root, file), 'utf8').catch(() =>
    readFile(file, 'utf8').catch(() => ''),
  );
  return { format, key, pub: keyOf(text) ? text.trim() : undefined };
}

/** SSH public keys the maintainer already has. */
async function ownKeys(home: string): Promise<string[]> {
  const dir = join(home, '.ssh');
  const names = await readdir(dir).catch(() => [] as string[]);
  const keys: string[] = [];
  for (const name of names
    .filter((n) => n.endsWith('.pub'))
    .sort((a, b) => (a.includes('ed25519') ? -1 : b.includes('ed25519') ? 1 : 0))) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    if (keyOf(text)) keys.push(join(dir, name));
  }
  return keys;
}

const short = (sha: string) => sha.slice(0, 7);

export async function release(options: ReleaseOptions, deps: ReleaseDeps): Promise<number> {
  const { say } = deps;
  const git = gitIn(deps.root, deps.git ?? (await findExecutable('git')) ?? 'git');
  try {
    // ── Can it? ───────────────────────────────────────────────────────────
    const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim();
    if (branch !== 'main')
      throw new Stop(
        `Releases are made from main; this is ${branch ? `“${branch}”` : 'no branch'}. Run: git switch main`,
      );
    const dirty = (await git(['status', '--porcelain=v1', '--untracked-files=no'])).stdout.trim();
    if (dirty) throw new Stop('There are uncommitted changes. Commit or stash them first.');
    await must(git, ['fetch', '--quiet', '--tags', 'origin'], 'Fetching from origin');
    const [here, there] = await Promise.all([
      git(['rev-parse', 'HEAD']),
      git(['rev-parse', '--verify', '--quiet', 'origin/main']),
    ]);
    if (there.code !== 0) throw new Stop('origin has no main branch to release from.');
    if (here.stdout.trim() !== there.stdout.trim()) {
      const counts = (
        await git(['rev-list', '--left-right', '--count', 'HEAD...origin/main'])
      ).stdout
        .trim()
        .split(/\s+/)
        .map(Number);
      throw new Stop(
        (counts[1] ?? 0) > 0
          ? 'main is behind origin. Run: git pull --ff-only'
          : 'main has commits origin doesn’t. Push them first (git push), so the release is what everyone has.',
      );
    }

    // ── Which version, and what's in it ───────────────────────────────────
    const tags = (await git(['tag', '-l', 'v*'])).stdout
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => releaseOfTag(t));
    const releases = tags
      .flatMap((t) => releaseOfTag(t) ?? [])
      .sort((a, b) => compareVersions(b.version, a.version));
    const lastStable = releases.find((r) => !r.pre);
    const pkgPath = join(deps.root, 'package.json');
    const pkg = await readFile(pkgPath, 'utf8');
    const written = (JSON.parse(pkg) as { version?: string }).version ?? '0.0.0';
    const sinceStable = await commitsIn(
      git,
      lastStable ? `${tagOf(lastStable.version)}..HEAD` : 'HEAD',
    );
    if (!sinceStable.length && !options.version)
      throw new Stop(
        `Nothing to release: no commits since ${tagOf(lastStable?.version ?? written)}.`,
      );
    const version =
      options.version ??
      nextVersion({
        lastStable: lastStable?.version ?? written,
        commits: sinceStable,
        kind: options.kind,
        existing: releases.map((r) => r.version),
      });
    const parsed = parseRelease(version);
    if (!parsed)
      throw new Stop(`${version} isn’t a version Conch releases (like 0.4.0 or 0.4.0-beta.1).`);
    if (tags.includes(tagOf(version))) throw new Stop(`${tagOf(version)} already exists.`);
    const newest = releases[0];
    if (newest && compareVersions(version, newest.version) <= 0)
      throw new Stop(`${version} isn’t newer than ${newest.version}, the newest release.`);

    // A pre-release tells what's new since the last release its channel saw; a stable one, since the last stable.
    const previous = releases.find(
      (r) => inChannel(r, options.kind) && compareVersions(r.version, version) < 0,
    );
    const commits =
      parsed.pre && previous
        ? await commitsIn(git, `${tagOf(previous.version)}..HEAD`)
        : sinceStable;
    const written$ = notesFrom(commits);
    let notes: Notes = written$.notes;
    let polishedBy: string | undefined;
    if (options.ai) {
      say('Writing the notes…');
      const polished = await polish(version, written$.groups, notes, deps.polish);
      if (polished.kind === 'polished') {
        notes = polished.notes;
        polishedBy = polished.by;
      } else say(`(The notes are as written from the commits: ${polished.why}.)`);
    }

    // ── Signing ───────────────────────────────────────────────────────────
    let signing = await signingKey(git, deps.root);
    if (signing.format !== 'ssh' || !signing.pub) {
      say('');
      say(
        signing.format !== 'ssh' && signing.key
          ? 'Git signs with GPG here, but Conch installs only check SSH signatures. Releases need an SSH signing key.'
          : 'Releases are signed, so every Conch can check they’re yours, and git has no signing key here yet.',
      );
      const keys = await ownKeys(deps.home ?? homedir());
      if (!keys[0])
        throw new Stop('Make one with: ssh-keygen -t ed25519, then run pnpm release again.');
      if (options.dryRun) say(`A real release would offer to sign with ${keys[0]}.`);
      else {
        if (!yes(await deps.ask(`Sign releases with ${keys[0]} (this repository only)? (y/N) `)))
          throw new Stop('Nothing was changed. Releases need a signing key.');
        await must(git, ['config', '--local', 'gpg.format', 'ssh'], 'Setting up signing');
        await must(git, ['config', '--local', 'user.signingkey', keys[0]], 'Setting up signing');
        signing = await signingKey(git, deps.root);
      }
    }
    const signersPath = join(deps.root, SIGNERS_FILE);
    const signers = await readFile(signersPath, 'utf8').catch(() => '');
    const pub = signing.pub ? keyOf(signing.pub) : undefined;
    const trusted = pub ? signerKeys(signers).includes(pub) : false;
    const addSigner = Boolean(pub && !trusted && !signerKeys(signers).length);
    if (pub && !trusted && !addSigner)
      throw new Stop(
        `Your signing key isn’t in ${SIGNERS_FILE}, so installs would refuse this release. To change keys: add the new key's line to ${SIGNERS_FILE} in a commit, release once more with the old key, then switch (docs/RELEASING.md).`,
      );
    const email = (await git(['config', 'user.email'])).stdout.trim();

    // ── The preview ───────────────────────────────────────────────────────
    say('');
    say(`  Conch ${version}${parsed.pre ? ` (a ${parsed.pre.kind})` : ''}`);
    say('');
    for (const line of notesText(notes).split('\n')) say(`  ${line}`);
    say('');
    say(
      polishedBy
        ? `  Notes polished by ${polishedBy} (--no-ai for the plain ones).`
        : '  Notes written from the commits.',
    );
    const since = parsed.pre ? previous : lastStable;
    say(
      `  ${commits.length} commit${commits.length === 1 ? '' : 's'} since ${since ? tagOf(since.version) : 'the beginning'}:`,
    );
    for (const c of commits.slice(0, 30)) say(`    ${short(c.sha)} ${c.subject}`);
    if (commits.length > 30) say(`    …and ${commits.length - 30} more`);
    if (addSigner)
      say(`  Your key goes in ${SIGNERS_FILE}: every Conch will trust releases signed with it.`);
    say('');
    if (options.dryRun) {
      say('Dry run: nothing was changed.');
      return 0;
    }
    if (!yes(await deps.ask(`Release ${tagOf(version)}? (y/N) `))) {
      say('Nothing was changed.');
      return 1;
    }

    // ── Doing it ──────────────────────────────────────────────────────────
    say('Running pnpm check…');
    if (!(await (deps.check ?? pnpmCheck(deps.root))()))
      throw new Stop('pnpm check didn’t pass, so nothing was changed. Run it to see why.');
    const date = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
    await writeFile(pkgPath, pkg.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`));
    const changelogPath = join(deps.root, 'CHANGELOG.md');
    const changelog = await readFile(changelogPath, 'utf8').catch(() => undefined);
    await writeFile(
      changelogPath,
      addToChangelog(changelog, changelogSection(version, date, notes)),
    );
    if (addSigner && signing.pub)
      await writeFile(
        signersPath,
        `${signers.trimEnd()}${signers.trim() ? '\n' : ''}${signerLine(email || 'conch', signing.pub)}\n`,
      );
    await must(
      git,
      ['add', 'package.json', 'CHANGELOG.md', SIGNERS_FILE],
      'Adding the release files',
    );
    await must(git, ['commit', '--quiet', '-m', `release: ${tagOf(version)}`], 'Committing');

    const dir = await mkdtemp(join(tmpdir(), 'conch-release-'));
    try {
      const messageFile = join(dir, 'message');
      await writeFile(messageFile, tagMessage(version, notes));
      const tagged = await git(
        ['tag', '-s', '-a', '--cleanup=verbatim', '-F', messageFile, tagOf(version)],
        { timeout: 120_000 },
      );
      // The tag must be one every install would take: checked as they check it.
      const object = (
        await git(['rev-parse', '--verify', '--quiet', `refs/tags/${tagOf(version)}`])
      ).stdout.trim();
      const verdict =
        tagged.code === 0 && object
          ? await verifyTag(git, {
              object,
              name: tagOf(version),
              signers: await readFile(signersPath, 'utf8'),
              sshKeygen: await (deps.sshKeygen ?? (() => findExecutable('ssh-keygen')))(),
            })
          : undefined;
      if (!verdict?.ok) {
        if (object) await git(['tag', '-d', tagOf(version)]);
        await git(['reset', '--keep', '--quiet', 'HEAD~1']);
        throw new Stop(
          tagged.code !== 0
            ? `Signing the tag didn’t work: ${(tagged.stderr || tagged.stdout).trim().split('\n')[0] ?? ''}. If your key has a passphrase, run ssh-add first. Nothing was pushed, and the release commit was taken back.`
            : `The tag wouldn’t pass the check installs make (${verdict && !verdict.ok ? verdict.message : 'unreadable'}). Nothing was pushed, and the release commit was taken back.`,
        );
      }

      say(`Pushing ${tagOf(version)}…`);
      const pushed = await git(
        [
          'push',
          '--atomic',
          '--quiet',
          'origin',
          'HEAD:refs/heads/main',
          `refs/tags/${tagOf(version)}`,
        ],
        { timeout: 120_000 },
      );
      if (pushed.code !== 0)
        throw new Stop(
          `Pushing didn’t work (${(pushed.stderr || pushed.stdout).trim().split('\n')[0] ?? ''}). The release is ready here; push it with: git push --atomic origin main ${tagOf(version)}`,
        );

      const gh = await (deps.gh ?? (() => findExecutable('gh')))();
      if (gh) {
        const notesFile = join(dir, 'notes.md');
        await writeFile(notesFile, releaseBody(notes));
        const made = await runProgram(
          gh,
          [
            'release',
            'create',
            tagOf(version),
            '--title',
            `Conch ${version}`,
            '--notes-file',
            notesFile,
            '--verify-tag',
            ...(parsed.pre ? ['--prerelease'] : []),
          ],
          { cwd: deps.root, timeout: 120_000 },
        );
        say(
          made.code === 0
            ? 'Made the GitHub Release. GitHub Actions builds the desktop apps and attaches them to it, in about half an hour.'
            : `The tag is pushed, but gh couldn’t make the GitHub Release (${(made.stderr || made.stdout).trim().split('\n')[0] ?? ''}). The tag carries the notes; make it later with: gh release create ${tagOf(version)} --notes-from-tag`,
        );
      } else
        say(
          'No gh here: GitHub Actions makes the GitHub Release from the tag, with the desktop apps, in about half an hour.',
        );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    say(`Released ${tagOf(version)}.`);
    return 0;
  } catch (error) {
    if (error instanceof Stop) {
      say(error.message);
      return 1;
    }
    throw error;
  }
}

/** The whole check, as before every commit (turbo's cache makes it quick when it already passed). */
function pnpmCheck(root: string): () => Promise<boolean> {
  return async () => {
    const pnpm = (await findExecutable('pnpm')) ?? 'pnpm';
    const result = await runProgram(pnpm, ['check'], {
      cwd: root,
      timeout: 30 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return result.code === 0;
  };
}
