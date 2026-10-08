import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { decryptAttachment, normalizeMatrix } from './matrix';
import { forget } from './matrix-crypto';
import { MockMatrix } from './mock/matrix';
import { ChannelStore } from './store';
import { appId, personId } from './types';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-matrix-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const matrix = services.mockMatrix;
  if (!matrix) throw new Error('no mock Matrix');
  return { s: services, matrix, home };
}

async function until<T>(
  fn: () => T | Promise<T>,
  what: string,
  ms = 25_000,
): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;
const keys = (matrix: MockMatrix) => ({
  kind: 'matrix' as const,
  homeserver: matrix.base,
  user: 'conch',
  password: MockMatrix.PASSWORD,
});
const said = async (matrix: MockMatrix, text: string) =>
  (await matrix.seen()).find((m) => m.text.includes(text));

/** Connected, and Ada let in after her hello in an encrypted DM. */
async function paired(options: { encrypted?: boolean } = {}) {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(keys(ctx.matrix));
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  await ctx.matrix.dm({ encrypted: options.encrypted !== false });
  await until(() => ctx.matrix.roomOf(), 'the bot joins the DM');
  await ctx.matrix.say('hi');
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, personId(MockMatrix.OWNER), 'allow');
  await until(() => said(ctx.matrix, 'Hi Ada'), 'welcome');
  return { ...ctx, channel };
}

describe('Matrix', { timeout: 40_000 }, () => {
  it('signs in once with the password and keeps only its own session', async () => {
    const { s, matrix, home } = await setup();
    const channel = await s.channels.create(keys(matrix));
    expect(channel.bot).toMatchObject({ id: MockMatrix.BOT, username: 'conch:mock.local' });
    const kept = await readFile(join(home, 'channels.secrets.json'), 'utf8');
    expect(kept).not.toContain(MockMatrix.PASSWORD);
    // The check (identify) made a session and ended it; the one kept is active.
    expect(matrix.sessions().filter((d) => d.active)).toHaveLength(1);
  });

  it('says plainly when the password is wrong', async () => {
    const { s, matrix } = await setup();
    const check = await s.channels.check({ ...keys(matrix), password: 'nope' });
    expect(check).toMatchObject({ ok: false, field: 'password' });
    await expect(s.channels.create({ ...keys(matrix), password: 'nope' })).rejects.toMatchObject({
      field: 'password',
    });
  });

  it('reads and answers an encrypted DM end to end, and the owner approves with a reaction', async () => {
    const { s, matrix, channel } = await paired();
    const welcome = await said(matrix, 'Hi Ada');
    expect(welcome?.encrypted).toBe(true);
    expect(welcome?.html).toContain('<strong>');

    await matrix.say('please run the tests');
    const question = await until(
      async () => (await matrix.seen()).find((m) => m.text.includes('Allow') && !m.reaction),
      'a question',
    );
    // The bot's own reactions are the buttons.
    await until(
      async () => (await matrix.seen()).filter((m) => m.reaction).length >= 2,
      'reactions',
    );
    await matrix.react(question.event_id, '✅');
    await until(
      async () =>
        (await matrix.seen()).some(
          (m) => m.edits === question.event_id && m.text.includes('Allowed'),
        ),
      'the question says it was allowed',
    );
    const chats = await s.conversations.list();
    expect(
      chats.some((c) => c.origin?.kind === 'channel' && c.origin.channelId === channel.id),
    ).toBe(true);
  });

  it('won’t take orders from a session of the owner’s that her account never signed', async () => {
    const { s, matrix, channel } = await paired();
    const before = (await s.conversations.list()).length;
    // What a homeserver could do: add a device to Ada's account and write as her.
    await matrix.say('delete everything', { impostor: true });
    await until(() => said(matrix, 'isn’t verified'), 'the refusal');
    await new Promise((r) => setTimeout(r, 1_000));
    expect((await s.conversations.list()).length).toBe(before);
    expect((await s.channels.get(channel.id)).requests).toHaveLength(0);
  });

  it('carries on after a restart from what it wrote down (the crypto store and the sync position)', async () => {
    const { s, matrix, channel, home } = await paired();
    s.channels.stop();
    // Nothing left in memory: everything must come back from the file.
    const file = (await readdir(join(home, 'channels'))).find((f) => f.startsWith('matrix-'));
    expect(file).toBeDefined();
    const memory = JSON.parse(await readFile(join(home, 'channels', file ?? ''), 'utf8')) as {
      since?: string;
      crypto?: string;
    };
    expect(memory.since).toBeTruthy();
    expect(memory.crypto).toBeTruthy();
    // Let the old session finish closing, then drop everything it had in memory.
    await new Promise((r) => setTimeout(r, 2_000));
    await forget('conch-');
    await s.channels.start();
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
    await matrix.say('/help');
    await until(
      () => said(matrix, 'your assistant on Conch'),
      'help, encrypted, after the restart',
    );
  });

  it('answers in an unencrypted DM too, and declines groups with the reason', async () => {
    const { s, matrix, channel } = await setup().then(async (ctx) => ({
      ...ctx,
      channel: await ctx.s.channels.create(keys(ctx.matrix)),
    }));
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    const group = matrix.group();
    await until(
      () =>
        matrix.calls.some(
          (c) =>
            c.path.endsWith(`/rooms/${encodeURIComponent(group)}/leave`) ||
            c.path.includes(`${group}/leave`),
        ),
      'the group invite declined',
    );
    await matrix.dm({ encrypted: false });
    await until(() => matrix.roomOf(), 'joined');
    await matrix.say('hello there');
    const request = await until(
      async () => (await s.channels.get(channel.id)).requests[0],
      'request',
    );
    expect(request).toMatchObject({
      name: 'Ada Lovelace',
      username: 'ada:mock.local',
      preview: 'hello there',
    });
    const reply = await until(
      () => said(matrix, 'press **That’s me**'.replace(/\*\*/g, '')),
      'the hello hint',
    );
    expect(reply.encrypted).toBe(false);
  });

  it('sends a picture encrypted in an encrypted DM, with the caption first', async () => {
    const { s, matrix } = await paired();
    const picture = await s.attachments.save({ name: 'beach.png', bytes: PNG });
    await s.attachments.claim([picture.id], 'c_files');
    const done = await s.channels.messageOwner('Your **beach**', {
      attachments: [picture.id],
      conversationId: 'c_files',
    });
    expect(done).toMatchObject({ app: 'Matrix', sent: ['beach.png'], missed: [] });
    const image = await until(
      async () => (await matrix.seen()).find((m) => m.msgtype === 'm.image'),
      'the picture',
    );
    expect(image).toMatchObject({
      text: 'beach.png',
      encrypted: true,
      info: { mimetype: 'image/png' },
    });
    // The homeserver holds only the encrypted bytes; Ada's phone opens them.
    expect(image.url).toBeUndefined();
    const held = matrix.media(image.file?.url ?? '');
    expect(held?.type).toBe('application/octet-stream');
    expect(held?.bytes.equals(PNG)).toBe(false);
    if (!image.file || !held) throw new Error('no file');
    expect(decryptAttachment(held.bytes, image.file).equals(PNG)).toBe(true);
    const seen = await matrix.seen();
    const caption = seen.findIndex((m) => m.text.includes('Your beach'));
    expect(caption).toBeGreaterThanOrEqual(0);
    expect(caption).toBeLessThan(seen.findIndex((m) => m.event_id === image.event_id));
  });

  it('sends any other file as m.file in an unencrypted DM, and refuses another chat’s file', async () => {
    const { s, matrix } = await paired({ encrypted: false });
    const notes = await s.attachments.save({ name: 'notes.pdf', bytes: Buffer.from('%PDF-1.4 x') });
    await s.attachments.claim([notes.id], 'c_files');
    await s.channels.messageOwner('', { attachments: [notes.id], conversationId: 'c_files' });
    const file = await until(
      async () => (await matrix.seen()).find((m) => m.msgtype === 'm.file'),
      'the file',
    );
    expect(file).toMatchObject({ text: 'notes.pdf', encrypted: false });
    expect(matrix.media(file.url ?? '')?.bytes.toString()).toBe('%PDF-1.4 x');
    await expect(
      s.channels.messageOwner('hi', { attachments: [notes.id], conversationId: 'c_other' }),
    ).rejects.toThrow(/no file/);
  });

  it('asks for a new sign-in when the session is ended elsewhere, and retries a rate limit by itself', async () => {
    const { s, matrix, channel } = await paired({ encrypted: false });
    matrix.slowDown(2);
    await matrix.say('/help');
    await until(() => said(matrix, 'your assistant on Conch'), 'answered after the rate limit');
    matrix.signOut();
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'needs a new sign-in',
    );
    // Signing in again (Replace the key) brings it back, as a new session.
    await s.channels.replaceToken(channel.id, keys(matrix));
    await until(
      () => state(s, channel.id).then((st) => st === 'online'),
      'online with the new session',
    );
  });

  it('refuses an access token that another app’s session already uses', async () => {
    const { s, matrix, channel, home } = await paired();
    // The bot's own token: its session already has encryption keys, as Element's would.
    const kept = await new ChannelStore(home).secrets(channel.id);
    if (kept?.kind !== 'matrix' || !kept.accessToken) throw new Error('no session kept');
    await expect(
      s.channels.create({ kind: 'matrix', homeserver: matrix.base, accessToken: kept.accessToken }),
    ).rejects.toMatchObject({ field: 'accessToken' });
  });
});

describe('Matrix pieces', () => {
  it('keeps a user id as a Conch id, and reads it back', () => {
    const id = personId('@ada:matrix.org');
    expect(id).toMatch(/^X[A-Za-z0-9_-]+$/);
    expect(appId(id)).toBe('@ada:matrix.org');
    expect(personId('4242')).toBe('4242');
  });

  it('takes the homeserver from the user id, and never what only Conch sets', () => {
    expect(
      normalizeMatrix({
        kind: 'matrix',
        homeserver: '',
        user: '@me:example.org',
        password: 'pw',
        deviceId: 'X',
        storeKey: 'Y',
      }),
    ).toEqual({
      kind: 'matrix',
      homeserver: 'example.org',
      user: '@me:example.org',
      password: 'pw',
    });
  });

  it('decrypts an encrypted attachment, and refuses one changed on its way', () => {
    const key = randomBytes(32);
    const iv = Buffer.concat([randomBytes(8), Buffer.alloc(8)]);
    const plain = Buffer.from('a picture');
    const cipher = createCipheriv('aes-256-ctr', key, iv);
    const bytes = Buffer.concat([cipher.update(plain), cipher.final()]);
    const file = {
      url: 'mxc://x/y',
      key: { k: key.toString('base64url'), alg: 'A256CTR' },
      iv: iv.toString('base64').replace(/=+$/, ''),
      hashes: { sha256: createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '') },
    };
    expect(decryptAttachment(bytes, file).toString()).toBe('a picture');
    expect(() => decryptAttachment(Buffer.concat([bytes, Buffer.from('!')]), file)).toThrow(
      /changed/,
    );
  });
});
