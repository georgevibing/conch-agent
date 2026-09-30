import { delimiter, dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import { needFor, nodeFallback, programName } from './commands';

describe('what an integration’s program needs', () => {
  it('names the program a command starts, and only for bare names', () => {
    expect(programName('uvx')).toBe('uvx');
    expect(programName('npx.cmd')).toBe('npx');
    expect(programName('Docker.EXE')).toBe('docker');
    expect(programName('/usr/local/bin/uvx')).toBeUndefined();
  });

  it('knows which programs Conch can install', () => {
    expect(needFor('uvx')).toBe('uv');
    expect(needFor('docker')).toBe('docker');
    expect(needFor('npx')).toBeUndefined();
    expect(needFor('C:/tools/uvx.exe')).toBeUndefined();
  });

  it('runs npx with Conch’s own Node when the computer has none on PATH', async () => {
    const env = await nodeFallback('npx', { Path: 'C:/old', API_KEY: 'k' }, async () => undefined);
    expect(env.API_KEY).toBe('k');
    // One PATH, whichever way it was spelled, with Conch's Node first.
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['PATH']);
    expect(env.PATH?.split(delimiter)[0]).toBe(dirname(process.execPath));
  });

  it('leaves everything alone when Node is there, or the program isn’t Node’s', async () => {
    const env = { API_KEY: 'k' };
    expect(await nodeFallback('npx', env, async () => '/usr/bin/npx')).toBe(env);
    expect(await nodeFallback('uvx', env, async () => undefined)).toBe(env);
  });
});
