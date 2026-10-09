/**
 * The release's signed tag (ADR 0127, ADR 0051 § Checking a release is
 * real). When the release pull request is merged, CI runs `pnpm release ci
 * tag`: an annotated tag on the merge, its message the notes from that
 * commit's `CHANGELOG.md`, signed with the release key (the
 * `RELEASE_SIGNING_KEY` secret, only ever in this step). Then it's checked
 * the way every install checks it, against `release/allowed_signers` as
 * committed at that commit. A tag that wouldn't pass is taken back before
 * anything is pushed.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ReleaseChannel } from '@conch/protocol';

import { run } from '../lib/proc';
import type { Git } from '../updates/conch';
import { compareVersions } from '../updates/version';
import { must, notesFor, Stop, taggedReleases } from './history';
import { changelogFor, emptyNotes, parseNotes, tagMessage, type Notes } from './notes';
import { channelOf, inChannel, parseRelease, tagOf } from './semver';
import { keyOf, SIGNERS_FILE, signerKeys, verifyTag, type Verdict } from './signing';

/** Who the tag says made it, unless the repository's variables say otherwise. */
export const TAGGER = {
  name: 'Conch releases',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};

/** The notes a release's commit carries: its CHANGELOG section, or else written from the commits. */
export async function notesAt(git: Git, version: string, commit: string): Promise<Notes> {
  const log = await git(['show', `${commit}:CHANGELOG.md`]);
  const section = log.code === 0 ? changelogFor(log.stdout, version) : undefined;
  const notes = section ? parseNotes(section) : undefined;
  if (notes && !emptyNotes(notes)) return notes;
  return (await notesFor(git, version, { head: commit })).notes;
}

/** The channels whose installs are offered a release on `channel`: stable reaches all three. */
const REACHES: Record<ReleaseChannel, ReleaseChannel[]> = {
  stable: ['stable', 'beta', 'alpha'],
  beta: ['beta', 'alpha'],
  alpha: ['alpha'],
};

/**
 * The lists a new release must pass. For each channel it's offered on, the
 * newest earlier release there: what that channel's installs carry (an install
 * on stable has only ever had stable releases). And this commit's own, which
 * the next release is checked against.
 */
export async function trustedLists(
  git: Git,
  version: string,
  target: string,
): Promise<{ label: string; signers: string }[]> {
  const own = await git(['show', `${target}:${SIGNERS_FILE}`]);
  if (own.code !== 0 || !signerKeys(own.stdout).length)
    throw new Stop(
      `${SIGNERS_FILE} has no release key at ${target.slice(0, 7)}, so no Conch could check this release. docs/RELEASING.md § If something goes wrong says what to do.`,
    );
  const release = parseRelease(version);
  const earlier = (await taggedReleases(git)).filter(
    (r) => compareVersions(r.version, version) < 0,
  );
  const befores = new Map<string, ReleaseChannel[]>();
  for (const channel of REACHES[release ? channelOf(release) : 'stable']) {
    const before = earlier.find((r) => inChannel(r, channel));
    if (before) befores.set(before.version, [...(befores.get(before.version) ?? []), channel]);
  }
  const lists = [];
  for (const [before, channels] of befores) {
    const theirs = await git(['show', `${tagOf(before)}^{commit}:${SIGNERS_FILE}`]);
    if (theirs.code === 0 && signerKeys(theirs.stdout).length)
      lists.push({
        label: `${tagOf(before)}, the newest release on ${channels.join(' and ')} before it`,
        signers: theirs.stdout,
      });
  }
  lists.push({ label: `${SIGNERS_FILE} at this release`, signers: own.stdout });
  return lists;
}

export interface Tagged {
  kind: 'made' | 'there';
  object: string;
  signer: string;
}

export async function makeTag(
  git: Git,
  {
    version,
    commit,
    key,
    sshKeygen,
    tagger = TAGGER,
  }: {
    version: string;
    /** The merged release pull request's commit. */
    commit: string;
    /** The private key's text. */
    key: string;
    sshKeygen: string;
    tagger?: { name: string; email: string };
  },
): Promise<Tagged> {
  if (!parseRelease(version))
    throw new Stop(`${version} isn’t a version Conch releases (like 0.4.0 or 0.4.0-beta.1).`);
  const name = tagOf(version);
  const target = (
    await must(git, ['rev-parse', '--verify', `${commit}^{commit}`], 'Finding the release commit')
  ).trim();
  const lists = await trustedLists(git, version, target);
  const check = async (object: string) => {
    let verdict: Verdict | undefined;
    // Every list must take it: the one installs carry forward, and this release's own.
    for (const list of lists) {
      verdict = await verifyTag(git, { object, name, signers: list.signers, sshKeygen });
      if (!verdict.ok) return { ...verdict, message: `${verdict.message} (by ${list.label})` };
    }
    return verdict as Verdict;
  };

  // Made already (a run tried before): fine if it's this commit's and it checks out.
  const there = (
    await git(['rev-parse', '--verify', '--quiet', `refs/tags/${name}`])
  ).stdout.trim();
  if (there) {
    const verdict = await check(there);
    if (!verdict.ok) throw new Stop(`${name} is there already, and ${verdict.message}`);
    if (verdict.commit !== target)
      throw new Stop(
        `${name} is there already, on ${verdict.commit.slice(0, 7)}, not this release’s commit.`,
      );
    return { kind: 'there', object: there, signer: verdict.signer };
  }

  const dir = await mkdtemp(join(tmpdir(), 'conch-tag-'));
  try {
    const keyFile = join(dir, 'release-key');
    await writeFile(keyFile, key.endsWith('\n') ? key : `${key}\n`, { mode: 0o600 });
    const pub = await run(sshKeygen, ['-y', '-f', keyFile], { timeout: 30_000 });
    const own = pub.code === 0 ? keyOf(pub.stdout) : undefined;
    if (!own) throw new Stop('RELEASE_SIGNING_KEY isn’t an SSH private key without a passphrase.');
    const refusing = lists.find((list) => !signerKeys(list.signers).includes(own));
    if (refusing)
      throw new Stop(
        `The release key isn’t trusted by ${refusing.label}, so installs would refuse this release. Sign with a key it trusts; to change keys, add the new one to the list in a release signed with the old one (docs/RELEASING.md).`,
      );
    const messageFile = join(dir, 'message');
    await writeFile(messageFile, tagMessage(version, await notesAt(git, version, target)));
    const made = await git(
      [
        '-c',
        'gpg.format=ssh',
        '-c',
        `gpg.ssh.program=${sshKeygen}`,
        '-c',
        `user.signingkey=${keyFile}`,
        '-c',
        `user.name=${tagger.name}`,
        '-c',
        `user.email=${tagger.email}`,
        'tag',
        '-s',
        '-a',
        '--cleanup=verbatim',
        '-F',
        messageFile,
        name,
        target,
      ],
      { timeout: 120_000 },
    );
    if (made.code !== 0)
      throw new Stop(
        `Signing ${name} didn’t work: ${(made.stderr || made.stdout).trim().split('\n')[0] ?? ''}`,
      );
    const object = (
      await git(['rev-parse', '--verify', '--quiet', `refs/tags/${name}`])
    ).stdout.trim();
    const verdict = await check(object);
    if (!verdict.ok || verdict.commit !== target) {
      await git(['tag', '-d', name]);
      throw new Stop(
        `${name} wouldn’t pass the check installs make (${verdict.ok ? 'it points elsewhere' : verdict.message}), so it was taken back.`,
      );
    }
    return { kind: 'made', object, signer: verdict.signer };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
