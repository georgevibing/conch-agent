/**
 * Notifications (ADR 0027): Conch tells your phone and your other devices
 * what needs you while you're away — an OK it's waiting for, an answer that
 * came, a routine that ran, a new device asking to sign in — through each
 * browser's own push service, encrypted end to end (`webpush.ts`).
 *
 * Quiet by design:
 * - nothing is sent while a Conch page is in front of you on any device
 *   (each page says whether it's visible; `presence`);
 * - one notification per thing (a `tag` replaces the last one about it);
 * - each device chooses what it's told, and whether it says what it's about.
 *
 * A device can only be told about anything while it's still allowed in:
 * signing it out or removing it ends its notifications too.
 */
import {
  taskFinishNotice,
  type PushAnswerBody,
  type PushAnswerResult,
  type PushApproval,
  taskLink,
  type PushDevice,
  type PushPrefs,
  type PushStatus,
  type PushSubscriptionJson,
  type PushTopic,
  type RoutineSpending,
  type ServerEvent,
  type Task,
} from '@conch/protocol';

import { pausedWords } from '../routines/spend';
import { APPROVAL_WAIT_MS, ApprovalTickets, lockScreenCheck, type LockScreen } from './approve';
import type { PushStore, Subscription } from './store';
import { sendPush, type Fetcher } from './webpush';

/** Who signs Conch's pushes (RFC 8292 `sub`): a way to reach whoever runs it. */
export const PUSH_SUBJECT = 'https://github.com/georgevibing/conch-agent';

/** What a notification says: the service worker shows it (`apps/web/public/sw.js`). */
export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap opens Conch. */
  url: string;
  /** A later notification about the same thing replaces this one. */
  tag: string;
  /** Said even with previews off: "Open Conch to see what it needs." */
  quiet?: string;
  actions?: { action: string; title: string }[];
  /**
   * The question Allow and Deny answer (`POST /api/push/answer`, ADR 0108):
   * each device gets its own one-use ticket for it, and Allow only when a
   * lock-screen tap may allow it (`quick`) and the device shows what it is.
   */
  answer?: { conversationId: string; permissionId: string; quick: boolean };
  requireInteraction?: boolean;
  urgency?: 'normal' | 'high';
}

export interface PushDeps {
  store: PushStore;
  /** The assistant's name, for "Conch needs your OK": the chat's agent's, else the default's (ADR 0101). */
  persona: (conversationId?: string) => Promise<string>;
  conversation: (id: string) => Promise<
    | {
        title: string;
        routine?: boolean;
        channel?: boolean;
        task?: boolean;
        /** The task it runs, when it's a task's own chat. */
        taskId?: string;
        /** Another app's chat (ADR 0073): the app is who's asking. */
        app?: string;
        /** Its work folder: changing files there is the work. */
        workspace?: string;
      }
    | undefined
  >;
  /** Every task there is: a batch is told about once its last one is over. */
  tasks?: () => Promise<Task[]>;
  task?: (id: string) => Promise<Task | undefined>;
  routineTitle: (id: string) => Promise<string | undefined>;
  /** Still allowed in: signed in, not removed. */
  ownerExists: (owner: string) => Promise<boolean>;
  fetch?: Fetcher;
  now?: () => number;
  /** How long to wait before trying a busy push service again. */
  retryMs?: (afterMs: number) => number;
}

/** Each page of Conch says whether it's in front of someone. */
export class Presence {
  readonly #pages = new Map<symbol, { owner: string; visible: boolean; at: number }>();

  /** A new page; returns how to say it's gone. */
  open(owner: string): { set: (visible: boolean) => void; close: () => void } {
    const key = Symbol(owner);
    this.#pages.set(key, { owner, visible: false, at: Date.now() });
    return {
      set: (visible) => this.#pages.set(key, { owner, visible, at: Date.now() }),
      close: () => this.#pages.delete(key),
    };
  }

  /** Someone has a Conch page in front of them, on any device. */
  watching(): boolean {
    return [...this.#pages.values()].some((p) => p.visible);
  }
}

const MAX_BODY = 180;
const clip = (text: string, max = MAX_BODY) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

export class PushService {
  readonly presence = new Presence();
  /** Tasks already told about, so a repeated change doesn't notify twice. */
  readonly #told = new Set<string>();
  /** What each conversation's assistant last said, for "Conch replied". */
  readonly #replies = new Map<string, string>();
  /** The tickets a notification's Allow and Deny carry (ADR 0108). */
  readonly tickets: ApprovalTickets;
  /** Questions still waiting, and whether a lock-screen tap may allow each one. */
  readonly #asked = new Map<
    string,
    { conversationId: string; check: LockScreen; expiresAt: number }
  >();

  constructor(private readonly deps: PushDeps) {
    this.tickets = new ApprovalTickets(() => this.#now());
  }

  get #now() {
    return this.deps.now ?? Date.now;
  }

  async status(owner: string | undefined): Promise<PushStatus> {
    const vapid = await this.deps.store.vapid();
    const devices: PushDevice[] = [];
    for (const s of await this.deps.store.list()) {
      if (!(await this.deps.ownerExists(s.owner))) continue;
      devices.push({
        id: s.id,
        name: s.name,
        current: s.owner === owner,
        ...(s.owner.startsWith('device:') && { deviceId: s.owner.slice('device:'.length) }),
        createdAt: s.createdAt,
        lastSentAt: s.lastSentAt,
        problem: s.problem,
        prefs: s.prefs,
      });
    }
    return { publicKey: vapid.publicKey, devices };
  }

  async subscribe(
    owner: string,
    name: string,
    subscription: PushSubscriptionJson,
    prefs?: Partial<PushPrefs>,
  ): Promise<Subscription> {
    // The browser subscribed with this key: make sure it's the one kept.
    await this.deps.store.vapid();
    return this.deps.store.add({ owner, name, subscription, prefs });
  }

  renew(owner: string, old: string | undefined, next: PushSubscriptionJson) {
    return this.deps.store.renew(owner, old, next);
  }

  async update(id: string, prefs: Partial<PushPrefs>): Promise<boolean> {
    const found = (await this.deps.store.list()).find((s) => s.id === id);
    if (!found) return false;
    await this.deps.store.update(id, { prefs: { ...found.prefs, ...prefs } });
    return true;
  }

  async remove(id: string): Promise<boolean> {
    return (await this.deps.store.remove((s) => s.id === id)) > 0;
  }

  /** Signed out or removed: no more notifications to those. */
  async forget(owners: string[]): Promise<void> {
    if (owners.length) await this.deps.store.remove((s) => owners.includes(s.owner));
  }

  /** "Notifications are on": sent to the device that asked, right away, even while it looks. */
  async test(owner: string): Promise<number> {
    const mine = (await this.deps.store.list()).filter((s) => s.owner === owner);
    const name = await this.deps.persona();
    let sent = 0;
    for (const s of mine) {
      const ok = await this.#deliver(
        s,
        {
          title: `${name} can reach you here`,
          body: 'This is how it tells you when it needs you.',
          url: '/',
          tag: 'test',
        },
        { always: true },
      );
      if (ok) sent += 1;
    }
    return sent;
  }

  /** Tell every device that wants to hear about `topic`, unless someone's already looking. */
  async notify(topic: PushTopic, message: PushMessage, options: { except?: string } = {}) {
    if (this.presence.watching()) return 0;
    let sent = 0;
    for (const s of await this.deps.store.list()) {
      if (!s.prefs[topic] || s.owner === options.except) continue;
      if (!(await this.deps.ownerExists(s.owner))) {
        await this.deps.store.remove((x) => x.id === s.id);
        continue;
      }
      if (await this.#deliver(s, message)) sent += 1;
    }
    return sent;
  }

  /**
   * A question's buttons for this one device: Allow only when a lock-screen tap
   * may allow it and the notification says what it is (previews on), and a
   * ticket of its own for whatever it answers.
   */
  #answering(s: Subscription, message: PushMessage) {
    if (!message.answer) return message.actions ? { actions: message.actions } : {};
    const { conversationId, permissionId } = message.answer;
    const quick = message.answer.quick && s.prefs.previews;
    const ticket = this.tickets.issue(s.owner, conversationId, permissionId, quick);
    return {
      actions: quick
        ? [
            { action: 'allow', title: 'Allow' },
            { action: 'deny', title: 'Deny' },
          ]
        : [
            { action: 'open', title: 'Review' },
            { action: 'deny', title: 'Deny' },
          ],
      answer: { conversationId, permissionId, ticket },
      // What the first service worker read: it can only ever deny.
      deny: { conversationId, permissionId },
    };
  }

  /**
   * Why allowing this question needs a recent passkey or password from a
   * device that isn't this computer, in a few words; undefined for an
   * everyday step (ADR 0108). The chat's own card and the approval sheet
   * both ask this, so both behave the same.
   */
  confirmFor(conversationId: string, permissionId: string): string | undefined {
    const asked = this.#asked.get(permissionId);
    if (!asked || asked.conversationId !== conversationId || asked.check.quick) return undefined;
    return asked.check.why;
  }

  /** What the approval sheet shows before it's answered (ADR 0108). */
  approval(conversationId: string, permissionId: string): PushApproval {
    const asked = this.#asked.get(permissionId);
    if (!asked || asked.conversationId !== conversationId) return { waiting: false };
    return {
      waiting: true,
      ...(!asked.check.quick && { confirm: asked.check.why }),
      expiresAt: asked.expiresAt,
    };
  }

  /**
   * An answer from a notification or the approval sheet (ADR 0108).
   *
   * - With a ticket (a notification's button): spent whatever comes of it,
   *   good only for this device's sign-in and this one question; Allow only
   *   where a lock-screen tap may allow it.
   * - Without (the sheet, in Conch): Deny always; Allow for a step that
   *   matters only after a recent passkey or password (`verified`).
   */
  async answer(
    owner: string | undefined,
    body: PushAnswerBody,
    options: {
      verified: boolean;
      respond: (
        conversationId: string,
        permissionId: string,
        decision: 'allow' | 'deny',
      ) => Promise<void>;
    },
  ): Promise<PushAnswerResult | 'verify'> {
    const decision = body.decision ?? 'deny';
    const asked = this.#asked.get(body.permissionId);
    const waiting = asked?.conversationId === body.conversationId;
    if (body.ticket) {
      const spent = this.tickets.redeem(body.ticket, owner);
      if (
        !spent.ok ||
        spent.ticket.permissionId !== body.permissionId ||
        spent.ticket.conversationId !== body.conversationId
      )
        return { outcome: 'gone' };
      if (decision === 'allow' && !spent.ticket.quick) return { outcome: 'open' };
    } else if (decision === 'allow' && waiting && asked?.check.quick === false && !options.verified)
      return 'verify';
    if (!waiting) {
      // A no to something that isn't waiting any more changes nothing; say so.
      if (decision === 'deny')
        await options
          .respond(body.conversationId, body.permissionId, 'deny')
          .catch(() => undefined);
      return { outcome: 'gone' };
    }
    await options.respond(body.conversationId, body.permissionId, decision);
    return { outcome: 'answered' };
  }

  async #deliver(
    s: Subscription,
    message: PushMessage,
    options: { always?: boolean; attempt?: number } = {},
  ): Promise<boolean> {
    const body = s.prefs.previews
      ? message.body
      : (message.quiet ?? 'Open Conch to see what it is.');
    const payload = JSON.stringify({
      title: message.title,
      body,
      url: message.url,
      tag: message.tag,
      ...this.#answering(s, message),
      ...(message.requireInteraction && { requireInteraction: true }),
      ...(options.always && { always: true }),
    });
    const outcome = await sendPush(s.subscription, payload, {
      vapid: await this.deps.store.vapid(),
      subject: PUSH_SUBJECT,
      urgency: message.urgency ?? 'normal',
      topic: message.tag,
      ttlSeconds: message.urgency === 'high' ? 3600 : 6 * 3600,
      fetch: this.deps.fetch,
    });
    if (outcome.kind === 'sent') {
      await this.deps.store.update(s.id, { lastSentAt: this.#now(), problem: undefined });
      return true;
    }
    if (outcome.kind === 'gone') {
      // The browser turned them off, or the subscription ran out: it subscribes again when it can.
      await this.deps.store.remove((x) => x.id === s.id);
      return false;
    }
    if (outcome.kind === 'retry' && (options.attempt ?? 0) < 2) {
      const wait = (this.deps.retryMs ?? ((ms) => Math.min(ms, 5 * 60_000)))(outcome.afterMs);
      setTimeout(
        () => void this.#deliver(s, message, { ...options, attempt: (options.attempt ?? 0) + 1 }),
        wait,
      ).unref?.();
      return false;
    }
    await this.deps.store.update(s.id, {
      problem:
        outcome.kind === 'failed'
          ? outcome.message
          : 'The push service was busy, so the last notification didn’t arrive.',
    });
    return false;
  }

  /**
   * A new release of Conch is ready (ADR 0051): said once per version, only
   * to devices that turned `updates` on (it's off until they do).
   */
  async releaseReady(version: string): Promise<void> {
    const short = version.replace(/^(\d+\.\d+)\.0$/, '$1');
    await this.notify('updates', {
      title: `Conch ${short} is ready`,
      body: 'See what’s new, and update when it suits you.',
      quiet: 'A new version of Conch is ready.',
      url: '/?open=updates',
      tag: 'conch-update',
    });
  }

  /** Routines reached this month's limit (ADR 0057): said once, by `RoutineSpend`. */
  async routinesPaused(spending: RoutineSpending): Promise<void> {
    const { title, body } = pausedWords(spending);
    await this.notify('routines', {
      title,
      body,
      quiet: 'Your routines are paused for the rest of the month.',
      url: '/routines',
      tag: 'routines-paused',
    });
  }

  /** Conch's live stream, turned into the notifications that matter. */
  async onEvent(event: ServerEvent): Promise<void> {
    if (event.type === 'task.changed') {
      // A task you sent away is over (ADR 0033); tasks started together say so
      // together, once the last is over. A helper's result goes back to its chat.
      const notice = taskFinishNotice(event.task, (await this.deps.tasks?.()) ?? []);
      if (!notice) return;
      const key = `${notice.tag}:${Math.max(...notice.tasks.map((t) => t.finishedAt ?? 0))}`;
      if (this.#told.has(key)) return;
      this.#told.add(key);
      await this.notify('tasks', {
        title: notice.title,
        body: notice.body ?? '',
        quiet: notice.quiet,
        url: notice.url,
        tag: notice.tag,
      });
      return;
    }
    if (event.type === 'routine.run') {
      const run = event.run;
      // Only what's worth hearing about: it ran and has something, or it didn't finish.
      // "Nothing to do" stays quiet; an OK it needs arrives as its own notification.
      if (!run.finishedAt || (run.status !== 'succeeded' && run.status !== 'failed')) return;
      const title = (await this.deps.routineTitle(run.routineId)) ?? 'Your routine';
      await this.notify('routines', {
        title,
        body: clip(
          run.status === 'failed'
            ? `Didn’t finish: ${run.error ?? 'something went wrong'}`
            : (run.outcome ?? 'Done.'),
        ),
        quiet: run.status === 'failed' ? 'It didn’t finish.' : 'It ran.',
        url: run.conversationId ? `/c/${run.conversationId}` : `/routines/${run.routineId}`,
        tag: `routine-${run.routineId}`,
      });
      return;
    }
    if (event.type !== 'conversation.event') return;
    const e = event.event;
    const url = `/c/${e.conversationId}`;
    if (e.type === 'user.message') this.#replies.delete(e.conversationId);
    if (e.type === 'assistant.delta' && e.kind === 'text') {
      const said = (this.#replies.get(e.conversationId) ?? '') + e.delta;
      this.#replies.set(e.conversationId, said.slice(-2_000));
      return;
    }
    if (e.type === 'permission.resolved') {
      // Answered anywhere (or it ran out): every ticket for it is spent.
      this.#asked.delete(e.permissionId);
      this.tickets.forget(e.permissionId);
      return;
    }
    if (e.type === 'permission.requested') {
      // Judged at once (strictly: no work folder yet, so every file is outside it), so
      // an answer that comes before the chat is looked up is never let through on less.
      const expiresAt = this.#now() + APPROVAL_WAIT_MS;
      this.#asked.set(e.permissionId, {
        conversationId: e.conversationId,
        check: lockScreenCheck(e, '\0'),
        expiresAt,
      });
      const chat = await this.deps.conversation(e.conversationId);
      const check = lockScreenCheck(e, chat?.workspace ?? '\0');
      if (this.#asked.has(e.permissionId))
        this.#asked.set(e.permissionId, { conversationId: e.conversationId, check, expiresAt });
      // A task asking opens at it, in the chat it came from: answered there.
      const task = chat?.taskId ? await this.deps.task?.(chat.taskId) : undefined;
      // Another app asking through Conch says so: the OK is for it, not your assistant.
      const name = task ? 'A task' : (chat?.app ?? (await this.deps.persona(e.conversationId)));
      const about = task?.title ?? chat?.title;
      // What it would do in a few words, as the sheet's heading says it: never the command.
      const said = e.title ?? e.summary;
      await this.notify('approvals', {
        title: `${name} needs your OK`,
        body: clip(about ? `${said} · ${about}` : said),
        quiet: 'Open Conch to see what it’s asking.',
        // Straight to the approval sheet; a task's opens in the chat it came from.
        url: task ? taskLink(task) : `${url}?approve=${encodeURIComponent(e.permissionId)}`,
        tag: `ok-${e.permissionId}`,
        answer: {
          conversationId: e.conversationId,
          permissionId: e.permissionId,
          quick: check.quick,
        },
        requireInteraction: true,
        urgency: 'high',
      });
      return;
    }
    // A memory the check held (ADR 0087): waiting for you, like an OK. The words
    // are Conch's own, never the memory's: a lock screen is no place for a plant.
    if (e.type === 'memory.saved' && e.memory.held) {
      const name = await this.deps.persona(e.conversationId);
      const chat = await this.deps.conversation(e.conversationId);
      const what =
        e.memory.held.verdict === 'refuse'
          ? 'Something it was asked to remember was refused.'
          : 'Something it was asked to remember looks off.';
      await this.notify('approvals', {
        title: `${name} wants to check a memory with you`,
        body: clip(chat?.title ? `${what} · ${chat.title}` : what),
        quiet: 'Open Conch to see it.',
        url,
        tag: `memory-${e.memory.id}`,
        actions: [{ action: 'open', title: 'Review' }],
        requireInteraction: true,
        urgency: 'high',
      });
      return;
    }
    // A question with answers to tap (ADR 0060): waiting for you, like an OK.
    if (e.type === 'question') {
      const name = await this.deps.persona(e.conversationId);
      const chat = await this.deps.conversation(e.conversationId);
      const asked = e.question.title ?? e.question.fields[0]?.label ?? '';
      await this.notify('approvals', {
        title: `${name} has a question`,
        body: clip(chat?.title ? `${asked} · ${chat.title}` : asked),
        quiet: 'Open Conch to answer.',
        url,
        tag: `ask-${e.question.questionId}`,
        actions: [{ action: 'open', title: 'Answer' }],
        requireInteraction: true,
        urgency: 'high',
      });
      return;
    }
    if (e.type === 'vault.request' && e.request.state === 'waiting') {
      const name = await this.deps.persona(e.conversationId);
      await this.notify('approvals', {
        title:
          e.request.kind === 'unlock'
            ? `${name} needs Passwords unlocked`
            : `${name} needs a sign-in`,
        body: clip(e.request.reason ?? e.request.site ?? 'Open Conch to answer.'),
        quiet: 'Open Conch to answer.',
        url,
        tag: `vault-${e.request.requestId}`,
        requireInteraction: true,
        urgency: 'high',
      });
      return;
    }
    if (e.type === 'browser.handoff' && e.handoff.state === 'waiting') {
      const name = await this.deps.persona(e.conversationId);
      await this.notify('approvals', {
        title: `${name} needs you in the browser`,
        body: clip(e.handoff.reason),
        quiet: 'Open Conch to take over.',
        // Straight to the page: the panel opens by itself while it's your turn.
        url: `${url}?browser=1`,
        tag: `hand-${e.handoff.handoffId}`,
        actions: [{ action: 'open', title: 'Take over' }],
        requireInteraction: true,
        urgency: 'high',
      });
      return;
    }
    if (e.type === 'turn.completed') {
      const said = this.#replies.get(e.conversationId);
      this.#replies.delete(e.conversationId);
      if (e.outcome !== 'success' || !said?.trim()) return;
      const chat = await this.deps.conversation(e.conversationId);
      // A routine's run says so once it's done; a chat app already got its answer there.
      if (!chat || chat.routine || chat.channel || chat.task) return;
      const name = await this.deps.persona(e.conversationId);
      await this.notify('replies', {
        title: chat.title ? `${name} · ${clip(chat.title, 60)}` : `${name} replied`,
        body: clip(said),
        quiet: 'Your answer is ready.',
        url,
        tag: `reply-${e.conversationId}`,
      });
    }
  }

  /** A new device asks to sign in (ADR 0024): every device already in hears it. */
  async deviceWaiting(request: { device: string; code: string; deviceId: string }) {
    await this.notify(
      'devices',
      {
        title: 'A new device wants to sign in',
        body: `${request.device}, code ${request.code}. Approve it in Settings → Access, or ignore it.`,
        quiet: 'Open Conch to see who it is.',
        url: '/?open=devices',
        tag: `device-${request.code}`,
        requireInteraction: true,
        urgency: 'high',
      },
      { except: `device:${request.deviceId}` },
    );
  }
}
