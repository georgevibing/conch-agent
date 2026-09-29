import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Persona, Preferences, Profile, type UpdateSettingsBody } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, readJson, writeJson } from '../lib/fs';

const SettingsFile = z.object({
  version: z.literal(1).default(1),
  onboarded: z.boolean().default(false),
  persona: Persona.default(Persona.parse({})),
  profile: Profile.default(Profile.parse({})),
  preferences: Preferences.default(Preferences.parse({})),
});
export type Settings = z.infer<typeof SettingsFile>;

const SecretsFile = z.object({
  anthropicApiKey: z.string().optional(),
});
export type Secrets = z.infer<typeof SecretsFile>;

/**
 * `~/.conch/settings.json` — personality, profile and preferences (safe to
 * read and edit by hand). Secrets live separately in `secrets.json`, mode 0600,
 * and are never sent to the browser.
 */
export class SettingsStore {
  #mutex = new Mutex();
  #cache?: Settings;
  readonly workspaceDefault: string;

  constructor(private readonly home: string) {
    this.workspaceDefault = join(home, 'workspace');
  }

  get #path() {
    return join(this.home, 'settings.json');
  }

  get #secretsPath() {
    return join(this.home, 'secrets.json');
  }

  async get(): Promise<Settings> {
    this.#cache ??= SettingsFile.parse((await readJson(this.#path)) ?? {});
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
      this.#cache = next;
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
    return SecretsFile.parse((await readJson(this.#secretsPath)) ?? {});
  }

  setSecrets(patch: Partial<Secrets>): Promise<void> {
    return this.#mutex.run(async () => {
      const next = { ...(await this.secrets()), ...patch };
      await writeJson(this.#secretsPath, next);
    });
  }
}
