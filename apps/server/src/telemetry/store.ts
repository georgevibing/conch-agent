/**
 * Settings → Dashboards, kept (ADR 0121): `~/.conch/telemetry.json` for the
 * choices (backed up, protected from the assistant's own file tools), and
 * the sealed `~/.conch/telemetry.secrets.json` for what opens a door — the
 * destination's key, the scrape token's hash, and the key that makes chats'
 * ids unrecognisable in traces (`secret` in backups: only in a locked one).
 *
 * The `conch dashboards` command writes the same files; the gateway notices
 * within seconds (`changed`), so the terminal and the page never disagree.
 */
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { TelemetrySettings, type DashboardDestinationId } from '@conch/protocol';
import { z } from 'zod';

import { hashToken, randomToken, safeEqual } from '../auth/secrets';
import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

const SettingsFile = z.object({
  version: z.literal(1).default(1),
  settings: TelemetrySettings.default(TelemetrySettings.parse({})),
  /** `service.instance.id`: this Conch, told apart from your others. Random, never the computer's name. */
  instance: z.string().max(64).optional(),
});
type SettingsFile = z.infer<typeof SettingsFile>;

const SecretsFile = z.object({
  /** The destination these fields were pasted for: another destination's are never sent. */
  destination: z.string().max(40).optional(),
  fields: z.record(z.string().max(40), z.string().max(8000)).default({}),
  /** SHA-256 of the scrape token: it is shown once, never kept. */
  scrape: z.string().max(100).optional(),
  /** Keys a chat's id in traces. */
  salt: z.string().max(100).optional(),
});
type SecretsFile = z.infer<typeof SecretsFile>;

/** What a scrape token looks like: Conch's mark, then 256 random bits. */
export const SCRAPE_PREFIX = 'conch_scrape_';

export class TelemetryStore {
  readonly #mutex = new Mutex();
  #cache?: { file: SettingsFile; secrets: SecretsFile; stamp: string };

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get path(): string {
    return join(this.home, 'telemetry.json');
  }

  get secretsPath(): string {
    return join(this.home, 'telemetry.secrets.json');
  }

  async #stamp(): Promise<string> {
    const read = async (path: string) => {
      try {
        const s = await stat(path);
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return '-';
      }
    };
    return `${await read(this.path)}|${await read(this.secretsPath)}`;
  }

  async #load(): Promise<{ file: SettingsFile; secrets: SecretsFile }> {
    const stamp = await this.#stamp();
    if (this.#cache?.stamp === stamp) return this.#cache;
    const [file, secrets] = await Promise.all([
      readStore(this.path, SettingsFile, {
        onRepair: () =>
          this.heal?.('settings', 'Reset damaged dashboard settings. A copy is kept.'),
      }),
      readStore(this.secretsPath, SecretsFile, {
        onRepair: () =>
          this.heal?.(
            'secrets',
            'Set aside a damaged dashboard key. A copy is kept; paste it again.',
          ),
      }),
    ]);
    this.#cache = { file: file.value, secrets: secrets.value, stamp };
    return this.#cache;
  }

  /** Whether the files changed since they were last read (the terminal changed them). */
  async changed(): Promise<boolean> {
    return (await this.#stamp()) !== this.#cache?.stamp;
  }

  async settings(): Promise<TelemetrySettings> {
    return (await this.#load()).file.settings;
  }

  /** The saved fields, only when they were pasted for this destination. */
  async fields(destination: DashboardDestinationId): Promise<Record<string, string>> {
    const { secrets } = await this.#load();
    return secrets.destination === destination ? secrets.fields : {};
  }

  /** This Conch's instance id, made the first time it's asked for. */
  async instance(): Promise<string> {
    const { file } = await this.#load();
    if (file.instance) return file.instance;
    return this.#mutex.run(async () => {
      const now = (await this.#load()).file;
      if (now.instance) return now.instance;
      const instance = randomBytes(16).toString('hex');
      await this.#write({ ...now, instance });
      return instance;
    });
  }

  /** The key that keys chats' ids in traces, made the first time. */
  async salt(): Promise<Buffer> {
    const { secrets } = await this.#load();
    if (secrets.salt) return Buffer.from(secrets.salt, 'base64url');
    return this.#mutex.run(async () => {
      const now = (await this.#load()).secrets;
      if (now.salt) return Buffer.from(now.salt, 'base64url');
      const salt = randomToken(32);
      await this.#writeSecrets({ ...now, salt });
      return Buffer.from(salt, 'base64url');
    });
  }

  async #write(file: SettingsFile) {
    await writeJson(this.path, SettingsFile.parse(file));
    this.#cache = undefined;
  }

  async #writeSecrets(secrets: SecretsFile) {
    await writeJson(this.secretsPath, SecretsFile.parse(secrets));
    this.#cache = undefined;
  }

  setSettings(next: TelemetrySettings): Promise<TelemetrySettings> {
    return this.#mutex.run(async () => {
      const { file } = await this.#load();
      const settings = TelemetrySettings.parse(next);
      await this.#write({ ...file, settings });
      return settings;
    });
  }

  /** Keep the fields pasted for a destination; `null` forgets them. */
  setFields(
    destination: DashboardDestinationId,
    fields: Record<string, string> | null,
  ): Promise<void> {
    return this.#mutex.run(async () => {
      const { secrets } = await this.#load();
      const { destination: _d, fields: _f, ...rest } = secrets;
      await this.#writeSecrets(
        fields === null ? { ...rest, fields: {} } : { ...rest, destination, fields },
      );
    });
  }

  /** A new scrape token: returned once, only its hash kept. The old one stops working. */
  newScrapeToken(): Promise<string> {
    return this.#mutex.run(async () => {
      const { secrets } = await this.#load();
      const token = `${SCRAPE_PREFIX}${randomToken(32)}`;
      await this.#writeSecrets({ ...secrets, scrape: hashToken(token) });
      return token;
    });
  }

  async hasScrapeToken(): Promise<boolean> {
    return Boolean((await this.#load()).secrets.scrape);
  }

  /** Whether a token is the scrape token, compared in constant time. */
  async checkScrapeToken(token: string): Promise<boolean> {
    const saved = (await this.#load()).secrets.scrape;
    if (!saved || !token.startsWith(SCRAPE_PREFIX) || token.length > 200) return false;
    return safeEqual(hashToken(token), saved);
  }
}
