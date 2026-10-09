/**
 * `pnpm release` (ADR 0127, docs/RELEASING.md). Conch is released by
 * merging the release pull request release-please keeps up to date; these
 * are the few things around that a maintainer, or CI, does by hand.
 *
 *   pnpm release                     what the next release says so far, and where it is
 *   pnpm release channel <c>         alphas, betas or stable releases from now on
 *   pnpm release as <version>        the next release is exactly this version
 *   pnpm release key                 the release key, made once and given to GitHub
 *   pnpm release ci notes|tag|page   the steps .github/workflows/release.yml runs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { findExecutable, run } from '../lib/proc';
import { gitIn, type Git } from '../updates/conch';
import { channelIn, setChannel, setReleaseAs } from './channel';
import { notesSince, Stop, taggedReleases } from './history';
import { setUpKey } from './key';
import { notesText } from './notes';
import { releasePage } from './page';
import { CONFIG_FILE, writePullRequestNotes } from './pr';
import { inChannel, parseRelease, tagOf } from './semver';
import { makeTag, notesAt, TAGGER } from './tag';

export const HELP = `pnpm release [command]

  Conch is released by merging the release pull request on GitHub, which
  release-please keeps up to date from the commits on main (docs/RELEASING.md).

  (nothing)                   what the next release says so far, and its pull request
    --ai                      with the notes polished, as CI does
  channel alpha|beta|stable   which releases come next (edits ${CONFIG_FILE})
  as <version>                make the next release exactly this version, once
  key                         make the release key and give it to GitHub (once)
`;

export interface CommandDeps {
  /** The repository's root. */
  root: string;
  say: (line: string) => void;
  ask: (question: string) => Promise<string>;
  home: string;
  env: Record<string, string | undefined>;
  git?: string;
  /** gh's path, if it's here. */
  gh?: () => Promise<string | undefined>;
  sshKeygen?: () => Promise<string | undefined>;
}

/** `--name value` or `--name=value`. */
function option(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === `--${name}`) return argv[i + 1];
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return undefined;
}

function required(argv: string[], name: string): string {
  const value = option(argv, name);
  if (!value) throw new Stop(`--${name} is needed.`);
  return value;
}

/** `owner/name`: GitHub's own word for it in CI, else the package's repository. */
async function repositoryOf(deps: CommandDeps): Promise<string> {
  if (deps.env.GITHUB_REPOSITORY) return deps.env.GITHUB_REPOSITORY;
  const pkg = JSON.parse(await readFile(join(deps.root, 'package.json'), 'utf8')) as {
    repository?: { url?: string } | string;
  };
  const url = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url);
  if (!match?.[1]) throw new Stop('package.json doesn’t say which GitHub repository this is.');
  return match[1];
}

const tool = async (find: (() => Promise<string | undefined>) | undefined, name: string) =>
  (await (find ?? (() => findExecutable(name)))()) ?? undefined;

export async function main(argv: string[], deps: CommandDeps): Promise<number> {
  const { say } = deps;
  const git = gitIn(deps.root, deps.git ?? (await findExecutable('git')) ?? 'git');
  const [command = '', ...rest] = argv.filter((a) => a !== '--');
  try {
    switch (command) {
      case '':
      case '--ai':
        await status(git, deps, argv.includes('--ai'));
        return 0;
      case 'channel':
        await channel(git, deps, rest[0]);
        return 0;
      case 'as':
        await releaseAs(git, deps, rest[0]);
        return 0;
      case 'key':
        await setUpKey({
          root: deps.root,
          home: deps.home,
          say,
          ask: deps.ask,
          sshKeygen: await tool(deps.sshKeygen, 'ssh-keygen'),
          gh: await tool(deps.gh, 'gh'),
        });
        return 0;
      case 'ci':
        await ci(git, deps, rest);
        return 0;
      case 'help':
      case '-h':
      case '--help':
        say(HELP.trimEnd());
        return 0;
      default:
        say(`Unknown command: ${command} (try pnpm release help)`);
        return 1;
    }
  } catch (error) {
    if (error instanceof Stop) {
      say(error.message);
      return 1;
    }
    throw error;
  }
}

async function config(deps: CommandDeps): Promise<{ path: string; text: string }> {
  const path = join(deps.root, CONFIG_FILE);
  return { path, text: await readFile(path, 'utf8') };
}

/** The newest release, from upstream's tags when they can be had. */
async function latest(git: Git): Promise<string | undefined> {
  await git(['fetch', '--quiet', '--tags', 'origin'], { timeout: 60_000 });
  return (await taggedReleases(git))[0]?.version;
}

async function status(git: Git, deps: CommandDeps, ai: boolean): Promise<void> {
  const { say } = deps;
  const on = channelIn((await config(deps)).text);
  await git(['fetch', '--quiet', '--tags', 'origin'], { timeout: 60_000 });
  const releases = await taggedReleases(git);
  const since = releases.find((r) => inChannel(r, on));
  say(
    `Releases are ${on === 'stable' ? 'stable ones' : `${on}s`}. The newest: ${releases[0] ? tagOf(releases[0].version) : 'none yet'}.`,
  );
  const gh = await tool(deps.gh, 'gh');
  if (gh) {
    const open = await run(
      gh,
      [
        'pr',
        'list',
        '--state',
        'open',
        '--label',
        'autorelease: pending',
        '--json',
        'title,url',
        '--jq',
        '.[] | "\\(.title)  \\(.url)"',
      ],
      { cwd: deps.root, timeout: 30_000 },
    );
    const line = open.stdout.trim();
    say(
      open.code !== 0
        ? 'gh couldn’t look for the release pull request (is it signed in? gh auth login).'
        : line
          ? `The release pull request: ${line}`
          : 'There’s no release pull request open: nothing on main a person would notice yet.',
    );
  }
  const next = await notesSince(git, 'next', since, { ai });
  say('');
  say(
    `  The notes so far (${next.commits.length} commit${next.commits.length === 1 ? '' : 's'} since ${since ? tagOf(since.version) : 'the beginning'}):`,
  );
  say('');
  for (const line of notesText(next.notes).split('\n')) say(`  ${line}`);
  say('');
  say(
    next.polishedBy
      ? `  Polished by ${next.polishedBy}, as CI will.`
      : `  As written from the commits${next.plainWhy ? ` (${next.plainWhy})` : ''}. CI polishes them in the release pull request${ai ? '' : '; --ai shows how'}.`,
  );
}

async function channel(git: Git, deps: CommandDeps, wanted: string | undefined): Promise<void> {
  if (wanted !== 'alpha' && wanted !== 'beta' && wanted !== 'stable')
    throw new Stop('Which channel? pnpm release channel alpha, beta or stable.');
  const file = await config(deps);
  const change = setChannel(file.text, wanted, await latest(git));
  await writeFile(file.path, change.text);
  deps.say(`${change.next} Commit ${CONFIG_FILE} and push it: the release pull request follows.`);
}

async function releaseAs(git: Git, deps: CommandDeps, version: string | undefined): Promise<void> {
  if (!version) throw new Stop('Which version? pnpm release as 0.4.0');
  const file = await config(deps);
  const change = setReleaseAs(file.text, version.replace(/^v/, ''), await latest(git));
  await writeFile(file.path, change.text);
  deps.say(`${change.next} Commit ${CONFIG_FILE} and push it: the release pull request follows.`);
}

/** The steps of .github/workflows/release.yml. */
async function ci(git: Git, deps: CommandDeps, argv: string[]): Promise<void> {
  const { say, env } = deps;
  const repository = await repositoryOf(deps);
  switch (argv[0]) {
    case 'notes': {
      const out = required(argv, 'body-file');
      const result = await writePullRequestNotes({ root: deps.root, git, repository });
      await writeFile(out, result.body);
      say(
        `Conch ${result.version}: ${result.commits.length} commits since ${result.since ? tagOf(result.since.version) : 'the beginning'}.`,
      );
      say(
        result.polishedBy
          ? `Polished by ${result.polishedBy}.`
          : `As written from the commits (${result.plainWhy ?? 'not polished'}).`,
      );
      say(notesText(result.notes));
      say(`Changed: ${result.files.join(', ')}`);
      return;
    }
    case 'tag': {
      const version = required(argv, 'version');
      const key = env.RELEASE_SIGNING_KEY;
      if (!key?.trim())
        throw new Stop('RELEASE_SIGNING_KEY isn’t set: run pnpm release key (docs/RELEASING.md).');
      const sshKeygen = await tool(deps.sshKeygen, 'ssh-keygen');
      if (!sshKeygen) throw new Stop('Signing needs ssh-keygen.');
      const tagged = await makeTag(git, {
        version,
        commit: required(argv, 'commit'),
        key,
        sshKeygen,
        tagger: {
          name: env.RELEASE_TAGGER_NAME || TAGGER.name,
          email: env.RELEASE_TAGGER_EMAIL || TAGGER.email,
        },
      });
      say(
        tagged.kind === 'made'
          ? `Signed ${tagOf(version)} as ${tagged.signer}; it passes the check installs make.`
          : `${tagOf(version)} is there already, signed by ${tagged.signer}, and checks out.`,
      );
      return;
    }
    case 'page': {
      const version = required(argv, 'version');
      if (!parseRelease(version)) throw new Stop(`${version} isn’t a version Conch releases.`);
      const notes = await notesAt(git, version, `${tagOf(version)}^{commit}`);
      await writeFile(
        required(argv, 'out'),
        releasePage({
          version,
          notes,
          repository,
          signed: { mac: env.MAC_SIGNED === 'true', windows: env.WINDOWS_SIGNED === 'true' },
        }),
      );
      say(`Wrote the page for ${tagOf(version)}.`);
      return;
    }
    default:
      throw new Stop('pnpm release ci notes|tag|page: the steps of .github/workflows/release.yml.');
  }
}
