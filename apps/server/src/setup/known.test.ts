import { describe, expect, it } from 'vitest';

import { KNOWN_NEEDS, ollamaDirs, updateBy } from './known';

describe('what Conch knows how to get', () => {
  it('updates a program the way it was installed', () => {
    const ids = { winget: 'OpenAI.Codex', brew: 'codex', npm: '@openai/codex' };
    const [viaWinget] = updateBy(
      'C:\\Users\\ada\\AppData\\Local\\Microsoft\\WinGet\\Links\\codex.exe',
      'win32',
      ids,
    );
    expect(viaWinget?.manager).toBe('winget');
    expect(viaWinget?.args.slice(0, 3)).toEqual(['upgrade', '--id', 'OpenAI.Codex']);
    expect(updateBy('/opt/homebrew/Cellar/codex/0.50.0/bin/codex', 'darwin', ids)[0]).toEqual({
      manager: 'brew',
      args: ['upgrade', 'codex'],
    });
    expect(updateBy('/usr/lib/node_modules/@openai/codex/bin/codex.js', 'linux', ids)[0]).toEqual({
      manager: 'npm',
      args: ['install', '--global', '@openai/codex@latest'],
    });
    expect(updateBy('/somewhere/codex', 'linux', { winget: 'X' })).toEqual([]);
  });

  it('installs only through package managers that need no administrator', () => {
    for (const spec of KNOWN_NEEDS.values())
      for (const recipes of Object.values(spec.install ?? {}))
        for (const recipe of [recipes].flat()) {
          expect(['winget', 'brew', 'npm']).toContain(recipe.manager);
          // Never a shell, never sudo, never a script from the internet.
          expect(recipe.args.join(' ')).not.toMatch(/sudo|\||curl|iex|;|&&/);
        }
  });

  it('gives every need somewhere to get it by hand', () => {
    for (const spec of KNOWN_NEEDS.values())
      if (!spec.comesWith) expect(Object.keys(spec.download ?? {})).toContain('linux');
  });

  it('gets Ollama without an administrator, and links Linux to the page', () => {
    const ollama = KNOWN_NEEDS.get('ollama');
    expect(ollama?.install?.win32).toMatchObject({
      manager: 'winget',
      args: expect.arrayContaining(['--id', 'Ollama.Ollama', '--exact']),
    });
    // The cask was renamed from `ollama` in 2026.
    expect(ollama?.install?.darwin).toEqual({
      manager: 'brew',
      args: ['install', '--cask', 'ollama-app'],
    });
    // Linux's installer is a script run with sudo: never piped, only linked.
    expect(ollama?.install?.linux).toBeUndefined();
    expect(ollama?.download?.linux).toBe('https://docs.ollama.com/linux');
    const program = String.raw`C:\Users\ada\AppData\Local\Programs\Ollama\ollama.exe`;
    expect(ollama?.update?.(program, 'win32')[0]?.args.slice(0, 3)).toEqual([
      'upgrade',
      '--id',
      'Ollama.Ollama',
    ]);
  });

  it('looks for Ollama where its installers put it', () => {
    expect(ollamaDirs('win32')[0]).toMatch(/Programs.Ollama$/);
    expect(ollamaDirs('darwin')).toContain('/Applications/Ollama.app/Contents/Resources');
    expect(ollamaDirs('linux')).toContain('/usr/local/bin');
  });
});
