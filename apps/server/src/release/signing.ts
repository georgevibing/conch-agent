/**
 * Is this release really from Conch's makers? (ADR 0051)
 *
 * Every release is an annotated tag signed with an SSH key. Which keys count
 * is pinned in `release/allowed_signers` — read from the Conch already
 * installed, at its own commit (`HEAD:release/allowed_signers`), never from
 * the release being checked and never from a file on disk anyone could
 * edit. That's trust on first use, carried forward: a release that changes
 * the list must be signed by a key on the old one.
 *
 * Git checks the signature (`git verify-tag`, which runs `ssh-keygen -Y
 * verify`); Conch only points it at the pinned list and the system's own
 * `ssh-keygen`, whatever git is configured with. Before that, the tag
 * object itself is read: it must be a tag, of a commit, with exactly the name
 * it's offered under (so a good signature on an old release can't be passed
 * off as a new one).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Git } from '../updates/conch';

export const SIGNERS_FILE = 'release/allowed_signers';

/** An SSH public key in a line of `allowed_signers` (or a `.pub` file): its type and its key. */
const KEY =
  /\b(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+([A-Za-z0-9+/]+={0,3})/;

/** The keys a list trusts, as `type base64`. Comments and blank lines aren't keys. */
export function signerKeys(list: string): string[] {
  return list
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .flatMap((line) => {
      const match = KEY.exec(line);
      return match ? [`${match[1]} ${match[2]}`] : [];
    });
}

/** The key in a public key's text (`ssh-ed25519 AAAA… ada@laptop`), as `type base64`. */
export function keyOf(text: string): string | undefined {
  const match = KEY.exec(text);
  return match ? `${match[1]} ${match[2]}` : undefined;
}

/** A line for the list: who, for git signatures only, and the key. */
export function signerLine(principal: string, publicKey: string): string {
  const key = keyOf(publicKey);
  if (!key) throw new Error('That isn’t an SSH public key.');
  const who = principal.replace(/[^\w.@+-]/g, '') || 'conch';
  return `${who} namespaces="git" ${key}`;
}

export interface TagFacts {
  /** The commit the tag points at. */
  commit: string;
  /** The tag's own message, without its signature. */
  message: string;
  /** When it was made, from its `tagger` line. */
  date?: number;
  signature: 'ssh' | 'pgp' | 'none';
}

/** Reads a tag object's raw text (`git cat-file tag`). */
export function readTag(raw: string, name: string): TagFacts | string {
  const split = raw.indexOf('\n\n');
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? '' : raw.slice(split + 2);
  const field = (key: string) => new RegExp(`^${key} (.+)$`, 'm').exec(head)?.[1]?.trim();
  if (field('tag') !== name) return 'its name inside isn’t the one it was offered under';
  if (field('type') !== 'commit') return 'it doesn’t point at a version of Conch';
  const commit = field('object') ?? '';
  if (!/^[0-9a-f]{40,64}$/.test(commit)) return 'it doesn’t point at a version of Conch';
  const at = /\s(\d{9,11}) [+-]\d{4}$/.exec(field('tagger') ?? '')?.[1];
  const ssh = body.indexOf('-----BEGIN SSH SIGNATURE-----');
  const pgp = body.search(/-----BEGIN PGP (SIGNATURE|MESSAGE)-----/);
  const cut = ssh !== -1 ? ssh : pgp !== -1 ? pgp : body.length;
  return {
    commit,
    message: body.slice(0, cut).trimEnd(),
    ...(at && { date: Number(at) * 1000 }),
    signature: ssh !== -1 ? 'ssh' : pgp !== -1 ? 'pgp' : 'none',
  };
}

export type Verdict =
  | (TagFacts & { ok: true; signer: string; fingerprint?: string })
  | {
      ok: false;
      why: 'unsigned' | 'untrusted' | 'malformed' | 'no-keys' | 'no-tool';
      /** One sentence, ending "…so Conch won't install it." where that's what happens. */
      message: string;
    };

/**
 * Check one release: the tag object `object` offered as `name`, against the
 * pinned `signers` list (its text). Uses no configuration of git's own for
 * signatures, and never prompts.
 */
export async function verifyTag(
  git: Git,
  {
    object,
    name,
    signers,
    sshKeygen,
  }: { object: string; name: string; signers: string; sshKeygen?: string },
): Promise<Verdict> {
  const label = `Conch ${name.replace(/^v/, '')}`;
  const type = await git(['cat-file', '-t', object]);
  if (type.code !== 0 || type.stdout.trim() !== 'tag')
    return {
      ok: false,
      why: 'unsigned',
      message: `${label} isn’t signed, so Conch won’t install it.`,
    };
  const raw = await git(['cat-file', 'tag', object]);
  const facts = raw.code === 0 ? readTag(raw.stdout, name) : 'Conch couldn’t read it';
  if (typeof facts === 'string')
    return {
      ok: false,
      why: 'malformed',
      message: `${label} isn’t what it says it is (${facts}), so Conch won’t install it.`,
    };
  if (facts.signature === 'none')
    return {
      ok: false,
      why: 'unsigned',
      message: `${label} isn’t signed, so Conch won’t install it.`,
    };
  if (facts.signature === 'pgp')
    return {
      ok: false,
      why: 'untrusted',
      message: `${label} is signed in a way this Conch doesn’t check (only SSH keys), so Conch won’t install it.`,
    };
  if (!signerKeys(signers).length)
    return {
      ok: false,
      why: 'no-keys',
      message: `This Conch doesn’t know whose signature to trust yet, so it won’t install ${label}.`,
    };
  if (!sshKeygen)
    return {
      ok: false,
      why: 'no-tool',
      message: `Conch can’t check ${label}’s signature without ssh-keygen, which comes with Git.`,
    };

  const dir = await mkdtemp(join(tmpdir(), 'conch-signers-'));
  try {
    const file = join(dir, 'allowed_signers');
    await writeFile(file, signers.endsWith('\n') ? signers : `${signers}\n`, { mode: 0o600 });
    const result = await git([
      '-c',
      'gpg.format=ssh',
      '-c',
      `gpg.ssh.allowedSignersFile=${file}`,
      '-c',
      `gpg.ssh.program=${sshKeygen}`,
      'verify-tag',
      object,
    ]);
    const said = `${result.stderr}\n${result.stdout}`;
    const good = /Good "git" signature for (\S+) with (\S+) key (SHA256:[A-Za-z0-9+/=]+)/.exec(
      said,
    );
    if (result.code === 0 && good)
      return { ok: true, ...facts, signer: good[1] ?? '', fingerprint: good[3] };
    return {
      ok: false,
      why: 'untrusted',
      message: /no principal matched|not allowed|could not verify/i.test(said)
        ? `${label} isn’t signed by a key this Conch trusts, so Conch won’t install it.`
        : `${label}’s signature doesn’t check out, so Conch won’t install it.`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
