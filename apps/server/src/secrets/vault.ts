/**
 * One way to hold a secret, two places to keep it.
 *
 * A stored secret is either a value Conch keeps in `~/.conch/secrets.json`
 * (mode 0600, like every other file there) or a 1Password reference Conch
 * resolves when it needs the value. Callers ask the vault and get a string;
 * they never care which it was.
 *
 * Rules that hold everywhere:
 * - The browser is told *that* a secret exists, where it lives and its last
 *   four characters. Never the value.
 * - Reading a secret can involve a person (a fingerprint), so it happens when a
 *   turn needs it — never to draw a page.
 */
import type { SavedSecret } from '@conch/protocol';
import { z } from 'zod';

import { OnePassword, OnePasswordError } from './onepassword';

/** How a secret is kept. `source` doubles as the discriminator on disk. */
export const StoredSecret = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('conch'),
    value: z.string().min(1).max(4096),
    savedAt: z.number().default(0),
  }),
  z.object({
    source: z.literal('1password'),
    /** `op://Vault/Item/field` — checked again before it reaches `op`. */
    reference: z.string().min(1).max(512),
    savedAt: z.number().default(0),
  }),
]);
export type StoredSecret = z.infer<typeof StoredSecret>;

/** Raised when a secret exists but can't be read. The message is for a person. */
export class SecretError extends Error {}

/** `op://…` means "it's in 1Password"; anything else is the secret itself. */
export function isSecretReference(value: string): boolean {
  return value.trim().toLowerCase().startsWith('op://');
}

/** What the user typed, turned into something we can store. */
export function storedFrom(value: string, now = Date.now()): StoredSecret {
  const trimmed = value.trim();
  return isSecretReference(trimmed)
    ? { source: '1password', reference: trimmed, savedAt: now }
    : { source: 'conch', value: trimmed, savedAt: now };
}

export class SecretVault {
  constructor(readonly onePassword: OnePassword = new OnePassword()) {}

  /** The value, ready to use. Throws `SecretError` with a sentence for the user. */
  async resolve(secret: StoredSecret, options: { signal?: AbortSignal } = {}): Promise<string> {
    if (secret.source === 'conch') return secret.value;
    try {
      return await this.onePassword.read(secret.reference, { signal: options.signal });
    } catch (error) {
      if (error instanceof OnePasswordError) throw new SecretError(error.message);
      throw new SecretError(`1Password couldn’t be reached: ${(error as Error).message}`);
    }
  }

  /**
   * The public view of a saved secret. Deliberately cheap: it never reads the
   * value, so opening Settings can't set off an unlock prompt.
   */
  async describe(secret: StoredSecret): Promise<SavedSecret> {
    if (secret.source === 'conch') {
      const tail = secret.value.slice(-4);
      return { source: 'conch', hint: tail ? `…${tail}` : 'saved', savedAt: secret.savedAt };
    }
    const state = await this.onePassword.state();
    return {
      source: '1password',
      hint: secret.reference,
      savedAt: secret.savedAt,
      problem: state.available ? undefined : state.message,
    };
  }

  /** Every literal secret value we hold, for scrubbing them out of error text. */
  static values(secrets: (StoredSecret | undefined)[]): string[] {
    return secrets
      .filter((s): s is Extract<StoredSecret, { source: 'conch' }> => s?.source === 'conch')
      .map((s) => s.value)
      .filter((v) => v.length >= 8);
  }
}
