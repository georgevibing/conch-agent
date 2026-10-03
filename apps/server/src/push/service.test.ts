import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerEvent } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PushService, type PushDeps } from './service';
import { PushStore } from './store';

/** A browser: its keys, and what it would show for a push. */
function browser(
  endpoint = `https://fcm.googleapis.com/fcm/send/${Math.random().toString(36).slice(2)}`,
) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.alloc(16, 9);
  const read = (body: Buffer) => {
    const salt = body.subarray(0, 16);
    const idlen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idlen);
    const secret = ecdh.computeSecret(asPublic);
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
    const cek = Buffer.from(
      hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    );
    const nonce = Buffer.from(
      hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
    );
    const record = body.subarray(21 + idlen);
    const d = createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(record.subarray(-16));
    const plain = Buffer.concat([d.update(record.subarray(0, -16)), d.final()]);
    return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString()) as Record<
      string,
      unknown
    >;
  };
  return {
    subscription: {
      endpoint,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    },
    read,
  };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'conch-push-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function setup(overrides: Partial<PushDeps> = {}, status = () => 201) {
  const sent: { url: string; body: Buffer }[] = [];
  const store = new PushStore(home);
  const allowed = new Set(['device:phone', 'device:laptop', 'local']);
  const push = new PushService({
    store,
    persona: async () => 'Pearl',
    conversation: async (id) =>
      id === 'c_routine'
        ? { title: 'Morning briefing', routine: true }
        : id === 'c_telegram'
          ? { title: 'From Telegram', channel: true }
          : { title: 'Fix the build' },
    routineTitle: async () => 'Morning briefing',
    ownerExists: async (owner) => allowed.has(owner),
    fetch: async (url, init) => {
      sent.push({ url, body: Buffer.from(init.body as Buffer) });
      return new Response('', { status: status() });
    },
    retryMs: () => 1,
    ...overrides,
  });
  return { push, store, sent, allowed };
}

const event = (e: Record<string, unknown>): ServerEvent =>
  ({
    type: 'conversation.event',
    event: { seq: 1, at: 1, conversationId: 'c_chat', ...e },
  }) as ServerEvent;

describe('notifications', () => {
  it('asks for an OK on every device that wants it, encrypted to each browser', async () => {
    const { push, sent } = setup();
    const phone = browser();
    const laptop = browser();
    await push.subscribe('device:phone', 'iPhone · Safari', phone.subscription);
    await push.subscribe('device:laptop', 'Mac · Chrome', laptop.subscription, {
      approvals: false,
    });
    await push.onEvent(
      event({
        type: 'permission.requested',
        permissionId: 'p_1',
        toolName: 'Bash',
        input: {},
        summary: 'Run `npm test`',
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(phone.subscription.endpoint);
    expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Pearl needs your OK',
      body: 'Run `npm test` · Fix the build',
      url: '/c/c_chat',
      tag: 'ok-p_1',
      deny: { conversationId: 'c_chat', permissionId: 'p_1' },
      requireInteraction: true,
    });
  });

  it('stays quiet while a Conch page is in front of someone', async () => {
    const { push, sent } = setup();
    await push.subscribe('device:phone', 'iPhone', browser().subscription);
    const page = push.presence.open('device:laptop');
    page.set(true);
    await push.onEvent(
      event({
        type: 'permission.requested',
        permissionId: 'p',
        toolName: 'x',
        input: {},
        summary: 's',
      }),
    );
    expect(sent).toHaveLength(0);
    page.set(false);
    await push.onEvent(
      event({
        type: 'permission.requested',
        permissionId: 'p',
        toolName: 'x',
        input: {},
        summary: 's',
      }),
    );
    expect(sent).toHaveLength(1);
    page.close();
  });

  it('says only that something needs you when previews are off', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone', phone.subscription, { previews: false });
    await push.onEvent(
      event({
        type: 'permission.requested',
        permissionId: 'p',
        toolName: 'x',
        input: {},
        summary: 'Delete `~/Photos`',
      }),
    );
    const shown = phone.read(sent[0]?.body ?? Buffer.alloc(0));
    expect(shown.body).toBe('Open Conch to see what it’s asking.');
    expect(JSON.stringify(shown)).not.toContain('Photos');
  });

  it('says the answer came, in its own words, but not for routines or chat apps', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone', phone.subscription);
    await push.onEvent(event({ type: 'user.message', messageId: 'm', text: 'why?' }));
    await push.onEvent(
      event({
        type: 'assistant.delta',
        messageId: 'a',
        kind: 'text',
        delta: 'The build broke because ',
      }),
    );
    await push.onEvent(
      event({ type: 'assistant.delta', messageId: 'a', kind: 'thinking', delta: 'hmm' }),
    );
    await push.onEvent(
      event({ type: 'assistant.delta', messageId: 'a', kind: 'text', delta: 'a test timed out.' }),
    );
    await push.onEvent(event({ type: 'turn.completed', outcome: 'success' }));
    expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Pearl · Fix the build',
      body: 'The build broke because a test timed out.',
      tag: 'reply-c_chat',
    });
    for (const conversationId of ['c_routine', 'c_telegram']) {
      await push.onEvent(
        event({
          conversationId,
          type: 'assistant.delta',
          messageId: 'a',
          kind: 'text',
          delta: 'Hi',
        }),
      );
      await push.onEvent(event({ conversationId, type: 'turn.completed', outcome: 'success' }));
    }
    expect(sent).toHaveLength(1);
  });

  it('says what a routine found, and when it didn’t finish; “nothing to do” stays quiet', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone', phone.subscription);
    const run = (status: string, extra: Record<string, unknown> = {}) =>
      push.onEvent({
        type: 'routine.run',
        run: {
          id: 'r1',
          routineId: 'rt',
          trigger: 'schedule',
          status,
          startedAt: 1,
          finishedAt: 2,
          conversationId: 'c_routine',
          ...extra,
        },
      } as ServerEvent);
    await run('nothing-to-do');
    await run('running', { finishedAt: undefined });
    expect(sent).toHaveLength(0);
    await run('succeeded', { outcome: 'Three meetings today; the first at 9.' });
    expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Morning briefing',
      body: 'Three meetings today; the first at 9.',
      url: '/c/c_routine',
    });
    await run('failed', { error: 'Calendar was signed out' });
    expect(phone.read(sent[1]?.body ?? Buffer.alloc(0)).body).toBe(
      'Didn’t finish: Calendar was signed out',
    );
  });

  it('says routines paused at their monthly limit, and where to look (ADR 0057)', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone', phone.subscription);
    await push.routinesPaused({
      limitUsd: 20,
      isDefault: true,
      monthUsd: 20.4,
      paused: { until: new Date(2026, 10, 1).getTime(), dismissed: false },
    });
    expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Your routines are paused',
      body: 'Your routines have used $20.40 this month, so the ones that cost money are paused until November 1. You can raise the limit in Conch.',
      url: '/routines',
    });
  });

  it('tells the devices already in about a new one, not the new one itself', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone', phone.subscription);
    await push.subscribe('device:laptop', 'Mac', browser().subscription);
    await push.deviceWaiting({ device: 'Firefox on Windows', code: 'K7M-Q2X', deviceId: 'laptop' });
    expect(sent).toHaveLength(1);
    expect(phone.read(sent[0]?.body ?? Buffer.alloc(0)).body).toMatch(
      /Firefox on Windows, code K7M-Q2X/,
    );
  });

  it('forgets a device that was signed out or removed, and one the push service says is gone', async () => {
    const { push, sent, allowed, store } = setup();
    await push.subscribe('device:phone', 'iPhone', browser().subscription);
    allowed.delete('device:phone');
    await push.onEvent(
      event({
        type: 'permission.requested',
        permissionId: 'p',
        toolName: 'x',
        input: {},
        summary: 's',
      }),
    );
    expect(sent).toHaveLength(0);
    expect(await store.list()).toHaveLength(0);

    const gone = setup({}, () => 410);
    await gone.push.subscribe('device:phone', 'iPhone', browser().subscription);
    await gone.push.onEvent(
      event({
        type: 'permission.requested',
        permissionId: 'p',
        toolName: 'x',
        input: {},
        summary: 's',
      }),
    );
    expect(await gone.store.list()).toHaveLength(0);
  });

  it('tries a busy push service again, then says so', async () => {
    let calls = 0;
    const { push, store } = setup({}, () => (++calls, 503));
    await push.subscribe('device:phone', 'iPhone', browser().subscription);
    await push.onEvent(
      event({
        type: 'permission.requested',
        permissionId: 'p',
        toolName: 'x',
        input: {},
        summary: 's',
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(3);
    expect((await store.list())[0]?.problem).toMatch(/busy/);
  });

  it('a test reaches the device that asked, even while it’s looking', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone', phone.subscription);
    await push.subscribe('device:laptop', 'Mac', browser().subscription);
    push.presence.open('device:phone').set(true);
    expect(await push.test('device:phone')).toBe(1);
    expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Pearl can reach you here',
      always: true,
    });
  });

  it('keeps its key and the subscriptions sealed away from plain text', async () => {
    const { push } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone', phone.subscription);
    const status = await push.status('device:phone');
    expect(status.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(status.devices).toMatchObject([{ name: 'iPhone', current: true }]);
    // Without a sealer registered (a test), the file is still only its owner's.
    const text = readFileSync(join(home, 'push.secrets.json'), 'utf8');
    expect(text).toContain('subscriptions');
  });
});
