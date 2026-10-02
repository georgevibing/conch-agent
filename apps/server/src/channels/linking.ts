import type {
  Channel,
  ChannelBot,
  ChannelLink,
  ChannelSecrets,
  LinkableKind,
  ServerEvent,
} from '@conch/protocol';

import { newId } from '../lib/ids';
import { type ChannelLinker, LinkError } from './linked';

/** Ended links are remembered this long, so a page that looks again still sees how it ended. */
const KEEP_MS = 10 * 60_000;
/** Links at once, across every app: one per app is plenty. */
const MAX_LIVE = 4;

interface Live {
  link: ChannelLink;
  abort: AbortController;
  endedAt?: number;
}

export class LinkingError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Linking WhatsApp or Signal by QR code (ADR 0043): one session per press of
 * "Show the code", streamed to the page as `channel.link` events. The code
 * itself is never logged or kept: it lives in memory while it waits.
 *
 * When the phone has scanned, the channel is made (or, when linking a
 * channel again, its keys replaced) by `finish`, which the channel service
 * owns: the owner is the linked account itself.
 */
export class ChannelLinking {
  #live = new Map<string, Live>();

  constructor(
    private readonly deps: {
      linker: (kind: LinkableKind) => ChannelLinker | undefined;
      finish: (
        kind: LinkableKind,
        found: { secrets: ChannelSecrets; bot: ChannelBot },
        channelId?: string,
      ) => Promise<Channel>;
      emit: (event: ServerEvent) => void;
      log?: (message: string) => void;
      now?: () => number;
    },
  ) {}

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  /** Show a code. Any other link for the same app stops: there's one code on screen at a time. */
  start(kind: LinkableKind, channelId?: string): ChannelLink {
    const linker = this.deps.linker(kind);
    if (!linker) throw new LinkingError('unavailable', 'That app can’t be linked here.');
    this.#tidy();
    for (const live of this.#live.values())
      if (live.link.kind === kind && !live.endedAt) {
        live.abort.abort();
        this.#end(live, { state: 'failed', message: 'Replaced by a new code.' });
      }
    if ([...this.#live.values()].filter((l) => !l.endedAt).length >= MAX_LIVE)
      throw new LinkingError('unavailable', 'Too many codes are showing. Close one and try again.');
    const live: Live = {
      link: { id: newId('lk'), kind, state: 'starting', ...(channelId && { channelId }) },
      abort: new AbortController(),
    };
    this.#live.set(live.link.id, live);
    this.#emit(live);
    void this.#run(live, linker);
    return live.link;
  }

  get(id: string): ChannelLink {
    const live = this.#live.get(id);
    if (!live) throw new LinkingError('not-found', 'That code isn’t showing any more.');
    return live.link;
  }

  cancel(id: string) {
    const live = this.#live.get(id);
    if (!live) return;
    live.abort.abort();
    if (!live.endedAt) this.#end(live, { state: 'failed', message: 'Stopped.' });
  }

  stop() {
    for (const live of this.#live.values()) live.abort.abort();
    this.#live.clear();
  }

  async #run(live: Live, linker: ChannelLinker) {
    try {
      const found = await linker.link(
        {
          code: (qr, refreshAt) => {
            if (live.endedAt) return;
            live.link = {
              ...live.link,
              state: 'showing',
              qr,
              refreshAt,
              expiresAt: live.link.expiresAt ?? this.#now + 5 * 60_000,
            };
            this.#emit(live);
          },
          scanned: () => {
            if (live.endedAt) return;
            const { qr: _, refreshAt: __, ...rest } = live.link;
            live.link = { ...rest, state: 'finishing' };
            this.#emit(live);
          },
        },
        live.abort.signal,
      );
      if (live.abort.signal.aborted) return;
      const channel = await this.deps.finish(live.link.kind, found, live.link.channelId);
      this.#end(live, {
        state: 'linked',
        channelId: channel.id,
        ...(channel.bot.phone && { phone: channel.bot.phone }),
      });
    } catch (error) {
      if (live.endedAt) return;
      if (error instanceof LinkError)
        this.#end(
          live,
          error.code === 'install'
            ? {
                state: 'needs-install',
                message: error.message,
                ...(error.need && { need: error.need }),
              }
            : error.code === 'expired'
              ? { state: 'expired', message: error.message }
              : { state: 'failed', message: error.message },
        );
      else {
        this.deps.log?.(`link: ${error instanceof Error ? error.message : String(error)}`);
        this.#end(live, {
          state: 'failed',
          message:
            error instanceof Error && error.message
              ? error.message
              : 'Linking didn’t work. Try again.',
        });
      }
    }
  }

  #end(live: Live, patch: Partial<ChannelLink>) {
    live.endedAt = this.#now;
    const { qr: _, refreshAt: __, expiresAt: ___, ...rest } = live.link;
    live.link = { ...rest, ...patch };
    this.#emit(live);
  }

  #emit(live: Live) {
    this.deps.emit({ type: 'channel.link', link: live.link });
  }

  #tidy() {
    for (const [id, live] of this.#live)
      if (live.endedAt && this.#now - live.endedAt > KEEP_MS) this.#live.delete(id);
  }
}
