/**
 * When another app sends a message (ADR 0056): an address on the public door
 * (ADR 0045), at an id Conch makes (32 random bytes). Off unless someone
 * creates one. With a secret it only takes signed deliveries — the Standard
 * Webhooks headers, or GitHub's — compared in constant time, refusing stale
 * and repeated ones. Without one, the unguessable address is the key, and the
 * same message twice in ten minutes is taken once.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

import { z } from 'zod';

import type { HookHandler, HookReply, HookRequest } from '../../channels/door';
import { Mutex, writeJson } from '../../lib/fs';
import { readStore } from '../../lib/recover';
import { SourceError, type Happening, type TriggerSource } from './types';

/** The biggest message another app may send (bytes). */
export const HOOK_BODY_LIMIT = 64 * 1024;
/** A signed delivery more than this far from now is stale. */
export const HOOK_TOLERANCE_MS = 5 * 60_000;
/** Deliveries remembered, to refuse them a second time. */
const REMEMBER_MS = 24 * 60 * 60_000;
const SAME_BODY_MS = 10 * 60_000;
const DETAIL_CHARS = 8_000;

/** What the source needs from the public door. */
export interface HookDoor {
  mount(hookId: string, handler: HookHandler): () => void;
  /** The address, while the door is reachable. */
  url(hookId: string): string | undefined;
  ready(): boolean;
  onChange(listener: () => void): () => void;
}

const SecretsFile = z.object({
  hooks: z.record(z.string(), z.object({ secret: z.string(), at: z.number() })).default({}),
});

/**
 * `routines.secrets.json`: each address's secret, sealed under this
 * computer's key (`lib/sealed.ts`), `secret` in backups, out of the
 * assistant's reach (`lib/protect.ts`). Shown once when made.
 */
export class HookSecrets {
  readonly path: string;
  #mutex = new Mutex();

  constructor(home: string) {
    this.path = join(home, 'routines.secrets.json');
  }

  async get(hookId: string): Promise<string | undefined> {
    return (await readStore(this.path, SecretsFile)).value.hooks[hookId]?.secret;
  }

  /** A new secret for this address (the old one stops working), to show once. */
  create(hookId: string): Promise<string> {
    return this.#mutex.run(async () => {
      const file = (await readStore(this.path, SecretsFile)).value;
      // The Standard Webhooks form: whsec_ and base64, so their libraries sign with it as is.
      const secret = `whsec_${randomBytes(24).toString('base64')}`;
      file.hooks[hookId] = { secret, at: Date.now() };
      await writeJson(this.path, file);
      return secret;
    });
  }

  remove(hookId: string): Promise<void> {
    return this.#mutex.run(async () => {
      const file = (await readStore(this.path, SecretsFile)).value;
      if (!file.hooks[hookId]) return;
      file.hooks = Object.fromEntries(Object.entries(file.hooks).filter(([id]) => id !== hookId));
      await writeJson(this.path, file);
    });
  }
}

export const newHookId = () => randomBytes(32).toString('base64url');

const equal = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/**
 * Check a delivery's signature. `ok` with its id when it's signed by the
 * secret; why not otherwise. Standard Webhooks: `webhook-id`,
 * `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256 of
 * id.timestamp.body>`, keyed with the secret's base64 part. GitHub:
 * `x-hub-signature-256: sha256=<hex HMAC-SHA256 of the body>`, keyed with the
 * secret as written, and `x-github-delivery` as its id.
 */
export function verifyDelivery(
  request: Pick<HookRequest, 'headers' | 'body'>,
  secret: string,
  now: number,
): { ok: true; id: string } | { ok: false; why: string } {
  const h = request.headers;
  const signatures = h['webhook-signature'];
  if (signatures) {
    const id = h['webhook-id'] ?? '';
    const stamp = Number(h['webhook-timestamp'] ?? '');
    if (!id || id.length > 200 || !Number.isFinite(stamp))
      return { ok: false, why: 'Missing webhook-id or webhook-timestamp.' };
    if (Math.abs(now - stamp * 1000) > HOOK_TOLERANCE_MS)
      return { ok: false, why: 'Stale: the timestamp is too far from now.' };
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key).update(`${id}.${stamp}.${request.body}`).digest();
    const good = signatures
      .split(' ')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('v1,'))
      .some((s) => equal(Buffer.from(s.slice(3), 'base64'), expected));
    return good ? { ok: true, id: `sw:${id}` } : { ok: false, why: 'The signature doesn’t match.' };
  }
  const github = h['x-hub-signature-256'];
  if (github) {
    const expected = createHmac('sha256', Buffer.from(secret, 'utf8'))
      .update(request.body)
      .digest();
    const given = /^sha256=([0-9a-f]{64})$/i.exec(github.trim())?.[1];
    if (!given || !equal(Buffer.from(given, 'hex'), expected))
      return { ok: false, why: 'The signature doesn’t match.' };
    const delivery = h['x-github-delivery'];
    return {
      ok: true,
      id: delivery
        ? `gh:${delivery.slice(0, 200)}`
        : `gh:${createHash('sha256').update(request.body).digest('hex')}`,
    };
  }
  return { ok: false, why: 'This address only takes signed messages.' };
}

/** What arrived, shown to the run as data: JSON tidied, anything else as text, cut to size. */
export function payloadText(body: string, type: string | undefined): string {
  let text = body;
  if (/json/i.test(type ?? '') || /^\s*[{[]/.test(body)) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Not JSON after all: as it came.
    }
  }
  return text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS)}\n[…]` : text;
}

export function hookSource(deps: {
  door: HookDoor;
  secrets: Pick<HookSecrets, 'get'>;
  now?: () => number;
}): TriggerSource<'hook'> {
  const now = () => deps.now?.() ?? Date.now();
  const doorProblem = () =>
    new SourceError(
      'needs-you',
      'Turn on its public address so other apps can reach this routine.',
      { label: 'Turn it on', place: 'channels' },
    );
  return {
    kind: 'hook',
    describe: () => 'When another app sends a message',
    note: () =>
      'Another app sends a message to this routine’s own address. Nothing else can reach Conch through it.',
    taint: () => ({ kind: 'app', label: 'a message from another app' }),
    watch(ctx, arrive, problem) {
      const hookId = ctx.trigger.hookId;
      if (!hookId) {
        problem(new SourceError('needs-you', 'This routine has no address yet. Edit it and save.'));
        return { stop: () => undefined };
      }
      const delivered = new Map<string, number>();
      const remembered = (id: string, window: number) => {
        const t = now();
        for (const [k, at] of delivered) if (t - at > REMEMBER_MS) delivered.delete(k);
        const at = delivered.get(id);
        if (at !== undefined && t - at < window) return true;
        delivered.set(id, t);
        return false;
      };
      const handler = async (request: HookRequest): Promise<HookReply> => {
        if (request.method !== 'POST') return { status: 405, body: 'Send it with POST.' };
        if (Buffer.byteLength(request.body, 'utf8') > HOOK_BODY_LIMIT)
          return { status: 413, body: 'Too big: at most 64 KB.' };
        const secret = await deps.secrets.get(hookId);
        let id: string;
        if (secret) {
          const verdict = verifyDelivery(request, secret, now());
          if (!verdict.ok) return { status: 401, body: verdict.why };
          id = verdict.id;
          if (remembered(id, REMEMBER_MS)) return { status: 200, body: 'Already received.' };
        } else {
          const digest = createHash('sha256').update(request.body).digest('base64url');
          if (remembered(`body:${digest}`, SAME_BODY_MS))
            return { status: 200, body: 'Already received.' };
          id = `body:${digest}:${now()}`;
        }
        const happening: Happening = {
          id: `hook:${id}`,
          at: now(),
          label: 'a message from another app',
          detail: payloadText(request.body, request.headers['content-type']),
        };
        arrive([happening]);
        return { status: 202, body: 'Accepted.' };
      };
      const unmount = deps.door.mount(hookId, handler);
      const look = () => problem(deps.door.ready() ? undefined : doorProblem());
      look();
      const off = deps.door.onChange(look);
      return {
        stop() {
          off();
          unmount();
        },
      };
    },
  };
}
