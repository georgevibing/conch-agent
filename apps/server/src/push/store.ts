/**
 * Where notifications go (ADR 0027): this Conch's own VAPID key, and each
 * device's push subscription. Both are keys — a subscription's `auth` and
 * `p256dh` let anyone holding them push to that device — so the file is one
 * of the sealed key files (`lib/sealed.ts`), encrypted under this computer's
 * device key.
 *
 * Not backed up (`derived`): a subscription belongs to this Conch's key and
 * that browser. After a restore, Conch makes a new key, and each device that
 * had notifications on subscribes again by itself the next time it opens Conch.
 */
import { join } from 'node:path';

import { PushPrefs, PushSubscriptionJson } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { readStore, type Heal } from '../lib/recover';
import { generateVapidKeys, vapidKeysValid, type VapidKeys } from './webpush';

/** At most this many devices get notifications. */
const MAX_SUBSCRIPTIONS = 50;

/** Who a subscription belongs to: a signed-in device, or this computer itself. */
export const PushOwner = z.string().min(1).max(128);

const Subscription = z.object({
  id: z.string(),
  owner: PushOwner,
  /** "iPhone · Safari": the device's own name when it was turned on. */
  name: z.string().max(120),
  subscription: PushSubscriptionJson,
  prefs: PushPrefs.default(PushPrefs.parse({})),
  createdAt: z.number(),
  lastSentAt: z.number().optional(),
  problem: z.string().max(300).optional(),
});
export type Subscription = z.infer<typeof Subscription>;

const PushFile = z.object({
  vapid: z.object({ publicKey: z.string(), privateKey: z.string() }).optional(),
  subscriptions: z.array(Subscription).default([]),
});
type PushFile = z.infer<typeof PushFile>;

export const PUSH_FILE = 'push.secrets.json';

export class PushStore {
  readonly #path: string;
  readonly #mutex = new Mutex();
  #file?: Promise<PushFile>;

  constructor(
    home: string,
    private readonly heal?: Heal,
  ) {
    this.#path = join(home, PUSH_FILE);
  }

  #read(): Promise<PushFile> {
    this.#file ??= readStore(this.#path, PushFile, {
      onRepair: () =>
        this.heal?.(
          'settings',
          'The notifications file was damaged, so Conch started it again. Turn notifications on again on your devices.',
        ),
    }).then((read) => read.value);
    return this.#file;
  }

  #change<T>(fn: (file: PushFile) => T): Promise<T> {
    return this.#mutex.run(async () => {
      const file = structuredClone(await this.#read());
      const result = fn(file);
      await writeJson(this.#path, file);
      this.#file = Promise.resolve(file);
      return result;
    });
  }

  /** This Conch's key, made the first time it's needed (or again when it's damaged). */
  async vapid(): Promise<VapidKeys> {
    const file = await this.#read();
    if (file.vapid && vapidKeysValid(file.vapid)) return file.vapid;
    return this.#change((f) => {
      if (f.vapid && vapidKeysValid(f.vapid)) return f.vapid;
      // A new key: every subscription made with the old one is useless now.
      f.vapid = generateVapidKeys();
      f.subscriptions = [];
      return f.vapid;
    });
  }

  async list(): Promise<Subscription[]> {
    return (await this.#read()).subscriptions;
  }

  /** Add one, or update it (same endpoint: the same browser). */
  add(
    entry: Omit<Subscription, 'id' | 'createdAt' | 'prefs'> & { prefs?: Partial<PushPrefs> },
  ): Promise<Subscription> {
    return this.#change((file) => {
      const existing = file.subscriptions.find(
        (s) => s.subscription.endpoint === entry.subscription.endpoint,
      );
      const prefs = PushPrefs.parse({ ...existing?.prefs, ...entry.prefs });
      if (existing) {
        Object.assign(existing, { ...entry, prefs, problem: undefined });
        return existing;
      }
      const added: Subscription = {
        ...entry,
        prefs,
        id: newId('ps'),
        createdAt: Date.now(),
      };
      file.subscriptions.push(added);
      // The oldest go first: a device that never comes back shouldn't keep a slot.
      if (file.subscriptions.length > MAX_SUBSCRIPTIONS)
        file.subscriptions.splice(0, file.subscriptions.length - MAX_SUBSCRIPTIONS);
      return added;
    });
  }

  /** The push service gave this browser a new address. Only its owner can move it. */
  renew(owner: string, oldEndpoint: string | undefined, next: Subscription['subscription']) {
    return this.#change((file) => {
      const found = file.subscriptions.find(
        (s) => s.owner === owner && (!oldEndpoint || s.subscription.endpoint === oldEndpoint),
      );
      if (!found) return false;
      found.subscription = next;
      found.problem = undefined;
      return true;
    });
  }

  update(id: string, patch: Partial<Pick<Subscription, 'prefs' | 'lastSentAt' | 'problem'>>) {
    return this.#change((file) => {
      const found = file.subscriptions.find((s) => s.id === id);
      if (found) Object.assign(found, patch);
      return found;
    });
  }

  remove(predicate: (s: Subscription) => boolean): Promise<number> {
    return this.#change((file) => {
      const before = file.subscriptions.length;
      file.subscriptions = file.subscriptions.filter((s) => !predicate(s));
      return before - file.subscriptions.length;
    });
  }
}
