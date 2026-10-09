import { join } from 'node:path';

import {
  AgentId,
  ChannelBot,
  ChannelGroup,
  ChannelKind,
  ChannelPerson,
  ChannelRequest,
  ChannelSecrets,
  ChannelSettings,
  Id,
  TurnOptions,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import { WaitingNote } from './voice-notes';

export const StoredChannel = z.object({
  id: Id,
  kind: ChannelKind,
  enabled: z.boolean().default(true),
  createdAt: z.number(),
  bot: ChannelBot,
  people: z.array(ChannelPerson).default([]),
  requests: z.array(ChannelRequest).default([]),
  /** People turned away for good: they get no answer and no new request. */
  blocked: z.array(Id).default([]),
  /**
   * Group chats the bot is in (ADR 0075), with the app's own id for each
   * (`chatId`), which may not be an `Id`. At most `MAX_GROUPS`.
   */
  groups: z.array(ChannelGroup.extend({ chatId: z.string().min(1).max(300) })).default([]),
  settings: ChannelSettings.default({ notifyRoutines: true }),
  /**
   * Each person's current conversation (`/new` starts another). In a group,
   * each person has their own, under `group:<group id>:<person id>`.
   */
  chats: z.record(z.string(), z.string()).default({}),
  /** Owner choices for private chats here, also used after /new. */
  chatOptions: TurnOptions.default({}),
  /** The agent that answers new chats here (ADR 0101); unset, the default agent. */
  agentId: AgentId.optional().catch(undefined),
  lastMessageAt: z.number().optional(),
  /** How far the connection has read (iMessage, email), so a restart carries on from there. */
  cursor: z.string().max(200).optional(),
  /** Voice notes waiting until Conch can hear them (ADR 0077), oldest first. */
  voiceWaiting: z.array(WaitingNote).default([]),
  /** A chat app a Conch app brings (ADR 0122): which app, and what the chat app is called. */
  contributed: z
    .object({ app: z.string().max(24), name: z.string().max(40) })
    .optional()
    .catch(undefined),
});
export type StoredChannel = z.infer<typeof StoredChannel>;

const ChannelsFile = z.object({
  version: z.literal(1).default(1),
  channels: z.array(StoredChannel).default([]),
});

const SecretsFile = z.record(z.string(), ChannelSecrets);

/**
 * `~/.conch/channels.json` — which bots are connected and who may talk to
 * them; `~/.conch/channels.secrets.json` (0600) — their keys, never sent to the
 * browser or logged.
 *
 * A damaged file is kept aside and what still reads carries on. Losing a
 * channel is safe (nobody can reach Conch through it until it's added again);
 * losing a key only means pasting it again.
 */
export class ChannelStore {
  #mutex = new Mutex();
  #items?: Promise<Map<string, StoredChannel>>;
  #secrets?: Promise<Record<string, ChannelSecrets>>;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get #path() {
    return join(this.home, 'channels.json');
  }

  get #secretsPath() {
    return join(this.home, 'channels.secrets.json');
  }

  // Reads wait for writes already under way: what they return is what's on disk,
  // so a restart right after a change (someone just paired) never loses it.
  all(): Promise<StoredChannel[]> {
    return this.#mutex.run(async () =>
      [...(await this.#load()).values()].sort((a, b) => a.createdAt - b.createdAt),
    );
  }

  get(id: string): Promise<StoredChannel | undefined> {
    return this.#mutex.run(async () => (await this.#load()).get(id));
  }

  add(item: z.input<typeof StoredChannel>, secrets: ChannelSecrets): Promise<StoredChannel> {
    return this.#mutex.run(async () => {
      const parsed = StoredChannel.parse(item);
      // Secrets first: a channel that exists must be able to find its key.
      const all = await this.#loadSecrets();
      all[parsed.id] = ChannelSecrets.parse(secrets);
      await writeJson(this.#secretsPath, all);
      const items = await this.#load();
      items.set(parsed.id, parsed);
      await this.#write(items);
      return parsed;
    });
  }

  /** Read-modify-write one channel. */
  update(
    id: string,
    fn: (current: StoredChannel) => StoredChannel,
  ): Promise<StoredChannel | undefined> {
    return this.#mutex.run(async () => {
      const items = await this.#load();
      const current = items.get(id);
      if (!current) return undefined;
      const next = StoredChannel.parse(fn(current));
      items.set(id, next);
      await this.#write(items);
      return next;
    });
  }

  remove(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      const items = await this.#load();
      items.delete(id);
      await this.#write(items);
      const rest = Object.fromEntries(
        Object.entries(await this.#loadSecrets()).filter(([key]) => key !== id),
      );
      this.#secrets = Promise.resolve(rest);
      await writeJson(this.#secretsPath, rest);
    });
  }

  secrets(id: string): Promise<ChannelSecrets | undefined> {
    return this.#mutex.run(async () => (await this.#loadSecrets())[id]);
  }

  setSecrets(id: string, secrets: ChannelSecrets): Promise<void> {
    return this.#mutex.run(async () => {
      const all = await this.#loadSecrets();
      all[id] = ChannelSecrets.parse(secrets);
      await writeJson(this.#secretsPath, all);
    });
  }

  async #write(items: Map<string, StoredChannel>) {
    await writeJson(this.#path, { version: 1, channels: [...items.values()] });
  }

  #load(): Promise<Map<string, StoredChannel>> {
    this.#items ??= readStore(this.#path, ChannelsFile, {
      onRepair: (state) =>
        this.heal?.(
          'channels',
          state === 'salvaged'
            ? 'Set aside a channel’s damaged settings. A copy is kept.'
            : 'Started a new list of channels. A copy is kept.',
        ),
    }).then(
      (read) => new Map(read.value.channels.map((item) => [item.id, item])),
      (error: unknown) => {
        this.#items = undefined;
        throw error;
      },
    );
    return this.#items;
  }

  #loadSecrets(): Promise<Record<string, ChannelSecrets>> {
    this.#secrets ??= readStore(this.#secretsPath, SecretsFile, {
      onRepair: () =>
        this.heal?.('channels', 'Set aside a channel’s damaged key. Paste it again to reconnect.'),
    }).then(
      (read) => read.value,
      (error: unknown) => {
        this.#secrets = undefined;
        throw error;
      },
    );
    return this.#secrets;
  }
}
