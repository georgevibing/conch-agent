/**
 * A Conch that's been used for a while, in a temp home: settings, a memory
 * (searchable by meaning, with its model), a command, a routine that ran, a skill, an integration with its token, a
 * chat with an attachment, a model API's transcript, the browser's and
 * terminal's settings, a note the assistant wrote (and Undo's copy), a budget, a password, a provider key,
 * a linked WhatsApp and Signal, and a backup.
 * Everything is written by the real services, the way using Conch writes it.
 * The backup tests use it to check nothing Conch writes is left unclassified.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerEvent } from '@conch/protocol';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { sessionsDir, TranscriptStore } from '../engines/api/session';
import { MockTelegram } from '../channels/mock/telegram';
import { recordGateway } from '../port';
import { Services } from '../services';

export const PASSWORD = 'purple otters juggle at dawn';
const GITHUB_TOKEN = 'github_pat_mock_0123456789abcdefghij';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEElEQVR4nGP8z8DwnwEKAAAvAAP9fPZ3AAAAAElFTkSuQmCC',
  'base64',
);

export async function gateway(home?: string) {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const dir = home ?? (await mkdtemp(join(tmpdir(), 'conch-backup-')));
  const services = new Services(
    loadConfig({
      CONCH_HOME: dir,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = await buildApp(services);
  await app.ready();
  return { home: dir, services, app };
}

export type Gateway = Awaited<ReturnType<typeof gateway>>;

/** Send a message and wait for the reply to finish. */
export async function chat(services: Services, text: string, attachments: string[] = []) {
  const done = new Promise<void>((resolve) => {
    const off = services.conversations.events.on((event: ServerEvent) => {
      if (event.type === 'conversation.event' && event.event.type === 'turn.completed') {
        off();
        resolve();
      }
    });
  });
  const convo = await services.conversations.send({
    clientMessageId: `m${Math.random()}`,
    text,
    attachments,
  });
  await done;
  return convo;
}

/** Use Conch for a while, through its own services. Returns what was made. */
export async function useConch(g: Gateway) {
  const { app, services, home } = g;
  const ok = async (res: { statusCode: number; body: string }) => {
    if (res.statusCode >= 300) throw new Error(`${res.statusCode}: ${res.body}`);
    return JSON.parse(res.body) as Record<string, unknown>;
  };

  await ok(
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { onboarded: true, persona: { name: 'Shelly' }, profile: { name: 'Ada' } },
    }),
  );
  const memory = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/memories',
      payload: { content: 'Ada takes her tea with lemon.' },
    }),
  );
  // Memory search by meaning: the (pretend) model, downloaded, and its vectors.
  await services.onDevice.get(['en-GB']);
  await services.memoryIndex.sync();
  await ok(
    await app.inject({
      method: 'PUT',
      url: '/api/commands/standup',
      payload: { description: 'Daily standup', prompt: 'Write my standup from {{input}}' },
    }),
  );
  const routine = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/routines',
      payload: {
        title: 'Morning briefing',
        prompt: 'Summarise my day.',
        schedule: { type: 'daily', time: '08:00' },
        timezone: 'Europe/Berlin',
      },
    }),
  );
  await services.routines.runNow(String(routine.id));
  for (let i = 0; i < 200; i++) {
    const [run] = (await services.routines.detail(String(routine.id))).runs;
    if (run && !['running', 'needs-you'].includes(run.status)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  // A task in the background (ADR 0033): its list, and its own chat.
  const task = await ok(
    await app.inject({ method: 'POST', url: '/api/tasks', payload: { text: 'Tidy the notes.' } }),
  );
  for (let i = 0; i < 200; i++) {
    const now = (await services.tasks.get(String(task.id))).status;
    if (!['queued', 'running', 'needs-you'].includes(now)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const skill = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/skills',
      payload: { instructions: 'Summarise invoices from my inbox every month.' },
    }),
  );
  await writeFile(join(home, 'skills', String(skill.id), 'template.md'), '# Invoice summary\n');
  // Turning one of your own skills off is remembered in skills.json.
  const other = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/skills',
      payload: { instructions: 'Tidy my downloads folder into dated subfolders.' },
    }),
  );
  await ok(
    await app.inject({
      method: 'PATCH',
      url: `/api/skills/${String(other.id)}`,
      payload: { mode: 'off' },
    }),
  );
  await services.integrations.create(
    { catalogId: 'github', values: { token: GITHUB_TOKEN } },
    { redirectUrl: 'http://localhost/oauth/callback', display: 'popup' },
  );
  await ok(
    await app.inject({
      method: 'PATCH',
      url: '/api/browser/settings',
      payload: { autoOpen: false },
    }),
  );
  await ok(
    await app.inject({ method: 'PATCH', url: '/api/terminal/settings', payload: { fontSize: 15 } }),
  );
  await ok(await app.inject({ method: 'PUT', url: '/api/usage/budget', payload: { budget: 25 } }));
  await services.settings.setProviderSecret('openrouter', {
    source: 'conch',
    value: 'sk-or-v1-0123456789abcdef',
    savedAt: Date.now(),
  });

  const upload = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: { 'content-type': 'application/octet-stream', 'x-conch-name': 'cat.png' },
      payload: PNG,
    }),
  );
  const attachment = upload.attachment as { id: string };
  const convo = await chat(services, 'What’s in this picture?', [attachment.id]);
  await chat(services, 'And another question about the weather');
  // A file the assistant wrote, which Undo keeps a copy of (ADR 0030).
  await chat(services, 'write a note to water the plants');
  // A thumbnail of a page the agent looked at, as the browser keeps them.
  await services.browser.saveShot(convo.id, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  // What a plain model API keeps to carry a chat on.
  await new TranscriptStore(sessionsDir(home)).save(TranscriptStore.newId(), {
    provider: 'anthropic-api',
    messages: [{ role: 'user', content: 'hi' }],
  });
  // The browser's own profile, as Chromium leaves it.
  await mkdir(join(home, 'browser', 'profile', 'Default'), { recursive: true });
  await writeFile(join(home, 'browser', 'profile', 'Default', 'Cookies'), 'cookies');
  // Something the agent made in its work folder.
  await writeFile(join(await services.settings.workspace(), 'notes.md'), '# Notes\n');
  // A page that reads live data, and the site you let it read (ADR 0039).
  const live = await services.artifacts.create({
    conversationId: convo.id,
    kind: 'html',
    title: 'Weather',
    content:
      '<p id="t"></p><script type="application/conch-data">{"now":{"url":"https://api.weather.example/now"}}</script>',
  });
  await ok(
    await app.inject({
      method: 'POST',
      url: `/api/artifacts/${live.id}/live-data`,
      payload: { version: 1, host: 'api.weather.example' },
    }),
  );
  await services.healed.note('search', 'The search index was rebuilt.');
  await recordGateway(home, { pid: process.pid, host: '127.0.0.1', port: 4382, startedAt: 1 });
  // A bot on (pretend) Telegram, with its key.
  await ok(
    await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { kind: 'telegram', token: MockTelegram.TOKEN },
    }),
  );
  // WhatsApp and Signal, linked by scanning (pretend) codes: their keys are files too.
  for (const kind of ['whatsapp', 'signal'] as const) {
    const link = await ok(
      await app.inject({ method: 'POST', url: '/api/channels/link', payload: { kind } }),
    );
    const state = async () =>
      (await ok(await app.inject({ method: 'GET', url: `/api/channels/link/${String(link.id)}` })))
        .state;
    for (let i = 0; (await state()) !== 'showing'; i++) {
      if (i > 400) throw new Error(`no ${kind} code`);
      await new Promise((r) => setTimeout(r, 10));
    }
    if (kind === 'whatsapp') services.linked.mockWhatsApp?.scan();
    else services.linked.mockSignal?.scan();
    for (let i = 0; (await state()) !== 'linked'; i++) {
      if (i > 400) throw new Error(`${kind} didn’t link`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  await services.linked.whatsapp.sessions.flush();
  await services.backups.backupNow();
  // Sign-in last: from here on, requests need the cookie.
  const signedIn = await app.inject({
    method: 'PUT',
    url: '/api/access/password',
    payload: { username: 'ada', password: PASSWORD },
  });
  await ok(signedIn);
  const cookie = cookieOf(signedIn);

  return {
    memoryId: String(memory.id),
    routineId: String(routine.id),
    conversationId: convo.id,
    cookie,
  };
}

export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? String(raw[0]) : String(raw);
  return value.split(';')[0] ?? '';
}
