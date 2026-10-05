import { z } from 'zod';

import type { Git } from '../../server/src/updates/conch';
import { releaseOfTag } from '../../server/src/release/semver';
import { SIGNERS_FILE, verifyTag } from '../../server/src/release/signing';

/** Historic keys are trusted only inside history already accepted by trusted main. */
export async function verifyPublication(git: Git, tag: string): Promise<string> {
  if (`v${releaseOfTag(tag)?.version}` !== tag) throw new Error('Not a Conch release tag.');
  const read = async (args: string[]) => {
    const result = await git(args);
    if (result.code !== 0) throw new Error(`Cannot verify the source of ${tag}.`);
    return result.stdout.trim();
  };
  const object = await read(['rev-parse', '--verify', `refs/conch-site/tags/${tag}`]);
  const commit = await read(['rev-parse', '--verify', `${object}^{commit}`]);
  if (!/^[0-9a-f]{40,64}$/.test(commit) || !/^[0-9a-f]{40,64}$/.test(object))
    throw new Error(`Invalid Git object for ${tag}.`);
  // A release's own signer list is not trusted just because a tag names it.
  // Its commit must already belong to the trusted publishing checkout's history.
  const ancestor = await git(['merge-base', '--is-ancestor', commit, 'HEAD']);
  if (ancestor.code !== 0) throw new Error(`${tag} is not part of trusted main history.`);
  const signers = await read(['show', `${commit}:${SIGNERS_FILE}`]);
  const verdict = await verifyTag(git, {
    name: tag,
    object,
    signers,
    sshKeygen: '/usr/bin/ssh-keygen',
  });
  if (!verdict.ok) throw new Error(verdict.message);
  if (verdict.commit !== commit) throw new Error(`The verified commit of ${tag} changed.`);
  const pkg = z
    .object({ version: z.string() })
    .parse(JSON.parse(await read(['show', `${commit}:package.json`])));
  if (`v${pkg.version}` !== tag) throw new Error(`${tag} does not match its package version.`);
  return commit;
}
