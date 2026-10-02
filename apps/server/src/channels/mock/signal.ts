import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { SignalProcess, SignalSpawn } from '../signal-cli';

export interface MockSignalSent {
  method: string;
  params: Record<string, unknown>;
}

interface Fake {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exit: (code: number | null) => void;
  alive: boolean;
}

/**
 * A pretend signal-cli for tests, E2E and `pnpm dev:mock` (ADR 0043). It
 * stands in for the process (`SignalSpawn`), so the real JSON-RPC client,
 * its framing and its restarts all run: `startLink`, `finishLink` (which
 * waits for `scan()`), `send`, typing, receipts and reactions, and `receive`
 * notifications for what the phone says. It writes the files the real one
 * keeps in its folder, so backups see the same shape.
 *
 * Tests drive the phone with `scan()` and `say()` (or `POST /__control/…`),
 * and break things on purpose: `crash()`, `unlink()`, `missing` (no
 * signal-cli on this computer) and `noJava`.
 */
export class MockSignal {
  static readonly OWNER = { number: '+15550003333', name: 'Ada Lovelace' };
  static readonly FRIEND = {
    number: '+15550004444',
    uuid: '6f2a9c1e-0b7d-4e55-9a41-2d3c5b7e8f90',
    name: 'Grace Hopper',
  };

  #server?: Server;
  #process?: Fake;
  #accounts = new Set<string>();
  #waiting?: { uri: string; resolve: (number: string) => void; reject: (error: Error) => void };
  #clock = Date.now();
  #dir = '';
  #links = 0;
  base = '';
  readonly sent: MockSignalSent[] = [];
  /** Every request's method, in order. */
  readonly calls: string[] = [];
  /** How many times signal-cli was started. */
  starts = 0;
  /** No signal-cli on this computer. */
  missing = false;
  /** signal-cli is here, but Java isn't. */
  noJava = false;
  /** How long `finishLink` waits for a scan before it gives up, as the real one does after two minutes. */
  linkTimeoutMs = 120_000;

  spawn: SignalSpawn = (configDir) => {
    this.#dir = configDir;
    if (this.missing)
      return Promise.resolve({
        need: 'signal-cli',
        message: 'Signal needs signal-cli, which isn’t on this computer yet.',
      });
    this.starts++;
    const fake: Fake = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exit: () => undefined,
      alive: true,
    };
    const listeners: ((code: number | null) => void)[] = [];
    fake.exit = (code) => {
      if (!fake.alive) return;
      fake.alive = false;
      if (this.#process === fake) this.#process = undefined;
      fake.stdout.end();
      for (const listener of listeners) listener(code);
    };
    if (this.noJava) {
      setTimeout(() => {
        fake.stderr.write(
          'The operation couldn’t be completed. Unable to locate a Java Runtime.\n',
        );
        setTimeout(() => fake.exit(1), 5);
      }, 5);
    } else {
      this.#process = fake;
      let buffer = '';
      fake.stdin.setEncoding('utf8');
      fake.stdin.on('data', (chunk: string) => {
        buffer += chunk;
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          void this.#request(fake, line);
        }
      });
    }
    const process: SignalProcess = {
      stdin: fake.stdin,
      stdout: fake.stdout,
      stderr: fake.stderr,
      kill: () => fake.exit(null),
      onExit: (listener) => listeners.push(listener),
    };
    return Promise.resolve(process);
  };

  async #request(fake: Fake, line: string) {
    let message: { id?: string; method?: string; params?: Record<string, unknown> };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    const params = message.params ?? {};
    const reply = (body: Record<string, unknown>) => {
      if (fake.alive)
        fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body })}\n`);
    };
    const ok = (result: unknown) => reply({ result });
    const fail = (code: number, text: string) =>
      reply({ error: { code, message: text, data: null } });
    const account = typeof params.account === 'string' ? params.account : undefined;
    this.calls.push(message.method ?? '');
    switch (message.method) {
      case 'listAccounts':
        return ok([...this.#accounts].map((number) => ({ number })));
      case 'startLink': {
        this.#waiting?.reject(new Error('replaced'));
        const uri = `sgnl://linkdevice?uuid=mock${++this.#links}&pub_key=BdmockPublicKey${this.#links}`;
        this.#waiting = { uri, resolve: () => undefined, reject: () => undefined };
        return ok({ deviceLinkUri: uri });
      }
      case 'finishLink': {
        const waiting = this.#waiting;
        if (!waiting || waiting.uri !== params.deviceLinkUri)
          return fail(-1, 'Invalid device link uri.');
        try {
          const number = await new Promise<string>((resolve, reject) => {
            waiting.resolve = resolve;
            waiting.reject = reject;
            setTimeout(() => reject(new Error('timeout')), this.linkTimeoutMs).unref?.();
          });
          this.#waiting = undefined;
          this.#accounts.add(number);
          await this.#writeFiles(number);
          return ok({ number });
        } catch {
          if (this.#waiting === waiting) this.#waiting = undefined;
          return fail(-1, 'Link request timed out, please try again.');
        }
      }
      case 'listContacts':
        return ok(
          account === MockSignal.OWNER.number
            ? [{ number: account, profile: { givenName: 'Ada', familyName: 'Lovelace' } }]
            : [],
        );
      case 'deleteLocalAccountData':
        if (account) this.#accounts.delete(account);
        return ok({});
      case 'send':
      case 'sendTyping':
      case 'sendReceipt':
      case 'sendReaction': {
        if (!account || !this.#accounts.has(account))
          return fail(-1, '[401] Authorization failed!');
        this.sent.push({ method: message.method, params });
        const timestamp = ++this.#clock;
        return ok(
          message.method === 'send' ? { timestamp, results: [{ type: 'SUCCESS' }] } : { timestamp },
        );
      }
      default:
        return fail(-32601, 'Method not implemented');
    }
  }

  /** What the real one keeps for an account, so backups see the same shape. */
  async #writeFiles(number: string) {
    if (!this.#dir) return;
    const data = join(this.#dir, 'data');
    await mkdir(join(data, `${number.slice(1)}.d`), { recursive: true, mode: 0o700 });
    await writeFile(
      join(data, 'accounts.json'),
      JSON.stringify({ accounts: [{ number, path: number.slice(1) }] }),
      { mode: 0o600 },
    );
    await writeFile(join(data, number.slice(1)), JSON.stringify({ number, mock: true }), {
      mode: 0o600,
    });
    await writeFile(join(data, `${number.slice(1)}.d`, 'account.db'), 'mock', { mode: 0o600 });
  }

  #notify(params: Record<string, unknown>) {
    const fake = this.#process;
    if (fake?.alive)
      fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'receive', params })}\n`);
  }

  // ── The phone's side ───────────────────────────────────────────────────

  /** The phone scans the code that's showing. */
  scan(number = MockSignal.OWNER.number): boolean {
    if (!this.#waiting) return false;
    this.#waiting.resolve(number);
    return true;
  }

  get showing(): boolean {
    return Boolean(this.#waiting);
  }

  /** A message: from you in Note to Self (the default), from a friend, or in a group. */
  async say(
    text: string,
    from: 'owner' | 'friend' | 'group' = 'owner',
    extra: { attachments?: Record<string, unknown>[]; quote?: number } = {},
  ): Promise<number> {
    const timestamp = ++this.#clock;
    const account = MockSignal.OWNER.number;
    const body = {
      timestamp,
      message: text,
      ...(extra.attachments && { attachments: extra.attachments }),
      ...(extra.quote && { quote: { id: extra.quote } }),
    };
    if (from === 'owner')
      this.#notify({
        account,
        envelope: {
          source: account,
          sourceNumber: account,
          sourceName: MockSignal.OWNER.name,
          sourceDevice: 1,
          timestamp,
          syncMessage: {
            sentMessage: { ...body, destination: account, destinationNumber: account },
          },
        },
      });
    else
      this.#notify({
        account,
        envelope: {
          source: MockSignal.FRIEND.number,
          sourceNumber: MockSignal.FRIEND.number,
          sourceUuid: MockSignal.FRIEND.uuid,
          sourceName: MockSignal.FRIEND.name,
          sourceDevice: 1,
          timestamp,
          dataMessage: {
            ...body,
            ...(from === 'group' && { groupInfo: { groupId: 'mockGroup==', type: 'DELIVER' } }),
          },
        },
      });
    return timestamp;
  }

  /** A picture from you: signal-cli saves the file in its folder first. */
  async photo(caption: string) {
    const id = `mock${++this.#clock}.png`;
    await mkdir(join(this.#dir, 'attachments'), { recursive: true });
    await writeFile(join(this.#dir, 'attachments', id), PNG);
    return this.say(caption, 'owner', {
      attachments: [{ id, contentType: 'image/png', filename: 'photo.png', size: PNG.length }],
    });
  }

  /** The newest message sent to a chat (Note to Self by default). */
  last(to: 'self' | string = 'self'): MockSignalSent | undefined {
    return this.sent
      .filter(
        (m) =>
          m.method === 'send' &&
          (to === 'self'
            ? m.params.noteToSelf === true
            : (m.params.recipient as string[] | undefined)?.includes(to)),
      )
      .at(-1);
  }

  // ── Breaking it on purpose ─────────────────────────────────────────────

  /** signal-cli stops (Conch starts it again). */
  crash() {
    this.#process?.exit(1);
  }

  /** The phone took this device off (Linked devices → Unlink). */
  unlink(number = MockSignal.OWNER.number) {
    this.#accounts.delete(number);
    this.#notify({
      account: number,
      exception: { message: '[401] Authorization failed!', type: 'AuthorizationFailedException' },
    });
  }

  // ── HTTP ───────────────────────────────────────────────────────────────

  async start(port = 0): Promise<string> {
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => res.writeHead(500).end(String(error)));
    });
    const server = this.#server;
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (!listening) {
      if (port === 0) throw new Error('The pretend Signal couldn’t start.');
      server.close();
      return this.start(0);
    }
    this.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return this.base;
  }

  async stop() {
    this.#process?.exit(null);
    this.#waiting?.reject(new Error('stopped'));
    await new Promise<void>((resolve) => {
      if (!this.#server) return resolve();
      this.#server.closeAllConnections();
      this.#server.close(() => resolve());
    });
  }

  async #handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const body = await readBody(req);
    const ok = (value: unknown = { ok: true }) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    switch (url.pathname) {
      case '/__control/scan':
        return ok({ ok: this.scan() });
      case '/__control/say':
        return ok({
          timestamp: await this.say(
            String(body.text ?? ''),
            body.from === 'friend' || body.from === 'group' ? body.from : 'owner',
            typeof body.quote === 'number' ? { quote: body.quote } : {},
          ),
        });
      case '/__control/photo':
        return ok({ timestamp: await this.photo(String(body.text ?? '')) });
      case '/__control/sent':
        return ok(this.sent);
      case '/__control/showing':
        return ok({ showing: this.showing });
      case '/__control/crash':
        this.crash();
        return ok();
      case '/__control/unlink':
        this.unlink();
        return ok();
      case '/__control/missing':
        this.missing = body.missing !== false;
        return ok();
      default:
        return res.writeHead(404).end();
    }
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
