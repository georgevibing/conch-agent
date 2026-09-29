import { afterEach, describe, expect, it } from 'vitest';

import { codexAuth, detectCodex, isAtLeast, MIN_VERSION, parseVersion } from './detect';
import { fakeCodex } from '../../test/fakeCodex';

const originalHome = process.env.CODEX_HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalHome;
});

describe('Codex detection', () => {
  it('reads the version Codex prints, and shrugs at a dev build', () => {
    expect(parseVersion('codex 0.52.0\n')).toBe('0.52.0');
    expect(parseVersion('codex 0.44.0-alpha.3')).toBe('0.44.0-alpha.3');
    expect(parseVersion('codex 9c1f0ab')).toBeUndefined();
  });

  it('compares versions part by part', () => {
    expect(isAtLeast('0.44.0', MIN_VERSION)).toBe(true);
    expect(isAtLeast('0.52.1', MIN_VERSION)).toBe(true);
    expect(isAtLeast('1.0.0', MIN_VERSION)).toBe(true);
    expect(isAtLeast('0.43.9', MIN_VERSION)).toBe(false);
    expect(isAtLeast('0.9.0', MIN_VERSION)).toBe(false);
  });

  it('describes every way Codex can be signed in', () => {
    expect(codexAuth('chatgpt', false)).toEqual({
      method: 'subscription',
      description: 'ChatGPT',
    });
    expect(codexAuth('chatgptAuthTokens', false).method).toBe('subscription');
    expect(codexAuth('apikey', false)).toEqual({
      method: 'api-key',
      description: 'OpenAI API key',
    });
    expect(codexAuth('bedrockAccessKeys', false).description).toBe('Amazon Bedrock');
    expect(codexAuth('personalAccessToken', false)).toEqual({
      method: 'other',
      description: 'Signed in',
    });
    // No auth.json (credentials in the OS keyring) but a key saved in Conch.
    expect(codexAuth(undefined, true).method).toBe('api-key');
    expect(codexAuth(undefined, false).method).toBe('other');
  });

  it('reports not-installed when there is no executable', async () => {
    const status = await detectCodex({ explicitPath: '/nonexistent/codex' });
    expect(status).toMatchObject({ engine: 'codex-cli', label: 'Codex', state: 'not-installed' });
    expect(status.install.map((hint) => hint.command).join(' ')).toContain('@openai/codex');
    expect(status.canSignIn).toBe(true);
  });

  it('reports an error when the program is there but won’t run', async () => {
    const codex = await fakeCodex({ versionFails: true });
    const status = await detectCodex({ explicitPath: codex.bin });
    expect(status.state).toBe('error');
    expect(status.message).toContain('missing shared library');
  });

  it('asks for an update when Codex is too old to read', async () => {
    const codex = await fakeCodex({ version: '0.43.2', signedIn: true });
    const status = await detectCodex({ explicitPath: codex.bin });
    expect(status).toMatchObject({ state: 'error', version: '0.43.2' });
    expect(status.message).toContain('0.44.0 or newer');
    expect(status.message).toContain('npm install -g @openai/codex@latest');
  });

  it('reports signed-out from the exit code of `login status`', async () => {
    const codex = await fakeCodex({ signedIn: false });
    process.env.CODEX_HOME = codex.home;
    const status = await detectCodex({ explicitPath: codex.bin });
    expect(status).toMatchObject({ state: 'signed-out', version: '0.52.0' });
  });

  it('reports ready with the sign-in Codex recorded', async () => {
    const codex = await fakeCodex({ signedIn: true, authMode: 'chatgpt' });
    process.env.CODEX_HOME = codex.home;
    const status = await detectCodex({ explicitPath: codex.bin });
    expect(status).toMatchObject({
      state: 'ready',
      version: '0.52.0',
      auth: { method: 'subscription', description: 'ChatGPT' },
    });
    expect(status.message).toBeUndefined();
    expect((await codex.calls()).map((call) => call.join(' '))).toEqual([
      '--version',
      'login status',
    ]);
  });

  it('treats a key saved in Conch as signed in', async () => {
    const codex = await fakeCodex({ signedIn: false });
    process.env.CODEX_HOME = codex.home;
    const status = await detectCodex({ explicitPath: codex.bin, apiKey: 'sk-proj-test-123456' });
    expect(status).toMatchObject({ state: 'ready', auth: { method: 'api-key' } });
  });

  it('still uses a development build, saying it can’t check the version', async () => {
    const codex = await fakeCodex({ version: '9c1f0ab', signedIn: true, authMode: 'apikey' });
    process.env.CODEX_HOME = codex.home;
    const status = await detectCodex({ explicitPath: codex.bin });
    expect(status.state).toBe('ready');
    expect(status.version).toBeUndefined();
    expect(status.message).toContain('development build');
  });
});
