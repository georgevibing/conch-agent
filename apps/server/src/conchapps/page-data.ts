/** Host-owned preferences and query cache, inside an app's existing data boundary (ADR 0092). */
import { createHash } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Mutex, writeJson } from '../lib/fs';
import type { AppCallOutcome } from './types';

const LIMIT = 2 * 1024 * 1024;
const Key = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .refine(
    (key) => !['__proto__', 'constructor', 'prototype'].includes(key),
    'Use a preference name other than a JavaScript prototype name.',
  );
export const StateRequest = z.discriminatedUnion('op', [
  z.object({ op: z.literal('get'), key: Key }).strict(),
  z.object({ op: z.literal('set'), key: Key, value: z.unknown() }).strict(),
  z.object({ op: z.literal('delete'), key: Key }).strict(),
]);
export const QueryRequest = z
  .object({
    tool: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/),
    input: z.record(z.string(), z.unknown()).default({}),
    mode: z.enum(['peek', 'read', 'refresh']).default('read'),
  })
  .strict();
const Outcome = z.object({ ok: z.boolean(), text: z.string(), json: z.unknown().optional() });
const Entry = z.object({ at: z.number(), generation: z.number(), value: Outcome });
const Saved = z.object({
  v: z.literal(1),
  scope: z.string(),
  generation: z.number(),
  state: z.record(z.string(), z.unknown()),
  queries: z.record(z.string(), Entry),
});
type Saved = z.infer<typeof Saved>;

/** Stable JSON identity: object property order doesn't make a second query. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

export class PageData {
  #locks = new Map<string, Mutex>();
  #pending = new Map<string, Promise<unknown>>();
  #lock(dir: string) {
    let lock = this.#locks.get(dir);
    if (!lock) {
      lock = new Mutex();
      this.#locks.set(dir, lock);
    }
    return lock;
  }
  async #read(dir: string, scope: string): Promise<Saved> {
    const text = await readFile(join(dir, '.page-data.json'), 'utf8').catch(() => '');
    let raw: unknown;
    try {
      raw = text.length <= LIMIT ? JSON.parse(text || 'null') : null;
    } catch {
      raw = null;
    }
    const parsed = Saved.safeParse(raw);
    if (parsed?.success) {
      if (parsed.data.scope === scope) return parsed.data;
      return { ...parsed.data, scope, generation: parsed.data.generation + 1, queries: {} };
    }
    return { v: 1, scope, generation: 0, state: {}, queries: {} };
  }
  async #save(dir: string, saved: Saved) {
    if (Buffer.byteLength(JSON.stringify(saved, null, 2)) > LIMIT)
      throw new Error(
        'This app’s page storage is full (2 MB). Remove unused preferences or cached queries.',
      );
    await writeJson(join(dir, '.page-data.json'), saved);
  }
  async state(dir: string, scope: string, input: unknown) {
    const request = StateRequest.parse(input);
    return this.#lock(dir).run(async () => {
      const saved = await this.#read(dir, scope);
      if (request.op === 'get')
        return Object.hasOwn(saved.state, request.key) ? saved.state[request.key] : null;
      if (request.op === 'delete')
        saved.state = Object.fromEntries(
          Object.entries(saved.state).filter(([key]) => key !== request.key),
        );
      else {
        if (request.value === undefined)
          throw new Error('Give this preference a JSON value; use delete to remove it.');
        if (Buffer.byteLength(JSON.stringify(request.value)) > 64 * 1024)
          throw new Error('Keep each page preference below 64 KB.');
        // Define an own property even for names inherited from Object.prototype.
        Object.defineProperty(saved.state, request.key, {
          value: request.value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      await this.#save(dir, saved);
      return null;
    });
  }
  async invalidate(dir: string, scope: string, clearState = false) {
    await this.#lock(dir).run(async () => {
      const saved = await this.#read(dir, scope);
      saved.generation++;
      if (clearState) {
        saved.state = {};
        saved.queries = {};
      }
      await this.#save(dir, saved);
    });
  }
  async query(
    dir: string,
    scope: string,
    input: z.infer<typeof QueryRequest>,
    maxAge: number,
    run: () => Promise<AppCallOutcome>,
    now = Date.now,
  ) {
    const key = createHash('sha256')
      .update(JSON.stringify(canonical({ tool: input.tool, input: input.input })))
      .digest('hex');
    const saved = await this.#lock(dir).run(() => this.#read(dir, scope));
    const entry = saved.queries[key];
    const stale =
      !entry ||
      entry.generation !== saved.generation ||
      now() - entry.at >= maxAge * 1000 ||
      entry.at > now();
    const snapshot = entry
      ? { value: entry.value, at: entry.at, stale }
      : { value: null, at: null, stale: true };
    if (input.mode === 'peek' || (input.mode === 'read' && !stale)) return snapshot;
    const pendingKey = `${dir}:${scope}:${saved.generation}:${key}`;
    const pending = this.#pending.get(pendingKey);
    if (pending) return pending;
    const work = (async () => {
      const value = await run();
      const at = now();
      if (
        !value.ok ||
        (value.json && typeof value.json === 'object' && 'setup_required' in value.json)
      )
        return { value, at, stale: true };
      let invalidated = false;
      await this.#lock(dir).run(async () => {
        const current = await this.#read(dir, scope);
        if (current.generation !== saved.generation) {
          invalidated = true;
          return;
        }
        current.queries[key] = { value, at, generation: saved.generation };
        // Bound cardinality as well as bytes; discard the oldest queries first.
        const keys = Object.keys(current.queries).sort(
          (a, b) => (current.queries[a]?.at ?? 0) - (current.queries[b]?.at ?? 0),
        );
        while (keys.length > 64) {
          const oldest = keys.shift();
          if (oldest) Reflect.deleteProperty(current.queries, oldest);
        }
        while (Buffer.byteLength(JSON.stringify(current, null, 2)) > LIMIT && keys.length > 1) {
          const oldest = keys.shift();
          if (oldest) Reflect.deleteProperty(current.queries, oldest);
        }
        // A full preference store must not turn a successful service read into a failure.
        if (Buffer.byteLength(JSON.stringify(current, null, 2)) > LIMIT) return;
        await this.#save(dir, current);
      });
      return invalidated ? { value: null, at: null, stale: true } : { value, at, stale: false };
    })();
    this.#pending.set(pendingKey, work);
    try {
      return await work;
    } finally {
      this.#pending.delete(pendingKey);
    }
  }
}

/** Repair everything inspects page storage without running any app tool. */
export async function checkPageData(
  dir: string,
  scope: string,
  repair: boolean,
): Promise<'ok' | 'damaged' | 'fixed'> {
  const path = join(dir, '.page-data.json');
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) return 'ok';
  let valid = false;
  try {
    valid = Buffer.byteLength(text) <= LIMIT && Saved.safeParse(JSON.parse(text)).success;
  } catch {
    /* An unreadable cache can be rebuilt. */
  }
  if (valid) return 'ok';
  if (!repair) return 'damaged';
  await rename(path, join(dir, '.page-data.bad'));
  await writeJson(path, { v: 1, scope, generation: 0, state: {}, queries: {} });
  return 'fixed';
}
