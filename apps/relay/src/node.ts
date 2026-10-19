/**
 * The relay as a small Node program (ADR 0140): for a Raspberry Pi, a VPS,
 * Fly.io or anything with Docker. Node 22.18 or later runs this file as it is
 * (it strips the types itself), with nothing to install: no dependencies.
 *
 *   CONCH_RELAY_SETUP=conch-relay-1.… node src/node.ts
 *
 * - `CONCH_RELAY_SETUP`: the setup code from Conch (Settings → Always-on relay),
 *   or `setup.txt` in the data folder.
 * - `CONCH_RELAY_DATA`: where the queue is kept (default `./relay-data`).
 * - `PORT`: where it listens (default 8787), on `HOST` (default `0.0.0.0`).
 *
 * Put it behind HTTPS (Fly and Render do it for you; Caddy or Tailscale Funnel
 * on a box of your own): Conch only talks to a relay over HTTPS.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { Relay, DEFAULT_LIMITS } from './core.ts';
import { parseSetupCode } from './envelope.ts';
import type { RelayStore, StoredItem } from './store.ts';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Headers about this hop, which `Request` sets itself. */
const HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

/** One file per delivery, written whole and renamed into place, so a crash leaves no half. */
export class FileStore implements RelayStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  #items() {
    return join(this.dir, 'items');
  }

  async #write(path: string, text: string) {
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, path);
  }

  async load() {
    await mkdir(this.#items(), { recursive: true, mode: 0o700 });
    const items: StoredItem[] = [];
    for (const name of await readdir(this.#items())) {
      if (!name.endsWith('.json')) {
        await rm(join(this.#items(), name), { force: true });
        continue;
      }
      try {
        items.push(JSON.parse(await readFile(join(this.#items(), name), 'utf8')) as StoredItem);
      } catch {
        // Damaged: it can't be opened anyway.
        await rm(join(this.#items(), name), { force: true });
      }
    }
    let tags: string[] = [];
    try {
      tags = JSON.parse(await readFile(join(this.dir, 'hooks.json'), 'utf8')) as string[];
    } catch {
      tags = [];
    }
    return { items, tags: Array.isArray(tags) ? tags : [] };
  }

  put(item: StoredItem) {
    if (!ID.test(item.id)) return Promise.reject(new Error('Bad id.'));
    return this.#write(join(this.#items(), `${item.id}.json`), JSON.stringify(item));
  }

  async remove(ids: string[]) {
    for (const id of ids)
      if (ID.test(id)) await rm(join(this.#items(), `${id}.json`), { force: true });
  }

  setTags(tags: string[]) {
    return this.#write(join(this.dir, 'hooks.json'), JSON.stringify(tags));
  }
}

/** Node's request as a fetch `Request`, the body read up to `limit` (and refused past it). */
async function toRequest(req: IncomingMessage, limit: number): Promise<Request | 'too-big'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return 'too-big';
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (HOP.has(name)) continue;
    else if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  const method = req.method ?? 'GET';
  return new Request(`http://relay${req.url ?? '/'}`, {
    method,
    headers,
    ...(method !== 'GET' && method !== 'HEAD' && { body: Buffer.concat(chunks) }),
  });
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function serve(relay: Relay) {
  return createServer((req, res) => {
    void (async () => {
      try {
        const request = await toRequest(req, relay.limits.bodyLimit + 64 * 1024);
        if (request === 'too-big') {
          res.statusCode = 413;
          res.setHeader('connection', 'close');
          res.end('Too big.', () => req.destroy());
          return;
        }
        await send(res, await relay.fetch(request));
      } catch (error) {
        console.error(`[relay] ${(error as Error).message}`);
        if (!res.headersSent) res.statusCode = 500;
        res.end('Something went wrong.');
      }
    })();
  });
}

async function setupFrom(dir: string): Promise<string> {
  const fromEnv = process.env.CONCH_RELAY_SETUP?.trim();
  if (fromEnv) return fromEnv;
  try {
    return (await readFile(join(dir, 'setup.txt'), 'utf8')).trim();
  } catch {
    throw new Error(
      'Set CONCH_RELAY_SETUP to the setup code from Conch (Settings → Always-on relay).',
    );
  }
}

export async function main() {
  const dir = process.env.CONCH_RELAY_DATA ?? join(process.cwd(), 'relay-data');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const setup = parseSetupCode(await setupFrom(dir));
  const relay = new Relay(setup, new FileStore(dir), DEFAULT_LIMITS);
  await relay.load();
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = serve(relay);
  // Long polls wait up to 25 s: keep the connection open a little longer than that.
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  server.listen(port, host, () =>
    console.warn(`[relay] Conch relay on ${host}:${port}, ${relay.depth} waiting`),
  );
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error: unknown) => {
    console.error(`[relay] ${(error as Error).message}`);
    process.exit(1);
  });
