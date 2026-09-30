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
    await writeJson(this.#path, { version: 1, integrations: [...items.values()] });
  }

  #load(): Promise<Map<string, StoredIntegration>> {
    this.#items ??= readStore(this.#path, IntegrationsFile, {
      onRepair: (state) =>
        this.heal?.(
          'integrations',
          state === 'salvaged'
            ? 'An integration’s settings couldn’t be read, so Conch kept a copy and carried on with the rest.'
            : 'Your list of integrations couldn’t be read, so Conch kept a copy and started a new one.',
        ),
    }).then(
      (read) => new Map(read.value.integrations.map((item) => [item.id, item])),
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
            ? 'One integration’s sign-in couldn’t be read, so Conch kept a copy and carried on with the rest.'
            : 'Your integrations’ sign-ins couldn’t be read, so Conch kept a copy and started a new file.',
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
