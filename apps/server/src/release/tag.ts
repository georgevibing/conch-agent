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

import { run } from '../lib/proc';
import type { Git } from '../updates/conch';
import { must, notesFor, Stop } from './history';
import { changelogFor, emptyNotes, parseNotes, tagMessage, type Notes } from './notes';
import { parseRelease, tagOf } from './semver';
import { keyOf, SIGNERS_FILE, signerKeys, verifyTag } from './signing';

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
  const signers = await git(['show', `${target}:${SIGNERS_FILE}`]);
  if (signers.code !== 0 || !signerKeys(signers.stdout).length)
    throw new Stop(
      `${SIGNERS_FILE} has no release key at ${target.slice(0, 7)}, so no Conch could check this release. Run pnpm release key, commit the list, and merge the release again.`,
    );
  const check = async (object: string) =>
    verifyTag(git, { object, name, signers: signers.stdout, sshKeygen });

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
    if (!signerKeys(signers.stdout).includes(own))
      throw new Stop(
        `The release key isn’t in ${SIGNERS_FILE}, so installs would refuse this release. To change keys, add the new one to the list in a release signed with the old one (docs/RELEASING.md).`,
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
