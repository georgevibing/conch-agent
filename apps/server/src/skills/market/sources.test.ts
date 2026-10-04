/**
 * The places Discover asks (ADR 0074), against pretend servers: every byte is
 * checked against the pin, nothing leaves the source's own hosts, and a
 * hostile index — a path out of the folder, a link, a file twice, a
 * different file under the same name — stops the download.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { AnthropicSource } from './anthropic';
import { bundleHash, ClawHubSource, SkillsShSource, versionVerdict } from './clawhub';
import { blobSha, GitHubSkills } from './github';
import { MarketError } from './http';
import { licenseOf } from './license';
import { plainLine } from './types';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '140.82.112.6', family: 4 }]),
}));

const COMMIT = 'c0ffee'.padEnd(40, '0');
const deps = { version: 'test' };

type Route = unknown;
/** A pretend web: `routes` maps `host + path + query` to JSON, text, a status or a Response. */
function web(routes: Record<string, Route>) {
  const asked: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const key = `${url.hostname}${url.pathname}${url.search}`;
    asked.push(key);
    const route = routes[key];
    if (route === undefined) return Response.json({ message: 'Not Found' }, { status: 404 });
    if (typeof route === 'function') return (route as () => Response)();
    if (typeof route === 'number') return new Response('no', { status: route });
    if (typeof route === 'string') return new Response(route);
    if (Buffer.isBuffer(route)) return new Response(new Uint8Array(route));
    return Response.json(route);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, asked };
}

const skillMd = (name: string, extra = '') =>
  `---\nname: ${name}\ndescription: Does ${name} things. Use when asked.\n${extra}---\n\n# ${name}\n\nSteps.\n`;

/** A repository at COMMIT, its tree and its raw files. */
function repo(
  owner: string,
  name: string,
  files: Record<string, string>,
  extraTree: object[] = [],
) {
  const routes: Record<string, Route> = {
    [`api.github.com/repos/${owner}/${name}/commits/HEAD`]: COMMIT,
    [`api.github.com/repos/${owner}/${name}/git/trees/${COMMIT}?recursive=1`]: {
      tree: [
        ...Object.entries(files).map(([path, text]) => ({
          path,
          type: 'blob',
          mode: '100644',
          sha: blobSha(Buffer.from(text)),
          size: Buffer.byteLength(text),
        })),
        ...extraTree,
      ],
    },
  };
  for (const [path, text] of Object.entries(files))
    routes[`raw.githubusercontent.com/${owner}/${name}/${COMMIT}/${path}`] = text;
  return routes;
}

describe('GitHub, file by file at a commit', () => {
  it('downloads a skill folder and checks every file against git’s hash', async () => {
    const { fetch } = web(
      repo('ada', 'tools', {
        'skills/notes/SKILL.md': skillMd('notes'),
        'skills/notes/references/a.md': 'A',
        'skills/other/SKILL.md': skillMd('other'),
      }),
    );
    const github = new GitHubSkills({ ...deps, fetch });
    const commit = await github.head('ada', 'tools');
    const { files, content } = await github.folder('ada', 'tools', commit, 'skills/notes');
    expect([...files.keys()].sort()).toEqual(['SKILL.md', 'references/a.md']);
    expect(content).toBe(await github.content('ada', 'tools', commit, 'skills/notes'));
  });

  it('a source that serves different bytes than the commit holds: nothing is added', async () => {
    const routes = repo('ada', 'tools', { 'skills/notes/SKILL.md': skillMd('notes') });
    routes[`raw.githubusercontent.com/ada/tools/${COMMIT}/skills/notes/SKILL.md`] = skillMd(
      'notes',
      'evil: yes\n',
    );
    const github = new GitHubSkills({ ...deps, fetch: web(routes).fetch });
    await expect(github.folder('ada', 'tools', COMMIT, 'skills/notes')).rejects.toMatchObject({
      code: 'changed',
    });
  });

  it('never fetches links, submodules or hidden files', async () => {
    const { fetch, asked } = web(
      repo(
        'ada',
        'tools',
        { 'skills/notes/SKILL.md': skillMd('notes'), 'skills/notes/.env': 'KEY=1' },
        [
          { path: 'skills/notes/home', type: 'blob', mode: '120000', sha: 'a'.repeat(40), size: 6 },
          { path: 'skills/notes/vendored', type: 'commit', mode: '160000', sha: 'b'.repeat(40) },
        ],
      ),
    );
    const github = new GitHubSkills({ ...deps, fetch });
    const { files } = await github.folder('ada', 'tools', COMMIT, 'skills/notes');
    expect([...files.keys()]).toEqual(['SKILL.md']);
    expect(asked.some((a) => /home|vendored|\.env/.test(a))).toBe(false);
  });

  it.each([
    ['a path that climbs out', 'skills/notes/../../../.bashrc'],
    ['a Windows device name', 'skills/notes/CON'],
    ['a drive or stream', 'skills/notes/C:evil'],
    ['a backslash', 'skills/notes/a\\..\\b'],
  ])('refuses %s in the folder', async (_what, path) => {
    const github = new GitHubSkills({
      ...deps,
      fetch: web(
        repo('ada', 'tools', { 'skills/notes/SKILL.md': skillMd('notes') }, [
          { path, type: 'blob', mode: '100644', sha: 'c'.repeat(40), size: 3 },
        ]),
      ).fetch,
    });
    await expect(github.folder('ada', 'tools', COMMIT, 'skills/notes')).rejects.toMatchObject({
      code: 'refused',
    });
  });

  it('refuses a file twice in different cases, and a skill that’s too big', async () => {
    const twice = new GitHubSkills({
      ...deps,
      fetch: web(repo('ada', 'tools', { 'n/SKILL.md': skillMd('n'), 'n/a.md': 'a', 'n/A.md': 'A' }))
        .fetch,
    });
    await expect(twice.folder('ada', 'tools', COMMIT, 'n')).rejects.toMatchObject({
      code: 'refused',
    });
    const many: Record<string, string> = { 'n/SKILL.md': skillMd('n') };
    for (let i = 0; i < 201; i++) many[`n/f${i}.md`] = 'x';
    const big = new GitHubSkills({ ...deps, fetch: web(repo('ada', 'tools', many)).fetch });
    await expect(big.folder('ada', 'tools', COMMIT, 'n')).rejects.toMatchObject({
      code: 'too-big',
    });
  });

  it('a redirect to another host stops there', async () => {
    const routes = repo('ada', 'tools', { 'n/SKILL.md': skillMd('n') });
    routes[`raw.githubusercontent.com/ada/tools/${COMMIT}/n/SKILL.md`] = () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example/SKILL.md' } });
    const github = new GitHubSkills({ ...deps, fetch: web(routes).fetch });
    await expect(github.folder('ada', 'tools', COMMIT, 'n')).rejects.toMatchObject({
      code: 'refused',
    });
  });

  it('a name that isn’t a repository never reaches GitHub', async () => {
    const { fetch, asked } = web({});
    const github = new GitHubSkills({ ...deps, fetch });
    await expect(github.head('../etc', 'passwd')).rejects.toBeInstanceOf(MarketError);
    expect(asked).toEqual([]);
  });

  it('GitHub asking to wait is `limited`, with when', async () => {
    const github = new GitHubSkills({
      ...deps,
      now: () => 1_000,
      fetch: web({
        'api.github.com/repos/ada/tools/commits/HEAD': () =>
          new Response('{}', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5000' },
          }),
      }).fetch,
    });
    await expect(github.head('ada', 'tools')).rejects.toMatchObject({
      code: 'limited',
      retryAt: 5_000_000,
    });
  });
});

describe('Anthropic’s skills', () => {
  it('lists the openly licensed ones and leaves the source-available ones where they are', async () => {
    const { fetch } = web(
      repo('anthropics', 'skills', {
        'skills/canvas-design/SKILL.md': skillMd(
          'canvas-design',
          'license: Complete terms in LICENSE.txt\n',
        ),
        'skills/canvas-design/LICENSE.txt': 'Apache License\nVersion 2.0, January 2004',
        'skills/docx/SKILL.md': skillMd(
          'docx',
          'license: Proprietary. LICENSE.txt has complete terms\n',
        ),
        'skills/docx/LICENSE.txt': '© 2025 Anthropic, PBC. All rights reserved.',
        'README.md': '# Skills',
      }),
    );
    const source = new AnthropicSource(new GitHubSkills({ ...deps, fetch }));
    const found = await source.search('');
    expect(found.map((l) => l.id)).toEqual(['anthropic:canvas-design']);
    expect(found[0]).toMatchObject({ trust: 'official', publisher: { name: 'Anthropic' } });
    const fetched = await source.fetch('canvas-design');
    expect(fetched.pin).toMatchObject({
      kind: 'commit',
      commit: COMMIT,
      path: 'skills/canvas-design',
    });
    await expect(source.fetch('docx')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('ClawHub', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const files = { 'SKILL.md': skillMd('meeting-notes'), 'skill-card.md': '# Card' };
  const manifest = (over: object = {}) => ({
    version: {
      version: '1.0.0',
      license: 'MIT-0',
      files: Object.entries(files).map(([path, text]) => ({
        path,
        size: Buffer.byteLength(text),
        sha256: sha(text),
      })),
      security: { status: 'clean', scanners: { vt: { status: 'clean' } } },
      ...over,
    },
  });
  const routes = (version: object = manifest(), served: Record<string, string> = files) => ({
    'clawhub.ai/api/v1/skills/meeting-notes?ownerHandle=ada': {
      skill: {
        slug: 'meeting-notes',
        displayName: 'Meeting notes',
        summary: 'Tidies notes.',
        stats: { installs: 5 },
      },
      latestVersion: { version: '1.0.0' },
      owner: { handle: 'ada', displayName: 'Ada' },
      moderation: null,
    },
    'clawhub.ai/api/v1/skills/meeting-notes/versions/1.0.0?ownerHandle=ada': version,
    ...Object.fromEntries(
      Object.entries(served).map(([path, text]) => [
        `clawhub.ai/api/v1/skills/meeting-notes/file?path=${encodeURIComponent(path)}&version=1.0.0&ownerHandle=ada`,
        text,
      ]),
    ),
  });

  it('pins a version and checks every file against its SHA-256; ClawHub’s own card stays out', async () => {
    const hub = new ClawHubSource({ ...deps, fetch: web(routes()).fetch });
    const fetched = await hub.fetch('ada/meeting-notes');
    expect([...fetched.files.keys()]).toEqual(['SKILL.md']);
    expect(fetched.pin).toEqual({
      kind: 'version',
      version: '1.0.0',
      sha256: bundleHash([{ path: 'SKILL.md', sha256: sha(files['SKILL.md']) }]),
    });
    expect(fetched.licenseHint).toBe('MIT-0');
  });

  it('a file that isn’t what the version lists: nothing is added', async () => {
    const hub = new ClawHubSource({
      ...deps,
      fetch: web(routes(manifest(), { 'SKILL.md': `${files['SKILL.md']}\nRun this too.` })).fetch,
    });
    await expect(hub.fetch('ada/meeting-notes')).rejects.toMatchObject({ code: 'changed' });
  });

  it('a path out of the folder in the version’s list is refused before anything is fetched', async () => {
    const bad = manifest({
      files: [
        { path: 'SKILL.md', size: 1, sha256: 'a'.repeat(64) },
        { path: '../../.zshrc', size: 1, sha256: 'b'.repeat(64) },
      ],
    });
    const { fetch, asked } = web(routes(bad));
    const hub = new ClawHubSource({ ...deps, fetch });
    await expect(hub.fetch('ada/meeting-notes')).rejects.toMatchObject({ code: 'refused' });
    expect(asked.some((a) => a.includes('/file?'))).toBe(false);
  });

  it('what its scanners say: malicious is never added, “don’t install” is a warning', () => {
    expect(versionVerdict({ status: 'malicious' }, {}).blocked).toBeTruthy();
    expect(versionVerdict({ status: 'clean' }, { isMalwareBlocked: true }).trust).toBe('blocked');
    expect(
      versionVerdict(
        { status: 'clean', scanners: { s: { recommendation: 'DO_NOT_INSTALL' } } },
        {},
      ),
    ).toMatchObject({ trust: 'flagged', warning: expect.stringContaining('not to install') });
    expect(versionVerdict({ status: 'clean', hasWarnings: true }, {})).toEqual({});
  });

  it('a blocked version comes back blocked, with ClawHub’s reason', async () => {
    const hub = new ClawHubSource({
      ...deps,
      fetch: web(routes(manifest({ security: { status: 'malicious' } }))).fetch,
    });
    const fetched = await hub.fetch('ada/meeting-notes');
    expect(fetched.blocked).toMatch(/harmful code/);
    expect(fetched.listing.trust).toBe('blocked');
  });

  it('search: its own skills and skills.sh’s, with their checks; nonsense ids are dropped', async () => {
    const { fetch, asked } = web({
      'clawhub.ai/api/v1/search?q=notes&limit=30&nonSuspiciousOnly=true': {
        results: [
          {
            source: 'clawhub',
            slug: 'meeting-notes',
            ownerHandle: 'ada',
            displayName: 'meeting-notes',
            summary: '# Meeting Notes ## Overview Tidies notes into **actions**.',
            publisher: { displayName: 'Ada', official: true },
            native: { skill: { isSuspicious: false, stats: { installs: 7, stars: 2 } } },
          },
          {
            source: 'skills-sh',
            displayName: 'notes-pro',
            summary: 'Notes.',
            sourceIdentity: { id: 'bob/skills/notes-pro', lifetimeInstalls: 99 },
            trust: { upstreamScanners: { snyk: { status: 'fail' } } },
          },
          { source: 'skills-sh', sourceIdentity: { id: '../../etc' } },
          { source: 'clawhub', slug: '../x', ownerHandle: 'ada' },
        ],
      },
    });
    const hub = new ClawHubSource({ ...deps, fetch });
    const found = await hub.search('notes');
    expect(asked[0]).toContain('nonSuspiciousOnly=true');
    expect(found).toEqual([
      expect.objectContaining({
        id: 'clawhub:ada/meeting-notes',
        trust: 'verified',
        description: 'Tidies notes into actions.',
        installs: 7,
      }),
      expect.objectContaining({
        id: 'skills-sh:bob/skills/notes-pro',
        trust: 'flagged',
        installs: 99,
      }),
    ]);
  });

  it('skills.sh’s skills come from GitHub at a commit, found by their folder', async () => {
    const { fetch } = web({
      ...repo('bob', 'skills', {
        'skills/notes-pro/SKILL.md': skillMd('notes-pro'),
        LICENSE: 'MIT License\n\nPermission is hereby granted, free of charge',
        'skills/other/SKILL.md': skillMd('other'),
      }),
      'clawhub.ai/api/v1/search?q=notes-pro&limit=30&nonSuspiciousOnly=true': { results: [] },
    });
    const github = new GitHubSkills({ ...deps, fetch });
    const source = new SkillsShSource(github, new ClawHubSource({ ...deps, fetch }));
    const fetched = await source.fetch('bob/skills/notes-pro');
    expect(fetched.pin).toEqual({
      kind: 'commit',
      owner: 'bob',
      repo: 'skills',
      path: 'skills/notes-pro',
      commit: COMMIT,
    });
    expect(fetched.listing.description).toBe('Does notes-pro things. Use when asked.');
    // No licence in the folder: the repository's own is the hint.
    expect(licenseOf(fetched.files, fetched.licenseHint)).toEqual({ kind: 'open', name: 'MIT' });
  });
});

describe('licences and card text', () => {
  const files = (skill: string, license?: string) =>
    new Map<string, Buffer>([
      ['SKILL.md', Buffer.from(skill)],
      ...(license ? ([['LICENSE.txt', Buffer.from(license)]] as [string, Buffer][]) : []),
    ]);

  it('the skill’s own words beat the registry’s label', () => {
    // A copy of a proprietary skill republished on a registry that stamps everything MIT-0.
    expect(
      licenseOf(
        files(skillMd('pdf', 'license: Proprietary. LICENSE.txt has complete terms\n')),
        'MIT-0',
      ),
    ).toEqual({
      kind: 'restricted',
      name: 'Proprietary',
    });
    expect(licenseOf(files(skillMd('a', 'license: Apache-2.0\n')))).toEqual({
      kind: 'open',
      name: 'Apache-2.0',
    });
    expect(
      licenseOf(files(skillMd('a'), 'MIT License\n\nPermission is hereby granted, free of charge')),
    ).toEqual({
      kind: 'open',
      name: 'MIT',
    });
    expect(licenseOf(files(skillMd('a')))).toEqual({ kind: 'unknown' });
    expect(licenseOf(files(skillMd('a')), 'MIT-0')).toEqual({ kind: 'open', name: 'MIT-0' });
    expect(
      licenseOf(
        files(
          skillMd('a'),
          'Copyright (c) 2026, Ada\nAll rights reserved.\n\nRedistribution and use in source and binary forms',
        ),
      ),
    ).toEqual({ kind: 'open', name: 'BSD' });
  });

  it('a summary that starts with its own title reads as a plain line', () => {
    expect(
      plainLine('# Meeting Notes ## Overview This skill transforms raw notes. **Use Cases:** more'),
    ).toBe('This skill transforms raw notes. Use Cases: more');
    expect(plainLine('a'.repeat(300)).length).toBeLessThanOrEqual(240);
  });
});
