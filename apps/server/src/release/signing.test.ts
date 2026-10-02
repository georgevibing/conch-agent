import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findExecutable } from '../lib/proc';
import { gitIn } from '../updates/conch';
import { keyOf, readTag, signerKeys, signerLine, verifyTag } from './signing';
import { commit, git, GIT_ENV, makeKey, signer, tag } from './testing';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function repo() {
  const base = await mkdtemp(join(tmpdir(), 'conch-signing-'));
  dirs.push(base);
  const root = join(base, 'repo');
  git(base, 'init', '--quiet', '-b', 'main', root);
  commit(root, { 'a.txt': '1' }, 'feat: the first version');
  const maker = makeKey(base, 'maker');
  const stranger = makeKey(base, 'stranger');
  const sshKeygen = await findExecutable('ssh-keygen');
  const check = (name: string, signers: string) => {
    const object = git(root, 'rev-parse', `refs/tags/${name}`);
    return verifyTag(gitIn(root, 'git'), {
      object,
      name,
      signers,
      sshKeygen,
    });
  };
  return { base, root, maker, stranger, check };
}

describe('the pinned list of signers', () => {
  it('reads keys, not comments, and writes a line for one', () => {
    const list = [
      '# Releases are signed by these keys (ADR 0048).',
      '',
      'ada@example.com namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk ada',
    ].join('\n');
    expect(signerKeys(list)).toEqual(['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk']);
    expect(signerKeys('# nobody yet\n')).toEqual([]);
    expect(keyOf('ssh-ed25519 AAAAC3Nza ada@laptop')).toBe('ssh-ed25519 AAAAC3Nza');
    expect(signerLine('ada@example.com', 'ssh-ed25519 AAAAC3Nza ada@laptop')).toBe(
      'ada@example.com namespaces="git" ssh-ed25519 AAAAC3Nza',
    );
    expect(() => signerLine('ada', 'not a key')).toThrow();
  });

  it('reads a tag object strictly', () => {
    const raw = [
      `object ${'a'.repeat(40)}`,
      'type commit',
      'tag v0.3.0',
      'tagger Ada <ada@example.com> 1790000000 +0200',
      '',
      'Conch 0.3.0',
      '',
      'New',
      '- Edit pages by hand',
      '-----BEGIN SSH SIGNATURE-----',
      'U1NIU0lH',
      '-----END SSH SIGNATURE-----',
    ].join('\n');
    expect(readTag(raw, 'v0.3.0')).toMatchObject({
      commit: 'a'.repeat(40),
      message: 'Conch 0.3.0\n\nNew\n- Edit pages by hand',
      signature: 'ssh',
      date: 1790000000000,
    });
    expect(readTag(raw, 'v0.4.0')).toMatch(/name inside/);
    expect(readTag(raw.replace('type commit', 'type tree'), 'v0.3.0')).toMatch(/doesn’t point/);
  });
});

describe('checking a release’s signature, with real git and ssh-keygen', () => {
  it('accepts a tag signed by a pinned key, and says who signed it', async () => {
    const { root, maker, check } = await repo();
    tag(root, 'v0.3.0', 'Conch 0.3.0\n\nNew\n- Edit pages by hand\n', maker);
    const verdict = await check('v0.3.0', `${signer('ada@example.com', maker)}\n`);
    expect(verdict).toMatchObject({
      ok: true,
      signer: 'ada@example.com',
      commit: git(root, 'rev-parse', 'HEAD'),
      message: 'Conch 0.3.0\n\nNew\n- Edit pages by hand',
    });
    if (verdict.ok) expect(verdict.fingerprint).toMatch(/^SHA256:/);
  });

  it('refuses a tag nobody signed', async () => {
    const { root, maker, check } = await repo();
    tag(root, 'v0.3.0', 'Conch 0.3.0\n');
    expect(await check('v0.3.0', signer('ada', maker))).toEqual({
      ok: false,
      why: 'unsigned',
      message: 'Conch 0.3.0 isn’t signed, so Conch won’t install it.',
    });
    // A lightweight tag is no signature either.
    git(root, 'tag', 'v0.3.1');
    expect(await check('v0.3.1', signer('ada', maker))).toMatchObject({ why: 'unsigned' });
  });

  it('refuses a forged tag: well signed, by a key nobody pinned', async () => {
    const { root, maker, stranger, check } = await repo();
    tag(root, 'v0.3.0', 'Conch 0.3.0\n', stranger);
    expect(await check('v0.3.0', signer('ada', maker))).toEqual({
      ok: false,
      why: 'untrusted',
      message: 'Conch 0.3.0 isn’t signed by a key this Conch trusts, so Conch won’t install it.',
    });
  });

  it('refuses a tag whose message was changed after signing', async () => {
    const { root, maker, check } = await repo();
    tag(root, 'v0.3.0', 'Conch 0.3.0\n', maker);
    const raw = git(root, 'cat-file', 'tag', 'v0.3.0');
    const forged = execGit(
      root,
      ['hash-object', '-t', 'tag', '-w', '--stdin'],
      raw.replace('Conch 0.3.0', 'Conch 0.3.0 (now with more)'),
    );
    git(root, 'update-ref', 'refs/tags/v0.3.0', forged);
    expect(await check('v0.3.0', signer('ada', maker))).toMatchObject({
      ok: false,
      why: 'untrusted',
    });
  });

  it('refuses an old release passed off under a new name', async () => {
    const { root, maker, check } = await repo();
    tag(root, 'v0.2.0', 'Conch 0.2.0\n', maker);
    // v0.9.0 points at v0.2.0's well-signed tag object.
    git(root, 'update-ref', 'refs/tags/v0.9.0', git(root, 'rev-parse', 'refs/tags/v0.2.0'));
    expect(await check('v0.9.0', signer('ada', maker))).toMatchObject({
      ok: false,
      why: 'malformed',
      message: expect.stringMatching(/name inside isn’t the one it was offered under/),
    });
  });

  it('carries trust forward when the key changes: the old list decides', async () => {
    const { root, maker, stranger: next, check } = await repo();
    const old = signer('ada', maker);
    const both = `${old}\n${signer('ada', next)}`;
    // The release that adds the new key is signed with the old one: an install trusting only the old key takes it.
    tag(root, 'v0.4.0', 'Conch 0.4.0\n', maker);
    expect(await check('v0.4.0', old)).toMatchObject({ ok: true });
    // The next release, signed with the new key, is trusted by installs that have 0.4.0's list…
    tag(root, 'v0.5.0', 'Conch 0.5.0\n', next);
    expect(await check('v0.5.0', both)).toMatchObject({ ok: true });
    // …and refused by one still on the old list, which never learnt the new key.
    expect(await check('v0.5.0', old)).toMatchObject({ ok: false, why: 'untrusted' });
  });

  it('won’t guess when it has no keys, or no ssh-keygen', async () => {
    const { root, maker } = await repo();
    tag(root, 'v0.3.0', 'Conch 0.3.0\n', maker);
    const object = git(root, 'rev-parse', 'refs/tags/v0.3.0');
    const runner = gitIn(root, 'git');
    expect(
      await verifyTag(runner, {
        object,
        name: 'v0.3.0',
        signers: '# none yet\n',
        sshKeygen: 'ssh-keygen',
      }),
    ).toMatchObject({ ok: false, why: 'no-keys' });
    expect(
      await verifyTag(runner, { object, name: 'v0.3.0', signers: signer('ada', maker) }),
    ).toMatchObject({ ok: false, why: 'no-tool' });
  });
});

function execGit(cwd: string, args: string[], input: string): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, input, encoding: 'utf8' }).trim();
}
