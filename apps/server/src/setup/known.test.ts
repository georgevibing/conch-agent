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
          expect(['winget', 'brew', 'npm', 'uv', 'github']).toContain(recipe.manager);
          // Never a shell, never sudo, never a script from the internet.
          expect(recipe.args.join(' ')).not.toMatch(/sudo|\||curl|iex|;|&&/);
          // Conch's own fetch: only a project's release file, by name.
          if (recipe.manager === 'github') {
            expect(recipe.args[0]).toMatch(/^[\w.-]+\/[\w.-]+$/);
            expect(recipe.args[1]).toMatch(/^[\w.+-]+$/);
          }
          // uv comes first when it isn't here.
          if (recipe.manager === 'uv') expect(recipe.via).toBe('uv');
        }
  });

  it('gets whisper.cpp from its own release where no package manager has it', () => {
    const whisper = KNOWN_NEEDS.get('whisper');
    if (process.arch === 'x64')
      expect(whisper?.install?.win32).toEqual({
        manager: 'github',
        args: ['ggml-org/whisper.cpp', 'whisper-bin-x64.zip', 'whisper-cli'],
      });
    expect(whisper?.install?.darwin).toEqual({ manager: 'brew', args: ['install', 'whisper-cpp'] });
    // Homebrew first on Linux, then the release.
    expect([whisper?.install?.linux].flat()[0]).toMatchObject({ manager: 'brew' });
  });

  it('gets Piper through uv, and FFmpeg through the package manager', () => {
    const piper = KNOWN_NEEDS.get('piper');
    for (const platform of ['win32', 'darwin', 'linux'] as const)
      expect(piper?.install?.[platform]).toEqual({
        manager: 'uv',
        args: ['tool', 'install', 'piper-tts'],
        via: 'uv',
      });
    expect(piper?.update?.('/home/ada/.local/bin/piper', 'linux')).toEqual([
      { manager: 'uv', args: ['tool', 'upgrade', 'piper-tts'], via: 'uv' },
    ]);
    const ffmpeg = KNOWN_NEEDS.get('ffmpeg');
    expect(ffmpeg?.install?.win32).toMatchObject({
      manager: 'winget',
      args: expect.arrayContaining(['Gyan.FFmpeg']),
    });
    expect(ffmpeg?.install?.darwin).toEqual({ manager: 'brew', args: ['install', 'ffmpeg'] });
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

  it('gets GitHub’s program and Git for publishing apps, and keeps them up to date', () => {
    const gh = KNOWN_NEEDS.get('gh');
    expect(gh?.install?.win32).toMatchObject({
      manager: 'winget',
      args: expect.arrayContaining(['--id', 'GitHub.cli']),
    });
    expect(gh?.install?.darwin).toEqual({ manager: 'brew', args: ['install', 'gh'] });
    expect(gh?.download?.linux).toMatch(/^https:\/\/github\.com\/cli\/cli/);
    const winget = String.raw`C:\Users\ada\AppData\Local\Microsoft\WinGet\Links\gh.exe`;
    expect(gh?.update?.(winget, 'win32')[0]?.args.slice(0, 3)).toEqual([
      'upgrade',
      '--id',
      'GitHub.cli',
    ]);
    const git = KNOWN_NEEDS.get('git');
    expect(git?.install?.win32).toMatchObject({
      manager: 'winget',
      args: expect.arrayContaining(['--id', 'Git.Git']),
    });
    expect(git?.install?.darwin).toEqual({ manager: 'brew', args: ['install', 'git'] });
    expect(git?.update?.('/opt/homebrew/Cellar/git/2.51.0/bin/git', 'darwin')).toEqual([
      { manager: 'brew', args: ['upgrade', 'git'] },
    ]);
    for (const need of [gh, git]) {
      expect(need?.version).toBeTypeOf('function');
      expect(need?.latest).toBeTypeOf('function');
    }
  });

  it('looks for Ollama where its installers put it', () => {
    expect(ollamaDirs('win32')[0]).toMatch(/Programs.Ollama$/);
    expect(ollamaDirs('darwin')).toContain('/Applications/Ollama.app/Contents/Resources');
    expect(ollamaDirs('linux')).toContain('/usr/local/bin');
  });
});
