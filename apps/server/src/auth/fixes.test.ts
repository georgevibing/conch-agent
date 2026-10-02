import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { CheckupAction, type CheckupItem } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import {
  checkup,
  findTokenProfile,
  removeTokenCommand,
  setAsideWorkspaceRules,
  workspaceRuleFiles,
} from './checkup';
import type { AccessFile } from './store';

// Password hashing is deliberately slow (scrypt, N=2^17); shared CI runners need headroom.
vi.setConfig({ testTimeout: 20_000 });

const PASSWORD = 'purple otters juggle at dawn';
const REMOTE = { remoteAddress: '192.168.1.20', host: 'conch.example' };

async function setup(env: Record<string, string> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-fix-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
    CONCH_ALLOWED_HOSTS: 'conch.example',
    ...env,
  });
  const services = new Services(config);
  const app = await buildApp(services);
  close = () => app.close();
  return { app, services, home };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

type App = Awaited<ReturnType<typeof setup>>['app'];

const fix = (app: App, action: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/access/fix', headers, payload: { action } });

const findings = async (app: App): Promise<CheckupItem[]> =>
  (await app.inject('/api/access')).json().checkup;

const ids = (items: CheckupItem[]) => items.map((i) => i.id);

const access = (patch: Partial<AccessFile> = {}): AccessFile => ({
  version: 1,
  method: 'none',
  keys: [],
  sessions: [],
  pairings: [],
  approval: false,
  devices: [],
  requests: [],
  ...patch,
});

describe('checkup findings', () => {
  const everything = () =>
    checkup({
      config: loadConfig({
        CONCH_HOME: join(tmpdir(), 'conch-x'),
        CONCH_HOST: '0.0.0.0',
        CONCH_ALLOW_REMOTE: '1',
        CONCH_TOKEN: 'a-token-long-enough-to-pass',
      }),
      access: access({
        keys: [{ id: 'key_1', name: 'Old', hash: 'h', hint: 'abcd', createdAt: 0 }],
      }),
      permissionMode: 'bypassPermissions',
      secure: false,
      homeProblems: ['/home/ada/.conch/access.json'],
      workspaceRules: ['hooks that run commands'],
      trustedIntegrations: ['GitHub'],
      terminalRemote: true,
      browserLocal: true,
      pagesLocal: ['localhost:3000'],
      provider: { name: 'Codex', asksFirst: false },
      platform: 'linux',
      channels: [
        { app: 'Telegram', bot: '@adas_conch_bot', others: ['Grace Hopper'] },
        { app: 'Slack', bot: 'Conch', others: [] },
      ],
    });

  it('offer every problem one thing to press or copy', () => {
    const items = everything();
    for (const item of items.filter((i) => i.level !== 'ok'))
      expect(item.fix ?? item.command, item.id).toBeTruthy();
  });

  it('carry the right fix for each finding', () => {
    const byId = Object.fromEntries(everything().map((i) => [i.id, i.fix]));
    expect(byId).toMatchObject({
      'sign-in': { kind: 'open', place: 'sign-in', label: 'Choose a password' },
      encryption: { kind: 'open', place: 'reach' },
      'env-token': { kind: 'open', place: 'keys', label: 'Create a key' },
      'full-trust': { kind: 'act', action: 'ask-first', label: 'Ask first' },
      'workspace-rules': { kind: 'act', action: 'workspace-rules-off' },
      'provider-prompts': { kind: 'open', place: 'models' },
      'trusted-integrations': { kind: 'act', action: 'integrations-ask' },
      'terminal-remote': { kind: 'act', action: 'terminal-remote-off' },
      'browser-local': { kind: 'act', action: 'browser-local-off' },
      'pages-local': { kind: 'open', place: 'live-data', label: 'Review' },
      'stale-keys': { kind: 'open', place: 'keys', label: 'Review keys' },
      files: { kind: 'act', action: 'secure-files' },
      'channels-full-trust': { kind: 'act', action: 'ask-first', label: 'Ask first' },
      'channel-people': { kind: 'open', place: 'channels' },
    });
  });

  it('name the chat apps and the people let in, in plain words', () => {
    const items = everything();
    expect(items.find((i) => i.id === 'channels-full-trust')?.title).toBe(
      'Messages from Telegram and Slack run without asking',
    );
    expect(items.find((i) => i.id === 'channel-people')?.title).toBe(
      'Grace Hopper can use your assistant from Telegram',
    );
  });

  it('never offer a one-click fix for something that already passes', () => {
    const items = checkup({
      config: loadConfig({ CONCH_HOME: join(tmpdir(), 'conch-y') }),
      access: access({ method: 'password' }),
      permissionMode: 'default',
      secure: true,
      homeProblems: [],
    });
    expect(items.every((i) => i.level === 'ok' && !i.fix)).toBe(true);
  });

  it('show the one line that removes CONCH_TOKEN where it is set', async () => {
    expect(removeTokenCommand('win32')).toBe(
      `[Environment]::SetEnvironmentVariable('CONCH_TOKEN', $null, 'User')`,
    );
    expect(removeTokenCommand('darwin')).toBe('unset CONCH_TOKEN');
    expect(removeTokenCommand('linux', '~/.zshrc')).toBe(`sed -i.bak '/CONCH_TOKEN/d' ~/.zshrc`);

    const home = await mkdtemp(join(tmpdir(), 'conch-profile-'));
    expect(await findTokenProfile(home)).toBeUndefined();
    await writeFile(join(home, '.bashrc'), '# CONCH_TOKEN is not set here\nalias ll="ls -l"\n');
    expect(await findTokenProfile(home)).toBeUndefined();
    await writeFile(join(home, '.zshrc'), 'export PATH=$PATH:~/bin\nexport CONCH_TOKEN=abc\n');
    expect(await findTokenProfile(home)).toBe('~/.zshrc');

    // Someone who signs in another way just removes it; nobody is sent to make a key.
    const item = checkup({
      config: loadConfig({ CONCH_HOME: home, CONCH_TOKEN: 'a-token-long-enough-to-pass' }),
      access: access({ method: 'password' }),
      permissionMode: 'default',
      secure: true,
      homeProblems: [],
      tokenProfile: '~/.zshrc',
      platform: 'linux',
    }).find((i) => i.id === 'env-token');
    expect(item?.fix).toBeUndefined();
    expect(item?.command).toBe(`sed -i.bak '/CONCH_TOKEN/d' ~/.zshrc`);
  });
});

describe('work folder rules', () => {
  it('are set aside by renaming, never deleted, and never over an older copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-ws-'));
    await mkdir(join(dir, '.claude'));
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [] } }));
    await writeFile(join(dir, '.claude', 'settings.json.off'), 'an older copy');
    await writeFile(join(dir, '.claude', 'settings.local.json'), JSON.stringify({ model: 'x' }));
    await writeFile(join(dir, '.mcp.json'), '{}');
    expect((await workspaceRuleFiles(dir)).map((f) => f.file)).toEqual([
      '.claude/settings.json',
      '.mcp.json',
    ]);

    expect(await setAsideWorkspaceRules(dir)).toEqual([
      '.claude/settings.json.off-2',
      '.mcp.json.off',
    ]);
    expect(await workspaceRuleFiles(dir)).toEqual([]);
    expect(await readFile(join(dir, '.claude', 'settings.json.off'), 'utf8')).toBe('an older copy');
    expect(await readFile(join(dir, '.claude', 'settings.json.off-2'), 'utf8')).toContain('hooks');
    // Harmless settings stay where they are.
    expect((await stat(join(dir, '.claude', 'settings.local.json'))).isFile()).toBe(true);
  });
});

describe('POST /api/access/fix', () => {
  it('goes back to asking first, and the finding goes away', async () => {
    const { app, services } = await setup();
    await services.settings.update({ preferences: { permissionMode: 'bypassPermissions' } });
    expect(ids(await findings(app))).toContain('full-trust');

    const res = await fix(app, 'ask-first');
    expect(res.statusCode).toBe(200);
    expect(res.json().done).toBe('New chats ask before acting.');
    expect(ids(res.json().access.checkup)).not.toContain('full-trust');
    expect((await services.settings.get()).preferences.permissionMode).toBe('default');
  });

  it('never loosens a choice that is already safer', async () => {
    const { app, services } = await setup();
    await services.settings.update({ preferences: { permissionMode: 'plan' } });
    expect((await fix(app, 'ask-first')).statusCode).toBe(200);
    expect((await services.settings.get()).preferences.permissionMode).toBe('plan');
    await services.browser.updateSettings({ allowLocal: false });
    await fix(app, 'browser-local-off');
    expect((await services.browser.store.settings()).allowLocal).toBe(false);
    await services.terminal.updateSettings({ allowRemote: false });
    await fix(app, 'terminal-remote-off');
    expect((await services.terminal.settings()).allowRemote).toBe(false);
  });

  it('keeps the browser off local apps', async () => {
    const { app, services } = await setup();
    await services.browser.updateSettings({ allowLocal: true });
    expect(ids(await findings(app))).toContain('browser-local');
    const res = await fix(app, 'browser-local-off');
    expect(res.json().done).toBe('The browser can’t open local apps now.');
    expect(ids(res.json().access.checkup)).not.toContain('browser-local');
    expect((await services.browser.store.settings()).allowLocal).toBe(false);
  });

  it('turns off terminals from other devices, confirming it’s you from one', async () => {
    const { app, services } = await setup();
    await services.terminal.updateSettings({ allowRemote: true });
    await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      remoteAddress: REMOTE.remoteAddress,
      headers: { host: REMOTE.host },
      payload: { with: 'password', username: 'ada', password: PASSWORD },
    });
    const cookie = String(signIn.headers['set-cookie']).split(';')[0] ?? '';
    const phone = (url: string, payload: object) =>
      app.inject({
        method: 'POST',
        url,
        remoteAddress: REMOTE.remoteAddress,
        headers: { host: REMOTE.host, cookie },
        payload,
      });

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    const blocked = await phone('/api/access/fix', { action: 'terminal-remote-off' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('verify-required');
    expect((await services.terminal.settings()).allowRemote).toBe(true);

    expect((await phone('/api/access/verify', { secret: PASSWORD })).statusCode).toBe(200);
    const ok = await phone('/api/access/fix', { action: 'terminal-remote-off' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().done).toBe('Other devices can’t open a terminal now.');
    expect((await services.terminal.settings()).allowRemote).toBe(false);
  });

  it('sets the work folder’s own rules aside', async () => {
    const { app, services } = await setup();
    const workspace = await services.settings.workspace();
    await mkdir(join(workspace, '.claude'), { recursive: true });
    await writeFile(
      join(workspace, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(*)'] } }),
    );
    expect(ids(await findings(app))).toContain('workspace-rules');
    const res = await fix(app, 'workspace-rules-off');
    expect(res.statusCode).toBe(200);
    expect(res.json().done).toContain('.claude/settings.json.off');
    expect(ids(res.json().access.checkup)).not.toContain('workspace-rules');
  });

  it('makes Conch’s files private again', async () => {
    const { app, services } = await setup();
    services.homeProblems = [join(services.config.CONCH_HOME, 'access.json')];
    expect(ids(await findings(app))).toContain('files');
    const res = await fix(app, 'secure-files');
    expect(res.statusCode).toBe(200);
    expect(res.json().done).toBe('Only you can read your Conch files now.');
    expect(services.homeProblems).toEqual([]);
    expect(ids(res.json().access.checkup)).not.toContain('files');
  });

  it('refuses actions it doesn’t know, and anything smuggled beside one', async () => {
    const { app, services } = await setup();
    await services.settings.update({ preferences: { permissionMode: 'bypassPermissions' } });
    for (const action of ['grant-full-trust', 'ASK-FIRST', '__proto__', 'constructor', '', 42]) {
      const res = await fix(app, action);
      expect(res.statusCode, String(action)).toBe(400);
      expect(res.json().error).toBe('bad-request');
    }
    const smuggled = await app.inject({
      method: 'POST',
      url: '/api/access/fix',
      payload: { action: 'ask-first', preferences: { permissionMode: 'bypassPermissions' } },
    });
    expect(smuggled.statusCode).toBe(400);
    const empty = await app.inject({ method: 'POST', url: '/api/access/fix', payload: {} });
    expect(empty.statusCode).toBe(400);
    expect((await services.settings.get()).preferences.permissionMode).toBe('bypassPermissions');
  });

  it('can’t be reached by another site, another port, or a stranger', async () => {
    const { app, services } = await setup();
    await services.browser.updateSettings({ allowLocal: true });
    const crossSite = await fix(app, 'browser-local-off', {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
    });
    expect(crossSite.statusCode).toBe(403);
    const otherPort = await fix(app, 'browser-local-off', {
      host: 'localhost:4317',
      origin: 'http://localhost:3000',
    });
    expect(otherPort.statusCode).toBe(403);
    const form = await app.inject({
      method: 'POST',
      url: '/api/access/fix',
      headers: { 'content-type': 'text/plain' },
      payload: '{"action":"browser-local-off"}',
    });
    expect(form.statusCode).toBe(415);
    const stranger = await app.inject({
      method: 'POST',
      url: '/api/access/fix',
      remoteAddress: REMOTE.remoteAddress,
      headers: { host: REMOTE.host },
      payload: { action: 'browser-local-off' },
    });
    expect(stranger.statusCode).toBe(401);
    expect((await services.browser.store.settings()).allowLocal).toBe(true);
  });

  it('is reachable only from its HTTP route, never from an agent tool', async () => {
    // The fixes change security settings, so nothing the agent can call may
    // import them: only the signed-in, same-origin route does.
    const src = join(import.meta.dirname, '..');
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
      }
    };
    await walk(src);
    const importers = async (pattern: RegExp) => {
      const out: string[] = [];
      for (const file of files)
        if (pattern.test(await readFile(file, 'utf8')))
          out.push(relative(src, file).split(sep).join('/'));
      return out.sort();
    };
    expect(await importers(/from '\.{1,2}\/(?:auth\/)?fixes'/)).toEqual(['auth/routes.ts']);
    expect(await importers(/\bsetAsideWorkspaceRules\b/)).toEqual([
      'auth/checkup.ts',
      'auth/fixes.ts',
    ]);
    expect(CheckupAction.options.length).toBeGreaterThan(0);
  });
});
