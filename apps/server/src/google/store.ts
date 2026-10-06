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
/** Gmail signed in with an app password (ADR 0048): only IMAP, never SMTP. */
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
export const GOOGLE_STORE_VERSION = 2;

/**
 * A file from before per-account access: every account keeps exactly what it
 * could do (Gmail that saved drafts is Gmail's write level now), and sending
 * mail, which didn't exist then, starts off in Gmail's tools, so nothing can
 * newly reach out until a person turns it on.
 */
export function migrateGoogle(data: GoogleData): GoogleData {
  if ((data.version ?? 1) >= GOOGLE_STORE_VERSION) return data;
  const profiles = [
    ...Object.entries(data.accounts).map(([id, a]) => [id, a.profile] as const),
    ...Object.entries(data.passwords).map(([id, p]) => [id, p.profile] as const),
  ];
  for (const [id, profile] of profiles)
    if (!Object.hasOwn(data.limits, id)) data.limits[id] = accessOf(profile.capabilities);
  if (profiles.some(([, p]) => p.capabilities.some((c) => c.startsWith('mail-')))) {
    const gmail = AppSettings.parse(data.apps.gmail ?? {});
    gmail.tools.google_mail_send ??= 'off';
    data.apps.gmail = gmail;
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
