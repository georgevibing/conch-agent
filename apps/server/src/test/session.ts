/**
 * A Conch that's been used for a while, in a temp home: settings, a memory
 * (searchable by meaning, with its model), a command, a routine that ran, a skill, an integration with its token, a
 * chat with an attachment, a model API's transcript, the browser's and
 * terminal's settings, a note the assistant wrote (and Undo's copy), a budget, a limit on what routines spend, a password, a provider key,
 * a linked WhatsApp and Signal, an app made in a chat and one added from a file (with its key), and a backup.
 * Everything is written by the real services, the way using Conch writes it.
 * The backup tests use it to check nothing Conch writes is left unclassified.
 */
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerEvent } from '@conch/protocol';

import { buildApp } from '../app';
import { onThisComputer } from './here';
import { loadConfig } from '../config';
import { sessionsDir, TranscriptStore } from '../engines/api/session';
import { MockMatrix } from '../channels/mock/matrix';
import { MockTeams } from '../channels/mock/teams';
import { MockTelegram } from '../channels/mock/telegram';
import { recordGateway } from '../port';
import { Services } from '../services';
import { fakePack, fakeParts, fakeSign, textFiles } from './conchapps';

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
    // Conch apps' sealed runtime and package reader are stood in for (ADR 0061).
    { conchAppParts: fakeParts() },
  );
  const app = onThisComputer(await buildApp(services), services);
  await app.ready();
  return { home: dir, services, app };
}

export type Gateway = Awaited<ReturnType<typeof gateway>>;

/**
 * Send a message and wait for the reply to finish. A turn that stops to ask
 * (a skill held to its own list, ADR 0047) is answered as a person would, with
 * Deny, so the reply still finishes.
 */
export async function chat(services: Services, text: string, attachments: string[] = []) {
  const done = new Promise<void>((resolve) => {
    const off = services.conversations.events.on((event: ServerEvent) => {
      if (event.type !== 'conversation.event') return;
      if (event.event.type === 'permission.requested') {
        void services.conversations.respond(
          event.event.conversationId,
          event.event.permissionId,
          'deny',
        );
      }
      if (event.event.type === 'turn.completed') {
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
  // Routines that start when something happens (ADR 0056): what starts them, what
  // the pulse has seen, and another app's secret.
  const after = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/routines',
      payload: {
        title: 'After the briefing',
        prompt: 'Tell me what it said.',
        when: { kind: 'routine', routineId: String(routine.id) },
        timezone: 'Europe/Berlin',
      },
    }),
  );
  const shop = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/routines',
      payload: {
        title: 'From my shop',
        prompt: 'Tell me about the order.',
        when: { kind: 'hook' },
        timezone: 'Europe/Berlin',
      },
    }),
  );
  await ok(await app.inject({ method: 'POST', url: `/api/routines/${String(shop.id)}/secret` }));
  await services.routines.lookAgain();
  void after;
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
  // A skill from Discover (ADR 0072): searched (the cache), read (staging), added (its folder and origin).
  await ok(await app.inject({ method: 'GET', url: '/api/skills/market?q=meeting' }));
  const look = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/skills/market/preview',
      payload: { id: 'clawhub:pretend/meeting-notes' },
    }),
  );
  await ok(
    await app.inject({
      method: 'POST',
      url: '/api/skills/market/install',
      payload: { previewId: look.previewId, mode: 'auto' },
    }),
  );
  await ok(
    await app.inject({
      method: 'POST',
      url: '/api/skills/market/preview',
      payload: { id: 'clawhub:pretend/trip-planner' },
    }),
  );
  await services.integrations.create(
    { catalogId: 'github', values: { token: GITHUB_TOKEN } },
    { redirectUrl: 'http://localhost/oauth/callback', display: 'popup' },
  );
  // An app made in a chat and added from its card, with something counted (ADR 0061)…
  const maker = await chat(services, 'make me an app that counts things');
  const card = (await services.conversations.detail(maker.id)).events.flatMap((e) =>
    e.type === 'conch-app.offer' && e.offer.state === 'ready' ? [e.offer] : [],
  )[0];
  if (!card) throw new Error('no app card');
  await ok(
    await app.inject({
      method: 'POST',
      url: `/api/conch-apps/offers/${card.offerId}/accept`,
      payload: { conversationId: maker.id },
    }),
  );
  await ok(
    await app.inject({
      method: 'POST',
      url: '/api/conch-apps/tally/call',
      payload: { tool: 'count', input: { by: 2 }, confirmed: true },
    }),
  );
  // …and one added from a file, with the key it needs.
  const weather = fakePack(
    fakeSign(
      textFiles({
        'conch-app.json': JSON.stringify({
          conch: 1,
          id: 'weather',
          name: 'Weather',
          tagline: 'The weather where you are',
          version: '1.0.0',
          icon: { glyph: 'cloud-sun', color: 'blue' },
          reaches: ['api.weather.example'],
          settings: [{ key: 'apiKey', label: 'API key', secret: true }],
        }),
      }),
      { fingerprint: 'BBBB 2222', publisher: 'Bea' },
    ),
  );
  const looked = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/conch-apps/preview',
      payload: { file: weather.toString('base64'), name: 'weather.conchapp' },
    }),
  );
  await ok(
    await app.inject({
      method: 'POST',
      url: '/api/conch-apps/install',
      payload: {
        packageId: looked.packageId,
        appId: 'weather',
        hash: (looked.apps as { hash: string }[])[0]?.hash,
        settings: { apiKey: 'wx-0123456789abcdef' },
      },
    }),
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
  await ok(
    await app.inject({ method: 'PUT', url: '/api/routines/spending', payload: { limitUsd: 30 } }),
  );
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
  // Work that took the long way, which Conch offers to keep as a skill (ADR 0058)…
  const work = await chat(services, 'Do the release notes the long way');
  const learned = await services.learner.consider(work.id);
  if (!('offered' in learned)) throw new Error(`no offer: ${learned.why}`);
  // …and a skill used by name, which the tidy shelf counts.
  await chat(services, `/${String(skill.name)} for March`);
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
  // A page that reads live data, and the site you let it read (ADR 0046).
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
  // The public door, open, and a Teams bot that has heard from you (it remembers where your chat is)…
  await ok(await app.inject({ method: 'POST', url: '/api/channels/door/tailscale', payload: {} }));
  const teams = await ok(
    await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { kind: 'microsoftteams', appId: MockTeams.APP_ID, appPassword: MockTeams.SECRET },
    }),
  );
  const soon = async <T>(fn: () => Promise<T | undefined>): Promise<T> => {
    for (let i = 0; i < 400; i++) {
      const value = await fn();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('timed out');
  };
  const hook = await soon(async () => (await services.channels.get(String(teams.id))).hook?.url);
  services.mockTeams?.endpoint(hook);
  await services.mockTeams?.say('hi');
  await soon(
    async () =>
      (await readdir(join(home, 'channels')).catch(() => [])).some((f) => f.startsWith('teams-')) ||
      undefined,
  );
  // …and a Matrix account, with its encryption store.
  await ok(
    await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: {
        kind: 'matrix',
        homeserver: services.mockMatrix?.base,
        user: 'conch',
        password: MockMatrix.PASSWORD,
      },
    }),
  );
  await soon(
    async () =>
      (await readdir(join(home, 'channels')).catch(() => [])).some((f) =>
        f.startsWith('matrix-'),
      ) || undefined,
  );
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
