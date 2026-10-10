import { describe, expect, it, vi } from 'vitest';

import { describesChannel, publications, selectPublication } from '../../publishing/select';
import { verifyPublication } from '../../publishing/verify';
import { SitePublication } from '../../publishing/schema';

const main = 'a'.repeat(40);
const signed = 'b'.repeat(40);
const release = (tag: string, overrides = {}) => ({
  tag_name: tag,
  name: `Conch ${tag}`,
  body: '## New\n\n- A useful change.',
  draft: false,
  prerelease: tag.includes('-'),
  published_at: '2026-10-05T10:00:00Z',
  assets: [],
  ...overrides,
});

describe('the version the public site describes', () => {
  it('uses validated main before the first release', async () => {
    const verify = vi.fn().mockResolvedValue(signed);
    const empty = selectPublication(await publications([], verify), main);
    expect(empty).toEqual({ channel: 'development', commit: main, next: false, releases: [] });
    expect(verify).not.toHaveBeenCalled();
  });

  it('describes the newest release of the steadiest channel there is: alpha, then beta, then stable', async () => {
    const verify = async () => signed;
    const alphas = selectPublication(
      await publications([release('v0.1.0-alpha.1'), release('v0.1.0-alpha.2')], verify),
      main,
    );
    expect(alphas).toMatchObject({ channel: 'alpha', tag: 'v0.1.0-alpha.2', commit: signed });
    expect(SitePublication.parse(alphas)).toEqual(alphas);
    // A beta is steadier than a newer alpha.
    const betas = selectPublication(
      await publications(
        [release('v0.2.0-alpha.1'), release('v0.1.0-beta.1'), release('v0.1.0-alpha.3')],
        verify,
      ),
      main,
    );
    expect(betas).toMatchObject({ channel: 'beta', tag: 'v0.1.0-beta.1' });
    expect(betas.releases.map((r) => r.channel)).toEqual(['alpha', 'beta', 'alpha']);
  });

  it('stays on validated main when the release’s own site can’t describe its channel', async () => {
    const releases = await publications([release('v0.1.0-alpha.1')], async () => signed);
    const selected = selectPublication(releases, main, () => false);
    expect(selected).toMatchObject({ channel: 'development', commit: main });
    expect(selected.tag).toBeUndefined();
  });

  it('knows which sites can describe a pre-release', () => {
    const before = `export const SitePublication = z.object({\n  channel: z.enum(['stable', 'development']),\n`;
    const after = `export const SitePublication = z.object({\n  /** Its channel. */\n  channel: z.enum(['stable', 'beta', 'alpha', 'development']),\n`;
    expect(describesChannel(before, 'stable')).toBe(true);
    expect(describesChannel(before, 'alpha')).toBe(false);
    expect(describesChannel(after, 'alpha')).toBe(true);
    expect(describesChannel(after, 'beta')).toBe(true);
  });

  it('chooses the highest stable semver once there is one, over newer prereleases', async () => {
    const releases = await publications(
      [
        release('v0.9.0'),
        release('v0.11.0-beta.1'),
        release('v0.10.0'),
        release('v0.10.0-alpha.10'),
        release('v0.10.0-alpha.2'),
      ],
      async () => signed,
    );
    const selected = selectPublication(releases, main);
    expect(selected).toMatchObject({ tag: 'v0.10.0', channel: 'stable', commit: signed });
    expect(releases.map((r) => r.tag)).toEqual([
      'v0.11.0-beta.1',
      'v0.10.0',
      'v0.10.0-alpha.10',
      'v0.10.0-alpha.2',
      'v0.9.0',
    ]);
  });

  it('excludes drafts and unrelated tags without executing a Git lookup for them', async () => {
    const verify = vi.fn().mockResolvedValue(signed);
    expect(
      await publications(
        [
          release('v9.0.0', { draft: true }),
          release('--upload-pack=evil'),
          release('v1.0.0 '),
          release('v01.0.0'),
        ],
        verify,
      ),
    ).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed for malformed API results, contradictory flags and failed signature verification', async () => {
    const verify = vi.fn().mockRejectedValue(new Error('Not signed by a trusted key'));
    await expect(publications({ message: 'Rate limited' }, verify)).rejects.toThrow();
    await expect(publications([release('v1.0.0', { prerelease: true })], verify)).rejects.toThrow(
      'inconsistent',
    );
    await expect(
      publications([release('v1.0.0-beta.1', { prerelease: false })], verify),
    ).rejects.toThrow('inconsistent');
    await expect(publications([release('v1.0.0', { published_at: null })], verify)).rejects.toThrow(
      'inconsistent',
    );
    await expect(publications([release('v1.0.0')], verify)).rejects.toThrow('trusted key');
  });

  it('offers downloads only for nonempty uploaded desktop assets and preserves notes', async () => {
    const read = async (assets: unknown[]) =>
      (await publications([release('v1.0.0', { assets })], async () => signed))[0];
    expect((await read([]))?.downloads).toBe(false);
    expect((await read([{ name: 'latest.yml', state: 'uploaded', size: 50 }]))?.downloads).toBe(
      false,
    );
    expect((await read([{ name: 'Conch.dmg', state: 'new', size: 100 }]))?.downloads).toBe(false);
    expect((await read([{ name: 'Conch.dmg', state: 'uploaded', size: 0 }]))?.downloads).toBe(
      false,
    );
    expect(await read([{ name: 'Conch.dmg', state: 'uploaded', size: 100 }])).toMatchObject({
      downloads: true,
      notes: '## New\n\n- A useful change.',
    });
  });
});

describe('published source verification', () => {
  it('never trusts a release’s own keys outside accepted main history', async () => {
    const git = vi.fn(async (args: string[]) => ({
      code: args[0] === 'merge-base' ? 1 : 0,
      stdout: 'b'.repeat(40),
      stderr: '',
    }));
    await expect(verifyPublication(git, 'v1.0.0')).rejects.toThrow('trusted main history');
    expect(git.mock.calls.some(([args]) => args[0] === 'show')).toBe(false);
  });

  it('rejects an unsigned tag even when its commit belongs to main', async () => {
    const git = vi.fn(async (args: string[]) => ({
      code: 0,
      stdout: args[0] === 'cat-file' ? 'commit' : args[0] === 'rev-parse' ? 'b'.repeat(40) : '',
      stderr: '',
    }));
    await expect(verifyPublication(git, 'v1.0.0')).rejects.toThrow('isn’t signed');
  });
});

it('checks a historical release with its accepted historical key, including after rotation', async () => {
  const object = 'b'.repeat(40);
  const commit = 'c'.repeat(40);
  const argsSeen: string[][] = [];
  const found = await verifyPublication(async (args) => {
    argsSeen.push(args);
    const text =
      args[0] === 'rev-parse'
        ? args[2]?.endsWith('^{commit}')
          ? commit
          : object
        : args[0] === 'cat-file' && args[1] === '-t'
          ? 'tag'
          : args[0] === 'cat-file'
            ? `object ${commit}\ntype commit\ntag v1.0.0\n\nNotes\n-----BEGIN SSH SIGNATURE-----`
            : args[0] === 'show' && args[1]?.endsWith('package.json')
              ? '{"version":"1.0.0"}'
              : args[0] === 'show'
                ? 'conch namespaces="git" ssh-ed25519 AAAA'
                : args.includes('verify-tag')
                  ? 'Good "git" signature for conch with ED25519 key SHA256:abcdef'
                  : '';
    return { code: 0, stdout: text, stderr: '' };
  }, 'v1.0.0');
  expect(found).toBe(commit);
  expect(argsSeen).toContainEqual(['show', `${commit}:release/allowed_signers`]);
  expect(argsSeen).toContainEqual(['merge-base', '--is-ancestor', commit, 'HEAD']);
});
