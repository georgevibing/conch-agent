import { join } from 'node:path';

import { Integration, IntegrationTool } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

export const StoredTool = IntegrationTool.extend({
  /** Fingerprint of the tool's definition, so a changed tool loses "always allow". */
  hash: z.string(),
});
export type StoredTool = z.infer<typeof StoredTool>;

export const StoredIntegration = Integration.extend({ tools: z.array(StoredTool).default([]) });
export type StoredIntegration = z.infer<typeof StoredIntegration>;

const IntegrationsFile = z.object({
  version: z.literal(1).default(1),
  /** An entry that no longer reads (hand-edited, older) is dropped on its own; the rest carry on. */
  integrations: z.array(StoredIntegration).default([]),
  /**
   * What you disconnected, so a provider that still has it set up doesn't
   * bring it back by itself (ADR 0049): `catalog:<id>`, or `url:<sha-256 of
   * the address>` (never the address itself).
   */
  removed: z.array(z.string().max(80)).max(500).default([]),
});

/** OAuth state for one integration. Shapes come from the MCP SDK and are opaque here. */
export const OAuthSecrets = z.object({
  /** The redirect URI the client was registered with (changes if you use another address). */
  redirectUrl: z.string().optional(),
  client: z.record(z.string(), z.unknown()).optional(),
  tokens: z.record(z.string(), z.unknown()).optional(),
  /** Epoch ms the access token expires, when the server said. */
  expiresAt: z.number().optional(),
  discovery: z.record(z.string(), z.unknown()).optional(),
});
export type OAuthSecrets = z.infer<typeof OAuthSecrets>;

export const IntegrationSecrets = z.object({
  values: z.record(z.string(), z.string()).default({}),
  oauth: OAuthSecrets.optional(),
});
export type IntegrationSecrets = z.infer<typeof IntegrationSecrets>;

const SecretsFile = z.record(z.string(), IntegrationSecrets);

/**
 * `~/.conch/integrations.json` — what's connected and how (safe to read);
 * `~/.conch/integrations.secrets.json` (0600) — tokens and keys, never sent
 * to the browser, never logged.
 *
 * A damaged file is kept as `<name>.broken-<time>.json` and every entry that
 * still reads carries on (`readStore`). Dropping one is safe: an integration
 * that's gone can't act, and a lost token only means signing in again.
 */
export class IntegrationStore {
  #mutex = new Mutex();
  #items?: Promise<Map<string, StoredIntegration>>;
  #removed = new Set<string>();
  #secrets?: Promise<Record<string, IntegrationSecrets>>;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get #path() {
    return join(this.home, 'integrations.json');
  }

  get #secretsPath() {
    return join(this.home, 'integrations.secrets.json');
  }

  async all(): Promise<StoredIntegration[]> {
    return [...(await this.#load()).values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(id: string): Promise<StoredIntegration | undefined> {
    return (await this.#load()).get(id);
  }

  /** Read-modify-write one integration; `fn` returning undefined deletes nothing and saves nothing. */
  update(
    id: string,
    fn: (current: StoredIntegration) => StoredIntegration | undefined,
  ): Promise<StoredIntegration | undefined> {
    return this.#mutex.run(async () => {
      const items = await this.#load();
      const current = items.get(id);
      if (!current) return undefined;
      const next = fn(current);
      if (!next) return current;
      const parsed = StoredIntegration.parse(next);
      items.set(id, parsed);
      await this.#write(items);
      return parsed;
    });
  }

  add(item: StoredIntegration, secrets: IntegrationSecrets): Promise<StoredIntegration> {
    return this.#mutex.run(async () => {
      const items = await this.#load();
      const parsed = StoredIntegration.parse(item);
      // Secrets first: an integration that exists must be able to find its token.
      const all = await this.#loadSecrets();
      all[parsed.id] = IntegrationSecrets.parse(secrets);
      await writeJson(this.#secretsPath, all);
      items.set(parsed.id, parsed);
      await this.#write(items);
      return parsed;
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

  /** What you disconnected, so it isn't brought back by itself. */
  async removed(): Promise<ReadonlySet<string>> {
    await this.#load();
    return new Set(this.#removed);
  }

  /** Remember (or forget) that these were disconnected on purpose. */
  setRemoved(keys: readonly string[], removed: boolean): Promise<void> {
    return this.#mutex.run(async () => {
      const items = await this.#load();
      const before = this.#removed.size;
      for (const key of keys) {
        if (removed) this.#removed.add(key);
        else this.#removed.delete(key);
      }
      // Oldest go first: the list stays small.
      while (this.#removed.size > 500) {
        const first = this.#removed.values().next().value;
        if (first === undefined) break;
        this.#removed.delete(first);
      }
      if (this.#removed.size !== before || removed) await this.#write(items);
    });
  }

  /** Names of enabled integrations set to "Don't ask" (for the security checkup). */
  async trusted(): Promise<string[]> {
    return (await this.all()).filter((i) => i.enabled && i.policy === 'trust').map((i) => i.name);
  }

  async secrets(id: string): Promise<IntegrationSecrets> {
    return (await this.#loadSecrets())[id] ?? IntegrationSecrets.parse({});
  }

  updateSecrets(
    id: string,
    fn: (current: IntegrationSecrets) => IntegrationSecrets,
  ): Promise<IntegrationSecrets> {
    return this.#mutex.run(async () => {
      const all = await this.#loadSecrets();
      const next = IntegrationSecrets.parse(fn(all[id] ?? IntegrationSecrets.parse({})));
      all[id] = next;
      await writeJson(this.#secretsPath, all);
      return next;
    });
  }

  async #write(items: Map<string, StoredIntegration>) {
    await writeJson(this.#path, {
      version: 1,
      integrations: [...items.values()],
      removed: [...this.#removed],
    });
  }

  #load(): Promise<Map<string, StoredIntegration>> {
    this.#items ??= readStore(this.#path, IntegrationsFile, {
      onRepair: (state) =>
        this.heal?.(
          'integrations',
          state === 'salvaged'
            ? 'Set aside an app’s damaged settings. A copy is kept.'
            : 'Started a new list of apps. A copy of the old one is kept.',
        ),
    }).then(
      (read) => {
        this.#removed = new Set(read.value.removed);
        return new Map(read.value.integrations.map((item) => [item.id, item]));
      },
      (error: unknown) => {
        this.#items = undefined;
        throw error;
      },
    );
    return this.#items;
  }

  #loadSecrets(): Promise<Record<string, IntegrationSecrets>> {
    this.#secrets ??= readStore(this.#secretsPath, SecretsFile, {
      onRepair: (state) =>
        this.heal?.(
          'integrations',
          state === 'salvaged'
            ? 'Set aside an app’s damaged sign-in. A copy is kept.'
            : 'Set aside your apps’ damaged sign-ins. A copy is kept.',
        ),
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
