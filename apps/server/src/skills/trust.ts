/**
 * Whose skills you trust, and your own signing key (ADR 0031).
 *
 * - `skills.trust.json`: the publishers you said you trust, by their key's
 *   fingerprint. Kept in backups, and named in a restore's preview: a backup
 *   can't quietly bring trust back (`backup/powers.ts`).
 * - `skills.signing.json`: your own Ed25519 key, for `pnpm conch skills
 *   sign`, trusted from the moment it's made. Only you can read it (0600);
 *   it isn't sealed under the device key, because the terminal command that
 *   uses it runs without the gateway. A backup keeps it with the secrets.
 *
 * Both are protected paths (`lib/protect.ts`): the assistant's file and
 * shell tools can't read or change them, sealed or not.
 */
import { join } from 'node:path';

import type { TrustedPublisher } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore } from '../lib/recover';
import { fingerprintOf, newSigner, publicKeyFrom, type Signer } from './signing';

const TrustFile = z.object({
  publishers: z
    .array(
      z.object({
        fingerprint: z.string(),
        key: z.string(),
        name: z.string().max(80),
        trustedAt: z.number(),
        you: z.boolean().optional(),
      }),
    )
    .default([]),
});

const SignerFile = z.object({
  name: z.string().min(1).max(80),
  publicKey: z.string(),
  privateKey: z.string(),
});

export const TRUST_FILE = 'skills.trust.json';
export const SIGNER_FILE = 'skills.signing.json';

export class SkillTrust {
  readonly #mutex = new Mutex();
  #version = 0;

  constructor(private readonly home: string) {}

  /** Changes whenever the list does: what's verified is worked out again. */
  get version() {
    return this.#version;
  }

  async #read() {
    return (await readStore(join(this.home, TRUST_FILE), TrustFile)).value;
  }

  async list(): Promise<TrustedPublisher[]> {
    return (await this.#read()).publishers.map(({ fingerprint, name, trustedAt, you }) => ({
      fingerprint,
      name,
      trustedAt,
      ...(you && { you }),
    }));
  }

  async fingerprints(): Promise<Set<string>> {
    return new Set((await this.#read()).publishers.map((p) => p.fingerprint));
  }

  /** Trust a key. Its fingerprint is worked out here, never taken on faith. */
  trust(entry: { key: string; name: string; you?: boolean }): Promise<TrustedPublisher> {
    return this.#mutex.run(async () => {
      if (!publicKeyFrom(entry.key)) throw new Error('That isn’t a key Conch accepts.');
      const file = await this.#read();
      const fingerprint = fingerprintOf(entry.key);
      const kept = file.publishers.filter((p) => p.fingerprint !== fingerprint);
      const added = {
        fingerprint,
        key: entry.key,
        name: entry.name.slice(0, 80),
        trustedAt: Date.now(),
        ...(entry.you && { you: true }),
      };
      await writeJson(join(this.home, TRUST_FILE), { publishers: [...kept, added] });
      this.#version++;
      return {
        fingerprint,
        name: added.name,
        trustedAt: added.trustedAt,
        ...(entry.you && { you: true }),
      };
    });
  }

  forget(fingerprint: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const file = await this.#read();
      const kept = file.publishers.filter((p) => p.fingerprint !== fingerprint);
      if (kept.length === file.publishers.length) return false;
      await writeJson(join(this.home, TRUST_FILE), { publishers: kept });
      this.#version++;
      return true;
    });
  }

  /** Your own signing key, made (and trusted) the first time it's needed. */
  async signer(name: string): Promise<Signer> {
    const path = join(this.home, SIGNER_FILE);
    const existing = (await readStore(path, SignerFile.partial())).value;
    if (existing.name && existing.publicKey && existing.privateKey)
      return {
        name: existing.name,
        publicKey: existing.publicKey,
        privateKey: existing.privateKey,
      };
    const made = newSigner(name);
    await writeJson(path, made);
    await this.trust({ key: made.publicKey, name: made.name, you: true });
    return made;
  }
}
