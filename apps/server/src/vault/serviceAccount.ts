/**
 * `~/.conch/onepassword.secrets.json`: a 1Password service account's token,
 * and which of its vaults Passwords shows (AGENTS.md § Secrets in a new
 * feature). Sealed like every key Conch uses (`lib/sealed.ts`), carried only
 * by a passphrase-locked backup, out of the agent's reach (`lib/protect.ts`).
 * The token goes to `op` in its own environment and nowhere else: never back
 * to the browser, never in a log, never on a command line.
 */
import { join } from 'node:path';

import { SERVICE_ACCOUNT_TOKEN } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore } from '../lib/recover';

const Data = z.object({
  token: z.string().regex(SERVICE_ACCOUNT_TOKEN).optional(),
  /** The vaults shown, by id. Absent: every vault the token can read. */
  vaults: z.array(z.string().regex(/^[a-z0-9]{1,64}$/)).optional(),
  savedAt: z.number().optional(),
});
export type ServiceAccountData = z.infer<typeof Data>;

export const SERVICE_ACCOUNT_FILE = 'onepassword.secrets.json';

export class ServiceAccountStore {
  #mutex = new Mutex();
  #cache?: Promise<ServiceAccountData>;

  constructor(
    private readonly home: string,
    private readonly heal?: (area: string, message: string) => void,
  ) {}

  get path(): string {
    return join(this.home, SERVICE_ACCOUNT_FILE);
  }

  read(): Promise<ServiceAccountData> {
    this.#cache ??= readStore(this.path, Data, {
      onRepair: () =>
        this.heal?.(
          'passwords',
          'Set aside a damaged 1Password service account token. Add it again in Passwords.',
        ),
    }).then(
      (read) => read.value,
      (error: unknown) => {
        this.#cache = undefined;
        throw error;
      },
    );
    return this.#cache;
  }

  update(fn: (data: ServiceAccountData) => ServiceAccountData): Promise<ServiceAccountData> {
    return this.#mutex.run(async () => {
      const next = Data.parse(fn(structuredClone(await this.read())));
      await writeJson(this.path, next);
      this.#cache = Promise.resolve(next);
      return next;
    });
  }
}
