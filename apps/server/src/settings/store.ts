import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Persona,
  Preferences,
  Profile,
  ServerConfig as Server,
  type ServerConfig,
  type UpdateSettingsBody,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import { StoredSecret } from '../secrets/vault';

const SettingsFile = z.object({
  version: z.literal(1).default(1),
  onboarded: z.boolean().default(false),
  persona: Persona.default(Persona.parse({})),
  profile: Profile.default(Profile.parse({})),
  preferences: Preferences.default(Preferences.parse({})),
  /**
   * Providers that have worked on this computer and haven't been removed
   * since, by engine id. Health watches these; one you never set up isn't a problem.
   */
  connected: z.array(z.string()).default([]),
  /**
   * For a provider with several addresses (a region), the one that took your
   * key, by provider id — so the next check starts there (ADR 0053).
   */
  endpoints: z.record(z.string(), z.string().max(40)).default({}),
  /** Servers you added yourself (Settings → Providers → Another server). Their keys are secrets. */
  servers: z.array(Server).max(32).default([]),
});
export type Settings = z.infer<typeof SettingsFile>;

const SecretsFile = z.object({
  /**
   * Claude Code's API key, from before every provider had its own. Read as a
   * fallback and cleared the next time a key is saved.
   */
  anthropicApiKey: z.string().optional(),
  /** A key per provider, by engine id. Either the value or a 1Password reference. */
  providers: z.record(z.string(), StoredSecret).default({}),
});
export type Secrets = z.infer<typeof SecretsFile>;

/**
 * `~/.conch/settings.json` — personality, profile and preferences (safe to
 * read and edit by hand). Secrets live separately in `secrets.json`, mode 0600,
 * and are never sent to the browser.
 *
 * A file that won't read is kept as `<name>.broken-<time>.json` and whatever
 * is still valid carries on (`readStore`). Going back to a default is safe for
 * both: every preference's default is the careful one (ask before acting), and
 * a lost key only means asking for it again, never more access.
 */
export class SettingsStore {
  #mutex = new Mutex();
  #cache?: Promise<Settings>;
  readonly workspaceDefault: string;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {
    this.workspaceDefault = join(home, 'workspace');
  }

  get #path() {
    return join(this.home, 'settings.json');
  }

  get #secretsPath() {
    return join(this.home, 'secrets.json');
  }

  get(): Promise<Settings> {
    this.#cache ??= readStore(this.#path, SettingsFile, {
      onRepair: (state) =>
        this.heal?.(
          'settings',
          state === 'salvaged'
            ? 'Part of your settings file couldn’t be read, so Conch kept a copy and reset just that part.'
            : 'Your settings file couldn’t be read, so Conch kept a copy and went back to the defaults.',
        ),
    }).then(
      (read) => read.value,
      (error: unknown) => {
        // Unreadable for a moment (a virus scan on Windows): try again next time.
        this.#cache = undefined;
        throw error;
      },
    );
    return this.#cache;
  }

  /** Your photo is set or taken away only through its own route (`profile/avatar.ts`). */
  setAvatar(avatar: Settings['profile']['avatar']): Promise<Settings> {
    return this.#mutex.run(async () => {
      const current = await this.get();
      const { avatar: _old, ...profile } = current.profile;
      const next = SettingsFile.parse({
        ...current,
        profile: { ...profile, ...(avatar && { avatar }) },
      });
      await writeJson(this.#path, next);
      this.#cache = Promise.resolve(next);
      return next;
    });
  }

  update(patch: UpdateSettingsBody): Promise<Settings> {
    return this.#mutex.run(async () => {
      const current = await this.get();
      const next = SettingsFile.parse({
        ...current,
        ...(patch.onboarded !== undefined && { onboarded: patch.onboarded }),
        persona: { ...current.persona, ...patch.persona },
        profile: { ...current.profile, ...patch.profile },
        preferences: withoutNulls({ ...current.preferences, ...patch.preferences }),
      });
      await writeJson(this.#path, next);
      this.#cache = Promise.resolve(next);
      return next;
    });
  }

  /** Remember that a provider worked here, or forget it once it's removed. */
  setConnected(id: string, connected: boolean): Promise<void> {
    return this.#mutex.run(async () => {
      const current = await this.get();
      if (current.connected.includes(id) === connected) return;
      const next = SettingsFile.parse({
        ...current,
        connected: connected
          ? [...current.connected, id]
          : current.connected.filter((c) => c !== id),
      });
      await writeJson(this.#path, next);
      this.#cache = Promise.resolve(next);
    });
  }

  /** Remember which of a provider's addresses took its key. */
  setEndpoint(id: string, endpoint: string): Promise<void> {
    return this.#mutex.run(async () => {
      const current = await this.get();
      if (current.endpoints[id] === endpoint) return;
      const next = SettingsFile.parse({
        ...current,
        endpoints: { ...current.endpoints, [id]: endpoint },
      });
      await writeJson(this.#path, next);
      this.#cache = Promise.resolve(next);
    });
  }

  /** Add or change a server you run yourself; `undefined` takes it away. */
  setServer(id: string, server: ServerConfig | undefined): Promise<ServerConfig[]> {
    return this.#mutex.run(async () => {
      const current = await this.get();
      const others = current.servers.filter((s) => s.id !== id);
      const next = SettingsFile.parse({
        ...current,
        servers: server ? [...others, server] : others,
        connected: server ? current.connected : current.connected.filter((c) => c !== id),
      });
      await writeJson(this.#path, next);
      this.#cache = Promise.resolve(next);
      return next.servers;
    });
  }

  /** The folder the agent works in; created on first use. */
  async workspace(): Promise<string> {
    const { preferences } = await this.get();
    const dir = preferences.workspace?.trim() || this.workspaceDefault;
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async secrets(): Promise<Secrets> {
    const read = await readStore(this.#secretsPath, SecretsFile, {
      onRepair: (state) =>
        this.heal?.(
          'secrets',
          state === 'salvaged'
            ? 'One of your saved provider keys couldn’t be read, so Conch kept a copy and carried on with the rest.'
            : 'Your saved provider keys couldn’t be read, so Conch kept a copy and started a new list.',
        ),
    });
    return read.value;
  }

  setSecrets(patch: Partial<Secrets>): Promise<void> {
    return this.#mutex.run(async () => {
      const next = { ...(await this.secrets()), ...patch };
      await writeJson(this.#secretsPath, next);
    });
  }

  /**
   * The key saved for one provider. Claude Code falls back to the older
   * top-level `anthropicApiKey`, so an existing install keeps working.
   */
  async providerSecret(id: string): Promise<StoredSecret | undefined> {
    const secrets = await this.secrets();
    const stored = secrets.providers[id];
    if (stored) return stored;
    if (id === 'claude-code' && secrets.anthropicApiKey)
      return { source: 'conch', value: secrets.anthropicApiKey, savedAt: 0 };
    return undefined;
  }

  /** Save or clear one provider's key. Saving also retires the legacy field. */
  setProviderSecret(id: string, secret: StoredSecret | undefined): Promise<void> {
    return this.#mutex.run(async () => {
      const { anthropicApiKey, providers } = await this.secrets();
      const rest = Object.fromEntries(Object.entries(providers).filter(([key]) => key !== id));
      const next: Secrets = {
        providers: secret ? { ...rest, [id]: secret } : rest,
        // Saving a key here retires the one an older Conch wrote.
        ...(id !== 'claude-code' && anthropicApiKey !== undefined && { anthropicApiKey }),
      };
      await writeJson(this.#secretsPath, next);
    });
  }
}

/** A `null` in a patch clears the setting (e.g. `limitFallback: null`: wait for the limit again). */
function withoutNulls<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null)) as {
    [K in keyof T]: Exclude<T[K], null>;
  };
}
