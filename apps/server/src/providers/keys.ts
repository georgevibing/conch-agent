/**
 * The one place a provider's key is written, read and described.
 *
 * Engines never touch the secrets file: they ask for their key and get a
 * string, whether it sits in `~/.conch/secrets.json` or in 1Password. Every
 * path that could involve a person (a fingerprint) is explicit, so the harmless
 * ones — drawing Settings, checking whether a provider is connected — stay
 * silent.
 */
import type { EngineId, SavedSecret } from '@conch/protocol';

import { SecretVault, storedFrom, type StoredSecret } from '../secrets/vault';
import type { SettingsStore } from '../settings/store';

export class ProviderKeys {
  constructor(
    private readonly settings: SettingsStore,
    readonly vault: SecretVault = new SecretVault(),
  ) {}

  stored(id: EngineId): Promise<StoredSecret | undefined> {
    return this.settings.providerSecret(id);
  }

  /** Whether a key is saved at all. Never reads its value. */
  async has(id: EngineId): Promise<boolean> {
    return Boolean(await this.stored(id));
  }

  /**
   * The key, ready to send. Throws `SecretError` when 1Password holds it and
   * can't be reached. `peek` returns a 1Password-held key only if it's already
   * in memory — for callers that must not prompt anybody.
   */
  async value(
    id: EngineId,
    options: { peek?: boolean; signal?: AbortSignal } = {},
  ): Promise<string | undefined> {
    const stored = await this.stored(id);
    if (!stored) return undefined;
    if (stored.source === 'conch') return stored.value;
    if (options.peek) return this.vault.onePassword.peek(stored.reference);
    return this.vault.resolve(stored, { signal: options.signal });
  }

  /** Save a key, or a `op://…` reference to one. */
  async save(id: EngineId, value: string): Promise<StoredSecret> {
    const stored = storedFrom(value);
    await this.settings.setProviderSecret(id, stored);
    if (stored.source === '1password') this.vault.onePassword.forget(stored.reference);
    return stored;
  }

  async clear(id: EngineId): Promise<void> {
    const stored = await this.stored(id);
    if (stored?.source === '1password') this.vault.onePassword.forget(stored.reference);
    await this.settings.setProviderSecret(id, undefined);
  }

  /** The public view: that a key exists, where it lives, and its last four characters. */
  async describe(id: EngineId): Promise<SavedSecret | undefined> {
    const stored = await this.stored(id);
    return stored ? this.vault.describe(stored) : undefined;
  }
}
