import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { McpScope } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { McpSessions } from './endpoint';
import { McpPairing } from './pairing';
import type { McpService } from './service';
import { McpClientStore } from './store';
import { placeOf, type Place, type TargetApp } from './targets';

function setup(options: { found?: TargetApp[] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'conch-mcp-pair-'));
  const apps = mkdtempSync(join(tmpdir(), 'conch-mcp-apps-'));
  const places: Record<TargetApp, Place> = {
    'claude-desktop': {
      dir: join(apps, 'Claude'),
      file: join(apps, 'Claude', 'claude_desktop_config.json'),
      key: 'mcpServers',
    },
    cursor: {
      dir: join(apps, '.cursor'),
      file: join(apps, '.cursor', 'mcp.json'),
      key: 'mcpServers',
    },
    vscode: {
      dir: join(apps, 'Code', 'User'),
      file: join(apps, 'Code', 'User', 'mcp.json'),
      key: 'servers',
    },
  };
  for (const app of options.found ?? ['claude-desktop', 'cursor', 'vscode'])
    mkdirSync(places[app].dir, { recursive: true });
  const store = new McpClientStore(home);
  const mcp = {
    store,
    choices: async () =>
      (['memory.read', 'memory.write', 'skills', 'browser', 'app:gmail'] as McpScope[]).map(
        (scope) => ({ scope, title: scope }),
      ),
    // Your agents, which another agent may be let talk to (ADR 0112).
    agentScopes: async () => ['agent:ag_conch'] as McpScope[],
  } as unknown as McpService;
  const sessions = new McpSessions();
  const healed: string[] = [];
  const pairing = new McpPairing({
    mcp,
    sessions,
    port: 4317,
    place: (app) => places[app],
    node: process.execPath,
    onHeal: (message) => healed.push(message),
  });
  const read = (app: TargetApp) =>
    JSON.parse(readFileSync(places[app].file, 'utf8')) as Record<string, Record<string, unknown>>;
  return { home, places, store, pairing, sessions, read, healed };
}

describe('where each app keeps its servers', () => {
  it('on every system', () => {
    const env = { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' };
    expect(placeOf('claude-desktop', 'win32', 'C:\\Users\\ada', env).file).toMatch(
      /Roaming[\\/]Claude[\\/]claude_desktop_config\.json$/,
    );
    expect(placeOf('claude-desktop', 'darwin', '/Users/ada', {}).file).toBe(
      join('/Users/ada', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    );
    expect(placeOf('claude-desktop', 'linux', '/home/ada', {}).file).toBe(
      join('/home/ada', '.config', 'Claude', 'claude_desktop_config.json'),
    );
    expect(placeOf('cursor', 'linux', '/home/ada', {}).file).toBe(
      join('/home/ada', '.cursor', 'mcp.json'),
    );
    expect(placeOf('vscode', 'darwin', '/Users/ada', {})).toMatchObject({
      file: join('/Users/ada', 'Library', 'Application Support', 'Code', 'User', 'mcp.json'),
      key: 'servers',
    });
  });
});

describe('connecting an app in one press', () => {
  it('adds Conch beside what was there, keeps the file as it was, and puts no key in it', async () => {
    const { places, pairing, read, store } = setup();
    writeFileSync(
      places['claude-desktop'].file,
      JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['files'] } }, theme: 'dark' }),
    );
    const paired = await pairing.pair({ app: 'claude-desktop', scopes: ['memory.read'] });
    expect(paired.wrote).toBe(places['claude-desktop'].file);
    expect(paired.next).toMatch(/Quit Claude Desktop and open it again/);
    const written = read('claude-desktop');
    expect(written.theme).toBe('dark');
    expect(written.mcpServers?.files).toEqual({ command: 'npx', args: ['files'] });
    expect(written.mcpServers?.conch).toEqual({
      command: process.execPath,
      args: [pairing.launcher, '--client', paired.client.id],
    });
    const text = readFileSync(places['claude-desktop'].file, 'utf8');
    expect(text).not.toMatch(/cmcp\./);
    expect(existsSync(`${places['claude-desktop'].file}.before-conch`)).toBe(true);
    expect(existsSync(pairing.launcher)).toBe(true);
    expect(await store.key(paired.client.id)).toMatch(/^cmcp\./);
  });

  it('VS Code gets its own shape', async () => {
    const { pairing, read } = setup();
    const paired = await pairing.pair({ app: 'vscode', scopes: ['skills'] });
    expect(read('vscode').servers?.conch).toEqual({
      type: 'stdio',
      command: process.execPath,
      args: [pairing.launcher, '--client', paired.client.id],
    });
  });

  it('leaves someone else’s “conch” alone', async () => {
    const { places, pairing, read } = setup();
    writeFileSync(
      places.cursor.file,
      JSON.stringify({ mcpServers: { conch: { command: 'my-own-conch' } } }),
    );
    await pairing.pair({ app: 'cursor', scopes: ['memory.read'] });
    const servers = read('cursor').mcpServers ?? {};
    expect(servers.conch).toEqual({ command: 'my-own-conch' });
    expect(servers['conch-assistant']).toBeDefined();
  });

  it('a settings file it can’t read is left as it is, and the person gets the lines to add', async () => {
    const { places, pairing, store } = setup();
    const jsonc = '{\n  // my servers\n  "servers": {}\n}\n';
    writeFileSync(places.vscode.file, jsonc);
    const paired = await pairing.pair({ app: 'vscode', scopes: ['memory.read'] });
    expect(readFileSync(places.vscode.file, 'utf8')).toBe(jsonc);
    expect(paired.wrote).toBeUndefined();
    expect(paired.next).toMatch(/couldn’t read VS Code’s settings file/);
    expect(paired.setup?.json).toContain(paired.client.id);
    expect(await store.get(paired.client.id)).toBeDefined();
  });

  it('an app that isn’t on this computer pairs nothing', async () => {
    const { pairing, store } = setup({ found: [] });
    await expect(pairing.pair({ app: 'cursor', scopes: ['memory.read'] })).rejects.toThrow(
      /isn’t on this computer/,
    );
    expect(await store.list()).toHaveLength(0);
  });

  it('another agent can be given one of yours to talk to, and only one that exists (ADR 0112)', async () => {
    const { pairing } = setup();
    const paired = await pairing.pair({
      app: 'other',
      name: 'Ana’s agent',
      scopes: ['agent:ag_conch'],
      http: true,
    });
    expect(paired.client.scopes).toEqual(['agent:ag_conch']);
    expect(paired.setup?.key).toMatch(/^cmcp\./);
    await expect(
      pairing.pair({ app: 'other', scopes: ['agent:ag_gonegone'], http: true }),
    ).rejects.toThrow(/isn’t connected/);
  });

  it('connecting again starts afresh: the old pairing goes', async () => {
    const { pairing, store, read } = setup();
    const first = await pairing.pair({ app: 'cursor', scopes: ['memory.read'] });
    const second = await pairing.pair({ app: 'cursor', scopes: ['skills'] });
    expect(await store.get(first.client.id)).toBeUndefined();
    expect((await store.list()).map((c) => c.id)).toEqual([second.client.id]);
    expect(JSON.stringify(read('cursor'))).toContain(second.client.id);
  });

  it('says which apps are here and connected', async () => {
    const { pairing } = setup({ found: ['cursor', 'vscode'] });
    const paired = await pairing.pair({ app: 'cursor', scopes: ['memory.read'] });
    const targets = await pairing.targets();
    expect(targets.find((t) => t.app === 'cursor')).toMatchObject({
      found: true,
      connected: true,
      clientId: paired.client.id,
    });
    expect(targets.find((t) => t.app === 'vscode')).toMatchObject({
      found: true,
      connected: false,
    });
    expect(targets.find((t) => t.app === 'claude-desktop')).toMatchObject({ found: false });
  });
});

describe('removing an app', () => {
  it('takes Conch out of its settings, leaves the rest, and ends its sessions', async () => {
    const { places, pairing, read, store, sessions } = setup();
    writeFileSync(
      places['claude-desktop'].file,
      JSON.stringify({ mcpServers: { files: { command: 'npx' } } }),
    );
    const { client } = await pairing.pair({ app: 'claude-desktop', scopes: ['memory.read'] });
    const key = (await store.key(client.id)) ?? '';
    const { createHmac } = await import('node:crypto');
    const nonce = sessions.hello(client.id);
    const opened = sessions.open(
      client.id,
      nonce,
      createHmac('sha256', key).update(`conch-mcp/1 ${client.id} ${nonce}`).digest('base64url'),
      key,
    );
    expect(sessions.client(opened?.token ?? '')).toBe(client.id);
    expect(await pairing.remove(client.id)).toBe(true);
    expect(read('claude-desktop').mcpServers).toEqual({ files: { command: 'npx' } });
    expect(sessions.client(opened?.token ?? '')).toBeUndefined();
    expect(await store.key(client.id)).toBeUndefined();
  });
});

describe('healing', () => {
  it('points an app back at Conch when the Node it started is gone', async () => {
    const { places, pairing, read, healed } = setup();
    const { client } = await pairing.pair({ app: 'cursor', scopes: ['memory.read'] });
    writeFileSync(
      places.cursor.file,
      JSON.stringify({
        mcpServers: {
          conch: {
            command: join(tmpdir(), 'old-node', 'node'),
            args: [pairing.launcher, '--client', client.id],
          },
        },
      }),
    );
    expect(await pairing.heal()).toEqual(['Helped Cursor find Conch again']);
    expect(read('cursor').mcpServers?.conch).toMatchObject({ command: process.execPath });
    expect(healed).toHaveLength(1);
    expect(await pairing.heal()).toEqual([]);
  });

  it('takes out an entry for an app that’s no longer paired', async () => {
    const { places, pairing, read } = setup();
    writeFileSync(
      places.vscode.file,
      JSON.stringify({
        servers: {
          other: { command: 'x' },
          conch: {
            type: 'stdio',
            command: process.execPath,
            args: [pairing.launcher, '--client', 'mcpc_gone'],
          },
        },
      }),
    );
    expect(await pairing.heal()).toEqual(['Took Conch out of VS Code. It was no longer paired.']);
    expect(read('vscode').servers).toEqual({ other: { command: 'x' } });
  });

  it('writes the launcher again when it was changed', async () => {
    const { pairing } = setup();
    await pairing.installLauncher();
    writeFileSync(pairing.launcher, 'tampered');
    expect(await pairing.heal()).toContain('Updated how other apps reach Conch');
    expect(readFileSync(pairing.launcher, 'utf8')).toMatch(/conch-mcp-launcher v1/);
  });
});
