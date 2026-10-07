import { join } from 'node:path';

import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

/** Who the linked account is, as WhatsApp said when it linked. */
export const WaIdentity = z.object({
  /** `4915123456789:12@s.whatsapp.net`: the number, and this device. */
  jid: z.string().max(200),
  /** The account's private id (`…@lid`), which newer chats use instead of the number. */
  lid: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
});
export type WaIdentity = z.infer<typeof WaIdentity>;

const Session = z.object({
  me: WaIdentity,
  /** When it was linked: nothing written before then is ever answered. */
  since: z.number(),
  /** The device's keys, as the WhatsApp library writes them (opaque here). */
  state: z.string().max(64 * 1024 * 1024),
});
export type WaSession = z.infer<typeof Session>;

const SessionsFile = z.record(z.string(), Session);

/** One session's keys, as a connection reads and writes them. */
export interface WaSessionHandle {
  read(): Promise<string | undefined>;
  /** Kept in memory at once; on disk shortly after (keys change with every message). */
  write(state: string): void;
  /** On disk now (before closing). */
  flush(): Promise<void>;
}

/** Writes this close together go to disk as one. */
const SETTLE_MS = 1_500;

/**
 * `~/.conch/whatsapp.secrets.json`: the keys of each linked WhatsApp, sealed
 * under this computer's device key like the bots' keys (`lib/sealed.ts`).
 * Whoever has them can read and send your WhatsApp messages, so they're
 * never shown, logged or sent anywhere, and only travel in a
 * passphrase-locked backup.
 *
 * WhatsApp changes a device's keys with nearly every message, so writes are
 * gathered for a moment and go as one (`flush` forces it).
 */
export class WhatsAppSessions {
  #mutex = new Mutex();
  #all?: Promise<Record<string, WaSession>>;
  #dirty = new Set<string>();
  #timer?: NodeJS.Timeout;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get #path() {
    return join(this.home, 'whatsapp.secrets.json');
  }

  get(id: string): Promise<WaSession | undefined> {
    return this.#mutex.run(async () => (await this.#load())[id]);
  }

  /** A new link's keys, kept for good. */
  put(id: string, session: WaSession): Promise<void> {
    return this.#mutex.run(async () => {
      const all = await this.#load();
      all[id] = Session.parse(session);
      await this.#write(all);
    });
  }

  remove(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      const all = await this.#load();
      if (!(id in all)) return;
      Reflect.deleteProperty(all, id);
      this.#dirty.delete(id);
      await this.#write(all);
    });
  }

  handle(id: string): WaSessionHandle {
    return {
      read: async () => (await this.get(id))?.state,
      write: (state) => {
        void this.#mutex.run(async () => {
          const all = await this.#load();
          const current = all[id];
          if (!current) return;
          all[id] = { ...current, state };
          this.#dirty.add(id);
          this.#schedule();
        });
      },
      flush: () => this.flush(),
    };
  }

  /** Everything changed so far, on disk now. */
  flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    return this.#mutex.run(async () => {
      if (!this.#dirty.size) return;
      await this.#write(await this.#load());
    });
  }

  #schedule() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush().catch(() => undefined);
    }, SETTLE_MS);
    this.#timer.unref?.();
  }

  async #write(all: Record<string, WaSession>) {
    this.#dirty.clear();
    await writeJson(this.#path, all);
  }

  #load(): Promise<Record<string, WaSession>> {
    this.#all ??= readStore(this.#path, SessionsFile, {
      onRepair: () =>
        this.heal?.(
          'channels',
          'Set aside a damaged WhatsApp link. Link WhatsApp again to carry on.',
        ),
    }).then(
      (read) => read.value,
      (error: unknown) => {
        this.#all = undefined;
        throw error;
      },
    );
    return this.#all;
  }
}

/** A session that lives only in memory: a link that isn't finished yet. */
export function memorySession(): WaSessionHandle & { current(): string | undefined } {
  let state: string | undefined;
  return {
    read: () => Promise.resolve(state),
    write: (next) => {
      state = next;
    },
    flush: () => Promise.resolve(),
    current: () => state,
  };
}
