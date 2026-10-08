import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentList, ConversationEvent, ConversationSummary } from '@conch/protocol';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Access } from '../security';
import { chatOf, logOf, workedChat } from './fixtures';
import { registerTrajectoryRoutes } from './routes';
import { fileNameOf, TrajectoryService, writeNew } from './service';

const AGENTS: AgentList = {
  defaultId: 'ag_pearl',
  agents: [
    {
      id: 'ag_pearl',
      name: 'Pearl',
      role: '',
      avatar: { kind: 'preset', id: 'shell' },
      persona: { tone: 'warm', personality: '' },
      instructions: '',
      isDefault: true,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'ag_scout',
      name: 'Scout',
      role: '',
      avatar: { kind: 'preset', id: 'shell' },
      persona: { tone: 'warm', personality: '' },
      instructions: '',
      isDefault: false,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
} as AgentList;

let home: string;
let chats: Map<string, { conversation: ConversationSummary; events: ConversationEvent[] }>;

function service(now = Date.UTC(2026, 9, 8)) {
  return new TrajectoryService({
    list: async () => [...chats.values()].map((c) => c.conversation),
    detail: async (id) => {
      const chat = chats.get(id);
      if (!chat) throw new Error('missing');
      return chat;
    },
    agents: async () => AGENTS,
    profile: async () => ({ name: 'Ada Lovelace', facts: [{ kind: 'person', text: 'Lina' }] }),
    known: () => (t) => t,
    rules: () => ({
      home,
      conchHome: join(home, '.conch'),
      workspace: join(home, '.conch', 'workspace'),
      denied: [join(home, '.ssh')],
    }),
    version: '9.9.9',
    now: () => now,
  });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-trajectory-'));
  await mkdir(join(home, 'Downloads'));
  await mkdir(join(home, '.conch', 'workspace'), { recursive: true });
  await mkdir(join(home, '.ssh'));
  chats = new Map([
    [
      'c1',
      {
        conversation: chatOf('c1', {
          createdAt: Date.UTC(2026, 9, 1),
          updatedAt: Date.UTC(2026, 9, 1),
        }),
        events: workedChat('c1'),
      },
    ],
    [
      'c2',
      {
        conversation: chatOf('c2', {
          title: 'Morning brief',
          agentId: 'ag_scout',
          createdAt: Date.UTC(2026, 9, 5),
          updatedAt: Date.UTC(2026, 9, 5),
          origin: { kind: 'routine', routineId: 'r', runId: 'x' },
        }),
        events: workedChat('c2', 'codex-cli'),
      },
    ],
    ['c3', { conversation: chatOf('c3', { title: 'Empty' }), events: [] }],
  ]);
});
afterEach(() => rm(home, { recursive: true, force: true }));

describe('saving how it did it', () => {
  it('saves one chat in Downloads, named for it, and never over a file that’s there', async () => {
    const s = service();
    const first = await s.export({ format: 'report', filter: { conversationId: 'c1' } });
    expect(first.name).toBe('Conch – Fix the login test – 2026-10-08.html');
    expect(first.folder.path).toBe(await realDownloads());
    expect(first.chats).toBe(1);
    const second = await s.export({ format: 'report', filter: { conversationId: 'c1' } });
    expect(second.name).toBe('Conch – Fix the login test – 2026-10-08 2.html');
    expect(await readdir(join(home, 'Downloads'))).toHaveLength(2);
    expect((await stat(first.path)).mode & 0o077).toBe(0);
    expect(await readFile(first.path, 'utf8')).toContain('<!doctype html>');
  });

  it('says what it would take out before anything is saved', async () => {
    chats.set('c4', {
      conversation: chatOf('c4', { title: 'Write to Lina' }),
      events: logOf('c4', [
        { type: 'user.message', messageId: 'u', text: 'Email lina@example.com, from Ada' },
        { type: 'turn.completed', outcome: 'success' },
      ]),
    });
    const preview = await service().preview({ format: 'openai', filter: { conversationId: 'c4' } });
    expect(preview.removed.map((r) => r.kind).sort()).toEqual(['email', 'name']);
    expect(preview.name).toBe('Conch – Write to name – 2026-10-08.jsonl');
    expect(await readdir(join(home, 'Downloads'))).toEqual([]);
    const plain = await service().preview({
      format: 'openai',
      filter: { conversationId: 'c4' },
      redact: false,
    });
    expect(plain.removed).toEqual([]);
  });

  it('saves a batch by time, agent and provider, routines included unless said', async () => {
    const s = service();
    expect((await s.preview({ format: 'sharegpt', filter: {} })).chats).toBe(2);
    expect((await s.preview({ format: 'sharegpt', filter: { automatic: false } })).chats).toBe(1);
    expect((await s.preview({ format: 'sharegpt', filter: { engine: 'codex-cli' } })).chats).toBe(
      1,
    );
    expect((await s.preview({ format: 'sharegpt', filter: { agentId: 'ag_scout' } })).chats).toBe(
      1,
    );
    expect(
      (await s.preview({ format: 'sharegpt', filter: { from: Date.UTC(2026, 9, 3) } })).chats,
    ).toBe(1);
    const batch = await s.export({ format: 'atif', filter: {} });
    expect(batch.name).toBe('Conch chats – 2026-10-08.jsonl');
    const lines = (await readFile(batch.path, 'utf8')).trim().split('\n');
    expect(lines.map((l) => (JSON.parse(l) as { session_id: string }).session_id)).toEqual([
      'c1',
      'c2',
    ]);
    await expect(
      s.preview({ format: 'report', filter: { from: Date.UTC(2030, 0, 1) } }),
    ).rejects.toMatchObject({ code: 'none' });
  });

  it('never saves into Conch’s own folder or where keys live, nor in a file', async () => {
    const s = service();
    await expect(
      s.export({
        format: 'report',
        filter: { conversationId: 'c1' },
        folder: join(home, '.conch'),
      }),
    ).rejects.toMatchObject({ code: 'denied' });
    await expect(
      s.export({ format: 'report', filter: { conversationId: 'c1' }, folder: '~/.ssh' }),
    ).rejects.toMatchObject({ code: 'denied' });
    // Through a link that points there, too.
    await symlink(join(home, '.ssh'), join(home, 'innocent'));
    await expect(
      s.export({ format: 'report', filter: { conversationId: 'c1' }, folder: '~/innocent' }),
    ).rejects.toMatchObject({ code: 'denied' });
    await writeFile(join(home, 'a-file'), 'x');
    await expect(
      s.export({ format: 'report', filter: { conversationId: 'c1' }, folder: '~/a-file' }),
    ).rejects.toMatchObject({ code: 'not-folder' });
    await expect(
      s.export({ format: 'report', filter: { conversationId: 'c1' }, folder: '~/nowhere' }),
    ).rejects.toMatchObject({ code: 'missing' });
    expect(await readdir(join(home, '.ssh'))).toEqual([]);
  });

  it('saves in the home folder when there’s no Downloads', async () => {
    await rm(join(home, 'Downloads'), { recursive: true });
    const saved = await service().export({ format: 'markdown', filter: { conversationId: 'c1' } });
    expect(saved.folder.shown).toBe('~');
  });

  it('never writes through a link left where the file would go', async () => {
    const target = join(home, 'elsewhere.txt');
    await symlink(target, join(home, 'Downloads', 'x.md'));
    const written = await writeNew(join(home, 'Downloads'), 'x.md', 'hello');
    expect(written.name).toBe('x 2.md');
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('names files so every computer takes them', () => {
    expect(fileNameOf('Fix: the "login" test / again?')).toBe('Fix the login test again');
    expect(fileNameOf('..‮')).toBe('Chat');
    expect(fileNameOf('a'.repeat(100))).toHaveLength(60);
  });
});

describe('the routes', () => {
  async function app(access: Access) {
    const server = Fastify();
    server.addHook('onRequest', async (request) => {
      request.access = access;
    });
    registerTrajectoryRoutes(server, service());
    await server.ready();
    return server;
  }

  it('draws a chat’s timeline, and says when it’s gone', async () => {
    const server = await app({ kind: 'local' } as Access);
    const res = await server.inject({ url: '/api/conversations/c1/timeline' });
    expect(res.json()).toMatchObject({ conversationId: 'c1', totals: { tools: 2 } });
    expect((await server.inject({ url: '/api/conversations/nope/timeline' })).statusCode).toBe(404);
  });

  it('saves only for a person, never an access key', async () => {
    const key = await app({ kind: 'bearer', keyId: 'k' } as Access);
    const res = await key.inject({
      method: 'POST',
      url: '/api/trajectories/export',
      payload: { format: 'report' },
    });
    expect(res.statusCode).toBe(403);
    expect(await readdir(join(home, 'Downloads'))).toEqual([]);
    const person = await app({ kind: 'local' } as Access);
    const ok = await person.inject({
      method: 'POST',
      url: '/api/trajectories/export',
      payload: { format: 'report', filter: { conversationId: 'c1' } },
    });
    expect(ok.json()).toMatchObject({ chats: 1, folder: { shown: '~/Downloads' } });
    const bad = await person.inject({
      method: 'POST',
      url: '/api/trajectories/preview',
      payload: { format: 'exe' },
    });
    expect(bad.statusCode).toBe(400);
    const denied = await person.inject({
      method: 'POST',
      url: '/api/trajectories/export',
      payload: { format: 'report', folder: '~/.ssh' },
    });
    expect(denied.json()).toMatchObject({ error: 'trajectory-denied' });
  });
});

async function realDownloads() {
  const { realpath } = await import('node:fs/promises');
  return realpath(join(home, 'Downloads'));
}
