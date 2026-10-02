import { join } from 'node:path';
import { GoogleAccount, GoogleConfigure } from '@conch/protocol';
import { z } from 'zod';
import { Mutex, writeJson } from '../lib/fs';
import { readStore } from '../lib/recover';

const Credential = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number(),
  scopes: z.array(z.string()),
  generation: z.string(),
});
export type Credential = z.infer<typeof Credential>;
const Data = z.object({
  config: GoogleConfigure.optional(),
  accounts: z
    .record(z.string(), z.object({ profile: GoogleAccount, credential: Credential }))
    .default({}),
});
export type GoogleData = z.infer<typeof Data>;
/** All state is in one sealed atomic file: account identity cannot separate from its credential. */
export class GoogleStore {
  #mutex = new Mutex();
  constructor(private readonly home: string) {}
  async read(): Promise<GoogleData> {
    return (await readStore(join(this.home, 'google.secrets.json'), Data)).value;
  }
  update(fn: (data: GoogleData) => void | Promise<void>): Promise<void> {
    return this.#mutex.run(async () => {
      const data = await this.read();
      await fn(data);
      await writeJson(join(this.home, 'google.secrets.json'), Data.parse(data));
    });
  }
}
