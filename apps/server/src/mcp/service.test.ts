import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Capabilities,
  ConversationEvent,
  EngineStatus,
  Integration,
  McpScope,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ConversationManager,
  type ToolProvider,
  type TurnIntegrationsProvider,
} from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import type { Engine, EngineEvent, HostTool } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { McpService } from './service';
import { McpClientStore } from './store';

/** The chat's own provider: never asked anything here (another app's calls run themselves). */
class Silent implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Silent';
  readonly integrations = { mode: 'bridge' as const };
  turns = 0;
  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: this.id,
      label: this.label,
      models: [],
      commands: [],
      permissionModes: ['default'],
    };
  }
  // eslint-disable-next-line require-yield
  async *runTurn(): AsyncIterable<EngineEvent> {
    this.turns++;
    throw new Error('A provider was asked to answer another app’s call.');
  }
}

const tool = (name: string, run: HostTool['run'] = async () => `${name} ran`): HostTool => ({
  name,
  description: `The ${name} tool.`,
  input: { url: z.string().optional(), name: z.string().optional() },
  run,
});

/** Conch's own tools, as the rest of Conch gives a turn them. */
const conchTools: ToolProvider = () => [
  tool('browser_open', async (args) => `Opened ${String((args as { url?: string }).url)}`),
  tool('browser_read'),
  tool('browser_handoff'),
  tool('browser_passkey'),
  tool('google_mail_search'),
  tool('slack_send_message'),
  tool('use_skill', async () => 'Follow these steps.'),
  tool('passwords_read'),
  tool('delegate'),
  tool('start_background_task'),
];

const NOTION = { type: 'http' as const, url: 'http://notion.invalid/mcp' };
const notionTools = [
  {
    name: 'mcp__notion__search',
    description: 'Search pages',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    call: async (args: Record<string, unknown>) => ({
      text: `Found ${String(args.q)}`,
      isError: false,
    }),
  },
  {
    name: 'mcp__notion__create',
    description: 'Create a page',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    call: async (args: Record<string, unknown>) => ({
      text: `Created ${String(args.title)}`,
      isError: false,
    }),
  },
];

const turnApps: TurnIntegrationsProvider = {
  forTurn: async () => ({ servers: { notion: NOTION }, disallowedTools: [], issues: [] }),
  turnFailed: async () => [],
  bridge: async (servers) => ({
    tools: servers.notion ? notionTools : [],
    failed: [],
    close: async () => undefined,
  }),
  decide: async (name) =>
    name === 'mcp__notion__create' ? 'ask' : name.startsWith('mcp__notion__') ? 'allow' : undefined,
  describeTool: async (name) =>
    name.startsWith('mcp__notion__')
      ? {
          integration: 'Notion',
          tool: name.split('__')[2] ?? '',
          access: name.endsWith('create') ? 'write' : 'read',
        }
      : undefined,
  markUsed: async () => undefined,
};

const app = (id: string, name: string, server: string, tools: string[]) =>
  ({
    id,
    name,
    server,
    enabled: true,
    tools: tools.map((t) => ({ name: t, access: 'read', description: '', destructive: false })),
  }) as unknown as Integration;

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'conch-mcp-'));
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'mock', autoTitle: false } });
  const memory = new MemoryStore(join(home, 'memory'));
  const silent = new Silent();
  const conversations = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory,
    tools: conchTools,
    integrations: turnApps,
    engine: () => silent,
  });
  const store = new McpClientStore(home);
  const mcp = new McpService({
    store,
    conversations,
    engineId: () => 'mock',
    memory,
    skills: {
      list: async () => ({
        skills: [
          { name: 'weekly-review', description: 'Plan the week', mode: 'auto' },
          { name: 'off-one', description: 'Off', mode: 'off' },
          { name: 'risky', description: 'Risky', mode: 'auto', review: { verdict: 'danger' } },
        ] as never,
        sources: [],
      }),
    },
    apps: {
      list: async () => [
        app('gmail', 'Gmail', 'conch', ['google_mail_search']),
        app('slack', 'Slack', 'conch', ['slack_send_message']),
        app('notion', 'Notion', 'notion', ['search', 'create']),
      ],
      hosted: (id) => id === 'gmail' || id === 'slack',
      forTurn: async () => ({ servers: { notion: NOTION }, disallowedTools: [] }),
      bridge: async (servers) => ({
        tools: servers.notion ? notionTools : [],
        close: async () => undefined,
      }),
    },
  });
  const pair = async (scopes: McpScope[]) =>
    (await store.create({ name: 'Claude Desktop', app: 'claude-desktop', scopes })).client;
  return { mcp, store, conversations, memory, silent, pair };
}

const names = async (
  mcp: McpService,
  client: Awaited<ReturnType<typeof setup>>['pair'] extends (...a: never[]) => Promise<infer C>
    ? C
    : never,
) => (await mcp.tools(client)).map((t) => t.name).sort();

const open = () => new AbortController().signal;

async function waitFor<T>(get: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const value = await get();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never happened');
}

describe('what a paired app is offered', () => {
  it('only what its scopes name', async () => {
    const { mcp, pair } = await setup();
    expect(await names(mcp, await pair(['memory.read']))).toEqual(['search_memory']);
    expect(await names(mcp, await pair(['memory.write']))).toEqual(['suggest_memory']);
    expect(await names(mcp, await pair(['skills']))).toEqual(['list_skills', 'use_skill']);
    expect(await names(mcp, await pair(['app:gmail']))).toEqual(['google_mail_search']);
    expect(await names(mcp, await pair(['app:notion']))).toEqual([
      'notion__create',
      'notion__search',
    ]);
  });

  it('the browser, but never handing it over or using a passkey', async () => {
    const { mcp, pair } = await setup();
    expect(await names(mcp, await pair(['browser']))).toEqual(['browser_open', 'browser_read']);
  });

  it('never Conch’s own powers: passwords, helpers, memory it could forget', async () => {
    const { mcp, pair } = await setup();
    const all = await names(
      mcp,
      await pair([
        'memory.read',
        'memory.write',
        'skills',
        'browser',
        'app:gmail',
        'app:slack',
        'app:notion',
      ]),
    );
    for (const never of [
      'passwords_read',
      'delegate',
      'start_background_task',
      'remember',
      'forget',
      'recall',
    ])
      expect(all).not.toContain(never);
  });
});

describe('a scope can’t be escaped', () => {
  it('a tool outside its scopes is refused, and nothing runs', async () => {
    const { mcp, pair, conversations } = await setup();
    const client = await pair(['memory.read']);
    for (const name of [
      'browser_open',
      'notion__search',
      'google_mail_search',
      'passwords_read',
      'remember',
      'suggest_memory',
      'mcp__notion__search',
      'mcp__conch__browser_open',
    ]) {
      const result = await mcp.call(client, name, { url: 'https://example.com' }, open());
      expect(result.isError, name).toBe(true);
      expect(result.text).toMatch(/isn’t something Claude Desktop may use/);
    }
    expect(await conversations.list()).toHaveLength(0);
  });

  it('one app’s scope doesn’t reach another app', async () => {
    const { mcp, pair } = await setup();
    const client = await pair(['app:gmail']);
    expect((await mcp.call(client, 'slack_send_message', {}, open())).isError).toBe(true);
    expect((await mcp.call(client, 'notion__create', { title: 'x' }, open())).isError).toBe(true);
  });

  it('what it may use is looked at again for every call', async () => {
    const { mcp, pair, store } = await setup();
    const client = await pair(['browser']);
    await store.update(client.id, { scopes: ['memory.read'] });
    // The app still holds its old idea of itself; Conch doesn't.
    const stale = { ...client };
    expect(
      (await mcp.call(stale, 'browser_open', { url: 'https://a.example' }, open())).isError,
    ).toBe(true);
  });
});

describe('memory', () => {
  it('a suggestion waits for the person’s OK, and searching never shows one that waits', async () => {
    const { mcp, pair, memory } = await setup();
    await memory.add({ content: 'Ada likes tea', source: 'user' });
    const writer = await pair(['memory.write']);
    const reader = await pair(['memory.read']);
    const said = await mcp.call(writer, 'suggest_memory', { content: 'Ada likes coffee' }, open());
    expect(said.text).toMatch(/waits for the user’s OK/);
    const saved = (await memory.list()).find((m) => m.content === 'Ada likes coffee');
    expect(saved).toMatchObject({ pending: true, source: 'agent' });
    expect(saved?.untrusted).toMatch(/Claude Desktop/);
    const found = await mcp.call(reader, 'search_memory', { query: 'Ada likes' }, open());
    expect(found.text).toContain('Ada likes tea');
    expect(found.text).not.toContain('coffee');
  });

  it('arguments it doesn’t take are refused in words', async () => {
    const { mcp, pair } = await setup();
    const reader = await pair(['memory.read']);
    const result = await mcp.call(reader, 'search_memory', { query: 'x', all: true }, open());
    expect(result).toMatchObject({ isError: true, text: 'This tool doesn’t take `all`.' });
  });
});

describe('skills', () => {
  it('lists only the skills that are on and safe', async () => {
    const { mcp, pair } = await setup();
    const result = await mcp.call(await pair(['skills']), 'list_skills', {}, open());
    expect(result.text).toBe('- weekly-review: Plan the week');
  });
});

describe('a call that runs in the app’s own chat', () => {
  it('runs there, with no provider asked, and the next call uses the same chat', async () => {
    const { mcp, pair, conversations, store, silent } = await setup();
    const client = await pair(['browser']);
    const first = await mcp.call(client, 'browser_open', { url: 'https://a.example' }, open());
    expect(first).toEqual({ text: 'Opened https://a.example', isError: false });
    const chatId = (await store.get(client.id))?.conversationId;
    expect(chatId).toBeDefined();
    const { conversation, events } = await conversations.detail(chatId ?? '');
    expect(conversation.origin).toEqual({
      kind: 'client',
      clientId: client.id,
      name: 'Claude Desktop',
    });
    expect(events.find((e) => e.type === 'user.message')).toMatchObject({
      text: expect.stringMatching(/^Claude Desktop: /),
    });
    await mcp.call(client, 'browser_read', {}, open());
    expect((await store.get(client.id))?.conversationId).toBe(chatId);
    expect(silent.turns).toBe(0);
    // What it read, the chat remembers for the calls after (the guard after reading).
    expect(await conversations.taintOf(chatId ?? '')).toContainEqual({
      kind: 'web',
      label: 'a.example',
    });
  });

  it('a change asks the person in Conch, and goes ahead only when they say yes', async () => {
    const { mcp, pair, conversations, store } = await setup();
    const client = await pair(['app:notion']);
    const answered = (decision: 'allow' | 'deny') =>
      waitFor(async () => {
        const id = (await store.get(client.id))?.conversationId;
        if (!id) return undefined;
        const { events } = await conversations.detail(id);
        const asked = events.findLast(
          (e): e is Extract<ConversationEvent, { type: 'permission.requested' }> =>
            e.type === 'permission.requested',
        );
        const resolved = events.some(
          (e) => e.type === 'permission.resolved' && e.permissionId === asked?.permissionId,
        );
        if (!asked || resolved) return undefined;
        await conversations.respond(id, asked.permissionId, decision);
        return asked;
      });
    const yes = mcp.call(client, 'notion__create', { title: 'Plan' }, open());
    expect((await answered('allow')).toolName).toBe('mcp__notion__create');
    expect(await yes).toEqual({ text: 'Created Plan', isError: false });
    const no = mcp.call(client, 'notion__create', { title: 'Again' }, open());
    await answered('deny');
    expect(await no).toMatchObject({ isError: true, text: 'The user declined this action.' });
    // Reading is allowed by the app's own policy: no question.
    expect(await mcp.call(client, 'notion__search', { q: 'plan' }, open())).toEqual({
      text: 'Found plan',
      isError: false,
    });
  });

  it('an app that hangs up stops its call, and the question waiting with it', async () => {
    const { mcp, pair, conversations, store } = await setup();
    const client = await pair(['app:notion']);
    const abort = new AbortController();
    const pending = mcp.call(client, 'notion__create', { title: 'Plan' }, abort.signal);
    const id = await waitFor(async () => {
      const chat = (await store.get(client.id))?.conversationId;
      if (!chat) return undefined;
      const { events } = await conversations.detail(chat);
      return events.some((e) => e.type === 'permission.requested') ? chat : undefined;
    });
    abort.abort();
    expect((await pending).isError).toBe(true);
    const { events, conversation } = await conversations.detail(id);
    expect(events.find((e) => e.type === 'permission.resolved')).toMatchObject({
      decision: 'expired',
    });
    expect(conversation.status).toBe('idle');
  });

  it('nobody can write in an app’s chat: it’s the app’s log', async () => {
    const { mcp, pair, conversations, store } = await setup();
    const client = await pair(['browser']);
    await mcp.call(client, 'browser_open', { url: 'https://a.example' }, open());
    const id = (await store.get(client.id))?.conversationId ?? '';
    await expect(
      conversations.send({ conversationId: id, clientMessageId: 'u1', text: 'hello' }),
    ).rejects.toThrow(/what Claude Desktop did through Conch/);
  });

  it('a chat that was deleted is started again', async () => {
    const { mcp, pair, conversations, store } = await setup();
    const client = await pair(['browser']);
    await mcp.call(client, 'browser_open', { url: 'https://a.example' }, open());
    const first = (await store.get(client.id))?.conversationId ?? '';
    await conversations.remove(first);
    expect(
      (await mcp.call(client, 'browser_open', { url: 'https://b.example' }, open())).isError,
    ).toBe(false);
    expect((await store.get(client.id))?.conversationId).not.toBe(first);
  });
});
