import { join } from 'node:path';
import {
  accessOf,
  GoogleAccount,
  GoogleConfigure,
  GoogleLevel,
  GoogleProduct,
  ToolPolicy,
  IntegrationPolicy,
} from '@conch/protocol';
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
/** Gmail signed in with an app password (ADR 0048): IMAP to read and save drafts, SMTP to send. */
const PasswordLogin = z.object({
  profile: GoogleAccount,
  address: z.email(),
  password: z.string().min(1).max(64),
  generation: z.string(),
});
export type PasswordLogin = z.infer<typeof PasswordLogin>;
/** How a person set up Gmail, Calendar or Drive as an app: on or off, and what may run unasked. */
const AppSettings = z.object({
  enabled: z.boolean().default(true),
  policy: IntegrationPolicy.default('ask-writes'),
  tools: z.record(z.string(), ToolPolicy).default({}),
  /** Disconnected from Apps: not shown, and its tools aren't offered, until connected again. */
  hidden: z.boolean().default(false),
  createdAt: z.number().optional(),
  lastUsedAt: z.number().optional(),
});
export type AppSettings = z.infer<typeof AppSettings>;
const Data = z.object({
  config: GoogleConfigure.optional(),
  accounts: z
    .record(z.string(), z.object({ profile: GoogleAccount, credential: Credential }))
    .default({}),
  passwords: z.record(z.string(), PasswordLogin).default({}),
  apps: z.record(z.string(), AppSettings).default({}),
  /**
   * What the person lets Conch do with each account, per product: off, read
   * or write. Held under what the sign-in allows; a product left out is off.
   */
  limits: z.record(z.string(), z.partialRecord(GoogleProduct, GoogleLevel)).default({}),
  /** Absent in files from before limits (one level per account). */
  version: z.number().int().optional(),
});
export type GoogleData = z.infer<typeof Data>;
export type GoogleLimits = GoogleData['limits'][string];

/** The store's shape now. Older files are brought up to it as they're read. */
export const GOOGLE_STORE_VERSION = 3;

/**
 * A file from before per-account access: every account keeps exactly what it
 * could do (Gmail that saved drafts is Gmail's write level now).
 *
 * Version 2 also turned "Send an email" off in Gmail's tools, by itself, for
 * every older setup (ADR 0099). Nobody chose that, the page showed it as the
 * person's own choice, and an account set to Read & write then couldn't send
 * (ADR 0104). Version 3 takes that one setting back out, so sending follows
 * the account's level and asks first like every new setup. A choice made on
 * the page since is the person's and stays.
 */
export function migrateGoogle(data: GoogleData): GoogleData {
  const version = data.version ?? 1;
  if (version >= GOOGLE_STORE_VERSION) return data;
  if (version < 2) {
    const profiles = [
      ...Object.entries(data.accounts).map(([id, a]) => [id, a.profile] as const),
      ...Object.entries(data.passwords).map(([id, p]) => [id, p.profile] as const),
    ];
    for (const [id, profile] of profiles)
      if (!Object.hasOwn(data.limits, id)) data.limits[id] = accessOf(profile.capabilities);
  } else if (data.apps.gmail?.tools.google_mail_send === 'off') {
    // Version 2's own "off", never shown as anything but the person's: back to asking first.
    delete data.apps.gmail.tools.google_mail_send;
  }
  data.version = GOOGLE_STORE_VERSION;
  return data;
}
/** All state is in one sealed atomic file: account identity cannot separate from its credential. */
export class GoogleStore {
  #mutex = new Mutex();
  #listeners = new Set<() => void>();
  constructor(private readonly home: string) {}
  /** Told after every saved change (an account, a password, an app's switch). */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  async read(): Promise<GoogleData> {
    return migrateGoogle((await readStore(join(this.home, 'google.secrets.json'), Data)).value);
  }
  update(fn: (data: GoogleData) => void | Promise<void>): Promise<void> {
    return this.#mutex.run(async () => {
      const data = await this.read();
      await fn(data);
      await writeJson(join(this.home, 'google.secrets.json'), Data.parse(data));
      for (const listener of this.#listeners) listener();
    });
  }
}
