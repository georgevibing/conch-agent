import { describe, expect, it, vi } from 'vitest';

import { installedBy, KNOWN_NEEDS, latestBy, updateBy } from '../setup/known';
import type { LatestLookup } from '../setup/needs';
import { lookup, parseBrewInfo, parseWingetShow, type Runner } from './latest';

const WINGET_SHOW = `Found Codex CLI [OpenAI.Codex]
Version: 0.160.0
Publisher: OpenAI, Inc.
Moniker: codex
Release Notes Url: https://github.com/openai/codex/releases/tag/rust-v0.160.0`;

const ran = (stdout: string, code = 0) => ({ stdout, stderr: '', code });

describe('asking for the newest version', () => {
  it('asks the npm registry, and names scoped packages safely', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ name: '@openai/codex', version: '0.160.0' }),
    );
    const look = lookup({ fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await look.npm('@openai/codex')).toBe('0.160.0');
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://registry.npmjs.org/@openai%2Fcodex/latest',
    );
    // Never a name that could reach somewhere else.
    expect(await look.npm('../../evil')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats an unreachable registry as “don’t know”, never an error', async () => {
    const offline = lookup({
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
    });
    expect(await offline.npm('@openai/codex')).toBeUndefined();
    const missing = lookup({
      fetch: (async () => new Response('Not found', { status: 404 })) as unknown as typeof fetch,
    });
    expect(await missing.npm('nope')).toBeUndefined();
  });

  it('asks winget with fixed arguments, and reads its Version line', async () => {
    const run = vi.fn<Runner>(async () => ran(WINGET_SHOW));
    const look = lookup({ run, manager: async () => 'C:\\winget.exe' });
    expect(await look.winget('OpenAI.Codex')).toBe('0.160.0');
    expect(run).toHaveBeenCalledWith(
      'C:\\winget.exe',
      [
        'show',
        '--id',
        'OpenAI.Codex',
        '--exact',
        '--source',
        'winget',
        '--accept-source-agreements',
        '--disable-interactivity',
      ],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(await lookup({ run, manager: async () => undefined }).winget('OpenAI.Codex')).toBe(
      undefined,
    );
    expect(await look.winget('bad id; rm -rf')).toBeUndefined();
  });

  it('reads winget in another language by where the version sits', () => {
    expect(parseWingetShow('Gefunden Codex CLI [OpenAI.Codex]\nVersion: 0.160.0\n')).toBe(
      '0.160.0',
    );
    expect(
      parseWingetShow('Trouvé Codex CLI [OpenAI.Codex]\nVersión: 0.161.1\nÉditeur: OpenAI'),
    ).toBe('0.161.1');
    expect(parseWingetShow('No package found matching input criteria.')).toBeUndefined();
  });

  it('asks Homebrew for a formula or a cask', async () => {
    const run = vi.fn<Runner>(async (_file, args) =>
      ran(
        args.includes('--cask')
          ? JSON.stringify({
              formulae: [],
              casks: [{ token: 'claude-code', version: '2.1.290,abc' }],
            })
          : JSON.stringify({ formulae: [{ versions: { stable: '0.8.4' } }], casks: [] }),
      ),
    );
    const look = lookup({ run, manager: async () => '/opt/homebrew/bin/brew' });
    expect(await look.brew('uv')).toBe('0.8.4');
    expect(await look.brew('claude-code', true)).toBe('2.1.290');
    expect(run.mock.calls[0]?.[1]).toEqual(['info', '--json=v2', '--formula', 'uv']);
    expect(parseBrewInfo('not json', false)).toBeUndefined();
  });
});

describe('choosing where to ask', () => {
  const look = (): LatestLookup & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      npm: async (p) => (asked.push(`npm ${p}`), '1.0.0'),
      winget: async (id) => (asked.push(`winget ${id}`), '1.0.0'),
      brew: async (n, cask) => (asked.push(`brew ${n}${cask ? ' cask' : ''}`), '1.0.0'),
    };
  };
  const ids = {
    winget: 'Anthropic.ClaudeCode',
    brew: 'claude-code',
    cask: true,
    npm: '@anthropic-ai/claude-code',
    self: { dirs: ['/.local/bin/'], args: ['update'] },
  };

  it('asks where the program came from: the same judgement as updating it', async () => {
    const where = {
      winget: 'C:\\Users\\ada\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe',
      brew: '/opt/homebrew/Caskroom/claude-code/2.1.0/claude',
      self: '/Users/ada/.local/bin/claude',
      npm: '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    };
    const lookups = look();
    for (const path of Object.values(where)) await latestBy(path, 'win32', ids, lookups);
    expect(lookups.asked).toEqual([
      'winget Anthropic.ClaudeCode',
      'brew claude-code cask',
      'npm @anthropic-ai/claude-code',
      'npm @anthropic-ai/claude-code',
    ]);
    expect(installedBy(where.self, 'darwin', ids)).toBe('self');
    expect(updateBy(where.self, 'darwin', ids)).toEqual([{ manager: 'self', args: ['update'] }]);
    expect(await latestBy('/opt/uv/uvx', 'linux', { winget: 'astral-sh.uv' }, look())).toBe(
      undefined,
    );
  });

  it('knows the version and the newest version of every program with an update', () => {
    for (const spec of KNOWN_NEEDS.values())
      if (spec.update) {
        expect(spec.version, spec.id).toBeTypeOf('function');
        expect(spec.latest, spec.id).toBeTypeOf('function');
      }
  });
});
