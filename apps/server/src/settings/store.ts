import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Persona, Preferences, Profile, type UpdateSettingsBody } from '@conch/protocol';
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

  update(patch: UpdateSettingsBody): Promise<Settings> {
    return this.#mutex.run(async () => {
      const current = await this.get();
      const next = SettingsFile.parse({
        ...current,
        ...(patch.onboarded !== undefined && { onboarded: patch.onboarded }),
        persona: { ...current.persona, ...patch.persona },
        profile: { ...current.profile, ...patch.profile },
        preferences: { ...current.preferences, ...patch.preferences },
      });
      await writeJson(this.#path, next);
      this.#cache = Promise.resolve(next);
      return next;
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
