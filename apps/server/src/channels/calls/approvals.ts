/**
 * Conch rings you about an OK that waited (ADR 0138).
 *
 * When a question has waited the minutes you chose and nobody answered it
 * anywhere, Conch calls your phone from the SMS number. What the call may do
 * is exactly what a lock-screen tap may (`push/approve.ts`, ADR 0108), asked
 * through the notification service so both always agree: a routine step can
 * be allowed with 1 or "yes"; anything else only says that something needs
 * you in Conch. Off unless you turned it on, never in your quiet hours, and
 * never more than the day's calls you allowed (`ChannelService.callOwner`).
 */
import { inQuietHours, type ChannelCalls, type ServerEvent } from '@conch/protocol';

import { minutesIn } from '../../checkins/service';
import type { CallAsk } from './phone';

export interface ApprovalCallDeps {
  /** The numbers that may ring, with what each owner chose. */
  lines(): Promise<{ channelId: string; settings: ChannelCalls }[]>;
  call(channelId: string, ask: CallAsk): Promise<'placed' | 'limit' | 'busy' | 'unavailable'>;
  /** Still waiting, and may a lock-screen tap allow it (the notification service's own rules). */
  approval(conversationId: string, permissionId: string): { waiting: boolean; quick: boolean };
  respond(conversationId: string, permissionId: string, decision: 'allow' | 'deny'): Promise<void>;
  /** The person's time zone, for quiet hours. */
  timezone(): Promise<string | undefined>;
  now?: () => number;
  log?: (message: string) => void;
}

interface Waiting {
  conversationId: string;
  summary: string;
  timer: NodeJS.Timeout;
}

export class ApprovalCalls {
  readonly #waiting = new Map<string, Waiting>();

  constructor(private readonly deps: ApprovalCallDeps) {}

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  async onEvent(event: ServerEvent): Promise<void> {
    if (event.type !== 'conversation.event') return;
    const e = event.event;
    if (e.type === 'permission.resolved') {
      this.#forget(e.permissionId);
      return;
    }
    if (e.type !== 'permission.requested' || this.#waiting.has(e.permissionId)) return;
    const lines = await this.deps.lines();
    if (!lines.length) return;
    const after = Math.min(...lines.map((l) => l.settings.after)) * 60_000;
    const timer = setTimeout(() => void this.ring(e.permissionId).catch(() => undefined), after);
    timer.unref?.();
    this.#waiting.set(e.permissionId, {
      conversationId: e.conversationId,
      // What it would do in a few words, as the notification says it: never the command.
      summary: e.title ?? e.summary,
      timer,
    });
  }

  #forget(permissionId: string) {
    const waiting = this.#waiting.get(permissionId);
    if (waiting) clearTimeout(waiting.timer);
    this.#waiting.delete(permissionId);
  }

  /**
   * The question waited long enough: ring, if it's still waiting and a
   * number may (the timer calls this; so do tests, rather than wait).
   */
  async ring(permissionId: string): Promise<void> {
    const waiting = this.#waiting.get(permissionId);
    this.#waiting.delete(permissionId);
    if (!waiting) return;
    const { conversationId } = waiting;
    if (!this.deps.approval(conversationId, permissionId).waiting) return;
    const zone = await this.deps.timezone().catch(() => undefined);
    const minutes = (() => {
      try {
        return minutesIn(this.#now, zone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      } catch {
        return minutesIn(this.#now, 'UTC');
      }
    })();
    const ask: CallAsk = {
      conversationId,
      permissionId,
      summary: waiting.summary,
      still: () => this.deps.approval(conversationId, permissionId),
      respond: (decision) => this.deps.respond(conversationId, permissionId, decision),
    };
    for (const line of await this.deps.lines()) {
      if (inQuietHours(minutes, line.settings.quiet)) continue;
      const result = await this.deps.call(line.channelId, ask).catch((error: unknown) => {
        this.deps.log?.(`call: couldn’t ring (${(error as Error).message})`);
        return 'unavailable' as const;
      });
      if (result === 'placed') return;
    }
  }

  stop(): void {
    for (const waiting of this.#waiting.values()) clearTimeout(waiting.timer);
    this.#waiting.clear();
  }
}
