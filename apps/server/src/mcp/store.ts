/**
 * The apps you paired with Conch (ADR 0073), in `~/.conch/mcp/`:
 *
 * - `clients.json`: each app, what it may use, and a hash of its key. Never
 *   the key itself.
 * - `keys/<id>.key`: the key, 0600, for Conch's launcher to read when that
 *   app starts it. Only your account can read it, and the assistant's own
 *   file tools can't (`lib/protect.ts`).
 *
 * Nothing here is backed up (`derived`): a restore on another computer has
 * nothing paired, so another computer's apps never come along with it.
 */
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { McpClient, type McpClientApp, type McpScope } from '@conch/protocol';
import { z } from 'zod';

import { hashToken, safeEqual } from '../auth/secrets';
import { Mutex, readJson, safeJoin, writeFileAtomic, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';

/** How a key starts, so it's recognised (and found by secret scanners) for what it is. */
export const KEY_PREFIX = 'cmcp';

const Stored = McpClient.extend({ keyHash: z.string() });
type Stored = z.infer<typeof Stored>;

const File = z.object({
  version: z.literal(1).default(1),
  /** Paired apps marked `remote` may come in through your own address. */
  remote: z.boolean().default(false),
  clients: z.array(Stored).default([]),
});
type File = z.infer<typeof File>;

export class McpError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

/** `cmcp.<id>.<secret>`: the id says whose it is, the secret proves it. */
function keyOf(id: string): string {
  return `${KEY_PREFIX}.${id}.${randomBytes(32).toString('base64url')}`;
}

/** The client a key names, without trusting it yet. */
export function keyClient(key: string): string | undefined {
  const [prefix, id, secret, extra] = key.split('.');
  return prefix === KEY_PREFIX && id && secret && extra === undefined ? id : undefined;
}

const public_ = ({ keyHash: _keyHash, ...client }: Stored): McpClient => client;

export class McpClientStore {
  readonly #mutex = new Mutex();
  #cache?: File;

  constructor(readonly home: string) {}

  get dir(): string {
    return join(this.home, 'mcp');
  }

  get #file(): string {
    return join(this.dir, 'clients.json');
  }

  keyFile(id: string): string {
    return safeJoin(join(this.dir, 'keys'), `${id}.key`);
  }

  async #load(): Promise<File> {
    if (this.#cache) return this.#cache;
    const raw = await readJson<unknown>(this.#file).catch(() => undefined);
    const parsed = File.safeParse(raw ?? {});
    // A file that isn't ours to read pairs nothing: safer than guessing.
    this.#cache = parsed.success ? parsed.data : File.parse({});
    return this.#cache;
  }

  async #save(file: File): Promise<void> {
    await writeJson(this.#file, file);
    this.#cache = file;
  }

  /** Forget what was read, so a change from elsewhere (a restore) is seen. */
  invalidate(): void {
    this.#cache = undefined;
  }

  async list(): Promise<McpClient[]> {
    return (await this.#load()).clients.map(public_);
  }

  async get(id: string): Promise<McpClient | undefined> {
    const found = (await this.#load()).clients.find((c) => c.id === id);
    return found && public_(found);
  }

  async remote(): Promise<boolean> {
    return (await this.#load()).remote;
  }

  setRemote(on: boolean): Promise<void> {
    return this.#mutex.run(async () => {
      await this.#save({ ...(await this.#load()), remote: on });
    });
  }

  /** Pair an app: its record, and its key, written for the launcher and returned once. */
  create(input: {
    name: string;
    app: McpClientApp;
    scopes: readonly McpScope[];
    http?: boolean;
    remote?: boolean;
  }): Promise<{ client: McpClient; key: string }> {
    return this.#mutex.run(async () => {
      const file = await this.#load();
      const id = newId('mcpc');
      const key = keyOf(id);
      const client: Stored = {
        id,
        name: input.name.slice(0, 60),
        app: input.app,
        scopes: [...new Set(input.scopes)],
        createdAt: Date.now(),
        http: Boolean(input.http),
        remote: Boolean(input.remote),
        keyHash: hashToken(key),
      };
      await writeFileAtomic(this.keyFile(id), key, 0o600);
      await this.#save({ ...file, clients: [...file.clients, client] });
      return { client: public_(client), key };
    });
  }

  update(
    id: string,
    patch: Partial<Pick<McpClient, 'name' | 'scopes' | 'remote' | 'conversationId'>>,
  ): Promise<McpClient> {
    return this.#mutex.run(async () => {
      const file = await this.#load();
      const current = file.clients.find((c) => c.id === id);
      if (!current) throw new McpError('not-found', 'That app isn’t paired with Conch any more.');
      const next: Stored = {
        ...current,
        ...(patch.name !== undefined && { name: patch.name.slice(0, 60) }),
        ...(patch.scopes !== undefined && { scopes: [...new Set(patch.scopes)] }),
        ...(patch.remote !== undefined && { remote: patch.remote }),
        ...(patch.conversationId !== undefined && { conversationId: patch.conversationId }),
      };
      await this.#save({ ...file, clients: file.clients.map((c) => (c.id === id ? next : c)) });
      return public_(next);
    });
  }

  /** It was used just now (kept to once a minute, so a busy app doesn't rewrite the file). */
  touch(id: string, now = Date.now()): Promise<void> {
    return this.#mutex.run(async () => {
      const file = await this.#load();
      const current = file.clients.find((c) => c.id === id);
      if (!current || (current.lastUsedAt && now - current.lastUsedAt < 60_000)) return;
      await this.#save({
        ...file,
        clients: file.clients.map((c) => (c.id === id ? { ...c, lastUsedAt: now } : c)),
      });
    });
  }

  /** Unpair: its record and its key go, so nothing it holds works again. */
  remove(id: string): Promise<McpClient | undefined> {
    return this.#mutex.run(async () => {
      const file = await this.#load();
      const current = file.clients.find((c) => c.id === id);
      if (!current) return undefined;
      await this.#save({ ...file, clients: file.clients.filter((c) => c.id !== id) });
      await rm(this.keyFile(id), { force: true });
      return public_(current);
    });
  }

  /** The paired app this key belongs to, compared in constant time; undefined for anything else. */
  async byKey(key: string): Promise<McpClient | undefined> {
    const id = keyClient(key);
    if (!id) return undefined;
    const found = (await this.#load()).clients.find((c) => c.id === id);
    if (!found) return undefined;
    return safeEqual(hashToken(key), found.keyHash) ? public_(found) : undefined;
  }

  /** The key Conch's launcher reads, for the proof it sends (never sent itself). */
  async key(id: string): Promise<string | undefined> {
    try {
      return (await readFile(this.keyFile(id), 'utf8')).trim();
    } catch {
      return undefined;
    }
  }
}
