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
import type {
  PushDevice,
  PushPrefs,
  PushStatus,
  PushSubscriptionJson,
  PushTopic,
  ServerEvent,
} from '@conch/protocol';

import type { PushStore, Subscription } from './store';
import { sendPush, type Fetcher } from './webpush';

/** Who signs Conch's pushes (RFC 8292 `sub`): a way to reach whoever runs it. */
export const PUSH_SUBJECT = 'https://github.com/giotiskl/conch-agent';

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
  /** What the Deny action answers (`POST /api/push/answer`). */
  deny?: { conversationId: string; permissionId: string };
  requireInteraction?: boolean;
  urgency?: 'normal' | 'high';
}

export interface PushDeps {
  store: PushStore;
  /** The assistant's name, for "Conch needs your OK". */
  persona: () => Promise<string>;
  conversation: (
    id: string,
  ) => Promise<{ title: string; routine?: boolean; channel?: boolean; task?: boolean } | undefined>;
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

  constructor(private readonly deps: PushDeps) {}

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
      ...(message.actions && { actions: message.actions }),
      ...(message.deny && { deny: message.deny }),
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

  /** Conch's live stream, turned into the notifications that matter. */
  async onEvent(event: ServerEvent): Promise<void> {
    if (event.type === 'task.changed') {
      // A task you sent away finished (ADR 0033); a helper's result goes back to its chat instead.
      const task = event.task;
      if (task.kind !== 'background' || !['done', 'unverified', 'failed'].includes(task.status))
        return;
      if (this.#told.has(`${task.id}:${task.finishedAt}`)) return;
      this.#told.add(`${task.id}:${task.finishedAt}`);
      await this.notify('tasks', {
        title:
          task.status === 'done'
            ? `Verified complete: ${clip(task.title, 60)}`
            : task.status === 'unverified'
              ? `Result needs checking: ${clip(task.title, 60)}`
              : `Didn’t finish: ${clip(task.title, 60)}`,
        body: clip(
          task.status === 'done'
            ? (task.summary ?? 'It’s ready.')
            : (task.error ?? 'Something went wrong.'),
        ),
        quiet: task.status === 'done' ? 'Your task is done.' : 'Your task didn’t finish.',
        url: task.parentConversationId ? `/c/${task.parentConversationId}` : `/tasks`,
        tag: `task-${task.id}`,
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
    if (e.type === 'permission.requested') {
      const name = await this.deps.persona();
      const chat = await this.deps.conversation(e.conversationId);
      await this.notify('approvals', {
        title: `${name} needs your OK`,
        body: clip(chat?.title ? `${e.summary} · ${chat.title}` : e.summary),
        quiet: 'Open Conch to see what it’s asking.',
        url,
        tag: `ok-${e.permissionId}`,
        actions: [
          { action: 'open', title: 'Review' },
          { action: 'deny', title: 'Deny' },
        ],
        deny: { conversationId: e.conversationId, permissionId: e.permissionId },
        requireInteraction: true,
        urgency: 'high',
      });
      return;
    }
    if (e.type === 'vault.request' && e.request.state === 'waiting') {
      const name = await this.deps.persona();
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
      const name = await this.deps.persona();
      await this.notify('approvals', {
        title: `${name} needs you in the browser`,
        body: clip(e.handoff.reason),
        quiet: 'Open Conch to take over.',
        url,
        tag: `hand-${e.handoff.handoffId}`,
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
      const name = await this.deps.persona();
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
        body: `${request.device}, code ${request.code}. Approve it in Settings → Security, or ignore it.`,
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
