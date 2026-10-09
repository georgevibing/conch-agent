import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerEvent, Task } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
          : id === 'c_app'
            ? { title: 'Claude Desktop', app: 'Claude Desktop' }
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
        input: { command: 'cd ~/conch && npm test' },
        summary: 'Run `cd ~/conch && npm test`',
        title: 'Run the tests in conch',
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(phone.subscription.endpoint);
    // The command's few plain words, never the command itself (ADR 0108).
    expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Pearl needs your OK',
      body: 'Run the tests in conch · Fix the build',
      url: '/c/c_chat?approve=p_1',
      tag: 'ok-p_1',
      answer: { conversationId: 'c_chat', permissionId: 'p_1', ticket: expect.any(String) },
      actions: [
        { action: 'allow', title: 'Allow' },
        { action: 'deny', title: 'Deny' },
      ],
      requireInteraction: true,
    });
  });

  it('says which app is asking when another app asks through Conch (ADR 0073)', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone · Safari', phone.subscription);
    await push.onEvent({
      type: 'conversation.event',
      event: {
        seq: 1,
        at: 1,
        conversationId: 'c_app',
        type: 'permission.requested',
        permissionId: 'p_2',
        toolName: 'mcp__notion__create',
        input: {},
        summary: 'create a page in Notion',
      },
    } as ServerEvent);
    expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Claude Desktop needs your OK',
      url: '/c/c_app?approve=p_2',
      // Another app's tool: Conch can't tell what it does, so it's for the app (ADR 0108).
      actions: [
        { action: 'open', title: 'Review' },
        { action: 'deny', title: 'Deny' },
      ],
    });
  });

  it('asks about a memory the check held, in its own words, never the memory’s (ADR 0087)', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone · Safari', phone.subscription);
    const memory = {
      id: 'm_1',
      content: 'Invoices are sent to billing@news.example',
      kind: 'fact' as const,
      source: 'agent' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    await push.onEvent(event({ type: 'memory.saved', memory }));
    expect(sent).toHaveLength(0);
    await push.onEvent(
      event({
        type: 'memory.saved',
        memory: {
          ...memory,
          pending: true,
          held: {
            verdict: 'ask',
            reasons: [{ code: 'redirect', words: 'It would change where invoices go.' }],
          },
        },
      }),
    );
    const shown = phone.read(sent[0]?.body ?? Buffer.alloc(0));
    expect(shown).toMatchObject({
      title: 'Pearl wants to check a memory with you',
      body: 'Something it was asked to remember looks off. · Fix the build',
      tag: 'memory-m_1',
      requireInteraction: true,
    });
    expect(JSON.stringify(shown)).not.toContain('billing@');
  });

  it('says the assistant has a question, without a Deny (ADR 0060)', async () => {
    const { push, sent } = setup();
    const phone = browser();
    await push.subscribe('device:phone', 'iPhone · Safari', phone.subscription);
    await push.onEvent(
      event({
        type: 'question',
        question: {
          questionId: 'q_1',
          fields: [{ id: 'when', label: 'Which day suits you?', kind: 'date', optional: false }],
        },
      }),
    );
    const shown = phone.read(sent[0]?.body ?? Buffer.alloc(0));
    expect(shown).toMatchObject({
      title: 'Pearl has a question',
      body: 'Which day suits you? · Fix the build',
      tag: 'ask-q_1',
      url: '/c/c_chat',
    });
    expect(shown).not.toHaveProperty('deny');
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
    // The retries and the note they leave land a moment later: wait for them.
    await vi.waitFor(async () => {
      expect(calls).toBe(3);
      expect((await store.list())[0]?.problem).toMatch(/busy/);
    });
  });

  describe('tasks (ADR 0033)', () => {
    const task = (over: Partial<Task> & { batchId?: string } = {}): Task =>
      ({
        id: 't_1',
        kind: 'background',
        title: 'Add dark mode',
        prompt: 'Add it',
        status: 'done',
        options: {},
        expectations: [{ tool: 'Write', minimum: 1 }],
        parentConversationId: 'c_main',
        conversationId: 'c_t1',
        createdAt: 1,
        finishedAt: 10,
        summary: 'Dark mode is in.',
        ...over,
      }) as Task;
    const changed = (t: Task): ServerEvent => ({ type: 'task.changed', task: t }) as ServerEvent;

    it('says a task is done, and opens at it in the chat it came from', async () => {
      const t = task();
      const { push, sent } = setup({ tasks: async () => [t] });
      const phone = browser();
      await push.subscribe('device:phone', 'iPhone', phone.subscription);
      await push.onEvent(changed(t));
      // The same change again says nothing new.
      await push.onEvent(changed(t));
      expect(sent).toHaveLength(1);
      expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
        title: 'Done: Add dark mode',
        body: 'Dark mode is in.',
        url: '/c/c_main?task=t_1',
        tag: 'task-t_1',
      });
    });

    it('tells about tasks started together once, when the last is over', async () => {
      const a = task({ id: 't_a', batchId: 'b', finishedAt: 10 });
      const b = task({ id: 't_b', batchId: 'b', status: 'running', finishedAt: undefined });
      let all = [a, b];
      const { push, sent } = setup({ tasks: async () => all });
      const phone = browser();
      await push.subscribe('device:phone', 'iPhone', phone.subscription);
      await push.onEvent(changed(a));
      expect(sent).toHaveLength(0);
      const over = { ...b, status: 'failed' as const, error: 'Tests failed', finishedAt: 20 };
      all = [a, over];
      await push.onEvent(changed(over));
      expect(sent).toHaveLength(1);
      expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
        title: '1 task done · 1 didn’t finish',
        tag: 'tasks-b',
        url: '/c/c_main?task=t_b',
      });
    });

    it('stays quiet about a task while a Conch page is in front of someone', async () => {
      const t = task();
      const { push, sent } = setup({ tasks: async () => [t] });
      await push.subscribe('device:phone', 'iPhone', browser().subscription);
      push.presence.open('device:laptop').set(true);
      await push.onEvent(changed(t));
      expect(sent).toHaveLength(0);
    });

    it('says a task needs your OK, and opens at it in the chat it came from', async () => {
      const t = task({ status: 'needs-you', finishedAt: undefined });
      const { push, sent } = setup({
        conversation: async () => ({ title: 'Add dark mode', task: true, taskId: 't_1' }),
        task: async (id) => (id === 't_1' ? t : undefined),
      });
      const phone = browser();
      await push.subscribe('device:phone', 'iPhone', phone.subscription);
      await push.onEvent({
        type: 'conversation.event',
        event: {
          seq: 1,
          at: 1,
          conversationId: 'c_t1',
          type: 'permission.requested',
          permissionId: 'p_t',
          toolName: 'Bash',
          input: {},
          summary: 'Run `npm test`',
        },
      } as ServerEvent);
      expect(phone.read(sent[0]?.body ?? Buffer.alloc(0))).toMatchObject({
        title: 'A task needs your OK',
        body: 'Run `npm test` · Add dark mode',
        url: '/c/c_main?task=t_1',
        // Allow and Deny answer the task's own chat, where it asked.
        answer: { conversationId: 'c_t1', permissionId: 'p_t', ticket: expect.any(String) },
        actions: [
          { action: 'allow', title: 'Allow' },
          { action: 'deny', title: 'Deny' },
        ],
        requireInteraction: true,
      });
    });
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

describe('approving from the notification (ADR 0108)', () => {
  const asked = (input: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    event({
      type: 'permission.requested',
      permissionId: 'p_1',
      toolName: 'Bash',
      input,
      summary: 'Run it',
      ...extra,
    });

  async function sentTo(extra: Record<string, unknown> = {}, prefs = {}) {
    let now = 1_000;
    const ctx = setup({ now: () => now });
    const phone = browser();
    const laptop = browser();
    await ctx.push.subscribe('device:phone', 'iPhone', phone.subscription, prefs);
    await ctx.push.subscribe('device:laptop', 'Mac', laptop.subscription);
    await ctx.push.onEvent(asked({ command: 'npm test' }, extra));
    const to = (b: ReturnType<typeof browser>) =>
      b.read(ctx.sent.find((x) => x.url === b.subscription.endpoint)?.body ?? Buffer.alloc(0));
    const shown = to(phone);
    const other = to(laptop);
    const ticket = (shown.answer as { ticket: string }).ticket;
    const otherTicket = (other.answer as { ticket: string }).ticket;
    const answers: string[] = [];
    const respond = async (_c: string, _p: string, decision: string) => {
      answers.push(decision);
    };
    const answer = (owner: string, body: Record<string, unknown>, verified = false) =>
      ctx.push.answer(
        owner,
        { conversationId: 'c_chat', permissionId: 'p_1', ...body },
        { verified, respond },
      );
    return {
      ...ctx,
      shown,
      ticket,
      otherTicket,
      answers,
      answer,
      later: (ms: number) => (now += ms),
    };
  }

  it('allows a routine step with one tap, once, from the device it was sent to', async () => {
    const { ticket, answer, answers } = await sentTo();
    expect(await answer('device:phone', { ticket, decision: 'allow' })).toEqual({
      outcome: 'answered',
    });
    // Replayed: the ticket was spent.
    expect(await answer('device:phone', { ticket, decision: 'allow' })).toEqual({
      outcome: 'gone',
    });
    expect(answers).toEqual(['allow']);
  });

  it('gives each device its own ticket, and one answer spends them all', async () => {
    const { ticket, otherTicket, answer, answers } = await sentTo();
    expect(ticket).not.toBe(otherTicket);
    // The phone's ticket is no good from the laptop's sign-in.
    expect(await answer('device:laptop', { ticket, decision: 'allow' })).toEqual({
      outcome: 'gone',
    });
    expect(await answer('device:laptop', { ticket: otherTicket, decision: 'allow' })).toEqual({
      outcome: 'answered',
    });
    expect(answers).toEqual(['allow']);
  });

  it('a ticket answers only its own question', async () => {
    const { ticket, push, answers } = await sentTo();
    const result = await push.answer(
      'device:phone',
      { conversationId: 'c_chat', permissionId: 'p_other', ticket, decision: 'allow' },
      { verified: true, respond: async (_c, _p, d) => void answers.push(d) },
    );
    expect(result).toEqual({ outcome: 'gone' });
    expect(answers).toEqual([]);
  });

  it('is no good once answered elsewhere, or after half an hour', async () => {
    const elsewhere = await sentTo();
    await elsewhere.push.onEvent(
      event({ type: 'permission.resolved', permissionId: 'p_1', decision: 'deny' }),
    );
    expect(
      await elsewhere.answer('device:phone', { ticket: elsewhere.ticket, decision: 'allow' }),
    ).toEqual({ outcome: 'gone' });
    expect(elsewhere.answers).toEqual([]);

    const late = await sentTo();
    late.later(30 * 60 * 1000 + 1);
    expect(await late.answer('device:phone', { ticket: late.ticket, decision: 'allow' })).toEqual({
      outcome: 'gone',
    });
    expect(late.answers).toEqual([]);
  });

  it('offers only Review for a step that matters, and a ticket can’t allow it', async () => {
    for (const extra of [
      { input: { command: 'rm -rf build' } },
      { toolName: 'mcp__conch__google_mail_send', input: { to: 'a@b.c' } },
      { cost: 'Paid · about $0.04' },
      { taint: 'This chat read a web page.' },
      { toolName: 'mcp__github__delete_repo', input: {} },
    ]) {
      const { shown, ticket, answer, answers } = await sentTo(extra);
      expect(shown.actions, JSON.stringify(extra)).toEqual([
        { action: 'open', title: 'Review' },
        { action: 'deny', title: 'Deny' },
      ]);
      expect(await answer('device:phone', { ticket, decision: 'allow' })).toEqual({
        outcome: 'open',
      });
      expect(answers).toEqual([]);
    }
  });

  it('never offers Allow when the notification doesn’t say what it is', async () => {
    const { shown, ticket, answer, answers } = await sentTo({}, { previews: false });
    expect(shown.body).toBe('Open Conch to see what it’s asking.');
    expect(shown.actions).toEqual([
      { action: 'open', title: 'Review' },
      { action: 'deny', title: 'Deny' },
    ]);
    expect(await answer('device:phone', { ticket, decision: 'allow' })).toEqual({
      outcome: 'open',
    });
    // Deny still works with one.
    const again = await sentTo({}, { previews: false });
    expect(await again.answer('device:phone', { ticket: again.ticket, decision: 'deny' })).toEqual({
      outcome: 'answered',
    });
    expect([...answers, ...again.answers]).toEqual(['deny']);
  });

  it('the sheet allows a step that matters only after you confirm it’s you', async () => {
    const { push, answer, answers } = await sentTo({ input: { command: 'git push --force' } });
    expect(push.approval('c_chat', 'p_1')).toMatchObject({
      waiting: true,
      confirm: expect.stringMatching(/\w/),
      expiresAt: 1_000 + 30 * 60 * 1000,
    });
    expect(push.approval('c_other', 'p_1')).toEqual({ waiting: false });
    expect(await answer('device:phone', { decision: 'allow' })).toBe('verify');
    expect(answers).toEqual([]);
    expect(await answer('device:phone', { decision: 'allow' }, true)).toEqual({
      outcome: 'answered',
    });
    expect(answers).toEqual(['allow']);
  });

  it('the sheet allows a routine step with a press', async () => {
    const { push, answer, answers } = await sentTo();
    expect(push.approval('c_chat', 'p_1')).not.toHaveProperty('confirm');
    expect(await answer('device:phone', { decision: 'allow' })).toEqual({ outcome: 'answered' });
    expect(answers).toEqual(['allow']);
  });
});
