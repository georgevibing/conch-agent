/**
 * End-to-end encryption for Matrix (ADR 0045): Matrix's own Rust crypto
 * (`matrix-sdk-crypto`, the same code Element uses), through its WebAssembly
 * build, so nothing native has to be installed.
 *
 * The crypto keeps its state in IndexedDB, which Node doesn't have. Conch
 * gives it an in-memory one (`fake-indexeddb`) and writes a snapshot of that
 * channel's databases to `~/.conch/channels/matrix-<id>.json` after every
 * sync that changed something, together with the sync position. Restoring
 * the snapshot and the position together means a crash can only replay a
 * sync Conch already handled, never lose a key it used. Every value in the
 * store is encrypted by the crypto itself with the channel's store key,
 * which lives in the sealed `channels.secrets.json` (ADR 0025).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';

import type * as Wasm from '@matrix-org/matrix-sdk-crypto-wasm';

import { writeFileAtomic } from '../lib/fs';

type Sdk = typeof Wasm;

let loading: Promise<Sdk> | undefined;

/** The crypto, loaded the first time a Matrix channel needs it (it's a few megabytes). */
export function cryptoSdk(): Promise<Sdk> {
  loading ??= (async () => {
    // Only ever this process's own, in memory; written to disk as snapshots below.
    // The crypto checks what it's handed against IndexedDB's own classes, so they're all set.
    if (!('indexedDB' in globalThis)) {
      const idb = (await import('fake-indexeddb')) as unknown as Record<string, unknown>;
      for (const name of [
        'indexedDB',
        'IDBCursor',
        'IDBCursorWithValue',
        'IDBDatabase',
        'IDBFactory',
        'IDBIndex',
        'IDBKeyRange',
        'IDBObjectStore',
        'IDBOpenDBRequest',
        'IDBRequest',
        'IDBTransaction',
        'IDBVersionChangeEvent',
      ])
        Object.defineProperty(globalThis, name, {
          value: idb[name],
          configurable: true,
          writable: true,
          enumerable: false,
        });
    }
    const sdk = await import('@matrix-org/matrix-sdk-crypto-wasm');
    await sdk.initAsync();
    return sdk;
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/** What one Matrix channel keeps between runs. */
export interface MatrixMemory {
  /** Where the last handled sync ended. */
  since?: string;
  /** The private room with each person, by their Matrix id. */
  rooms: Record<string, string>;
  /** The crypto's databases, as written by `dump`. */
  crypto?: Buffer;
}

// Just the parts of IndexedDB used here (the gateway is built without the DOM's types).
type Key = string | number | Date | ArrayBufferView | ArrayBuffer | Key[];
interface Req<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}
interface OpenReq extends Req<Db> {
  onupgradeneeded: (() => void) | null;
}
interface Store {
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexNames: Iterable<string>;
  index(name: string): { keyPath: string | string[]; unique: boolean; multiEntry: boolean };
  getAll(): Req<unknown[]>;
  getAllKeys(): Req<Key[]>;
  put(value: unknown, key?: Key): unknown;
  createIndex(
    name: string,
    keyPath: string | string[],
    options: { unique: boolean; multiEntry: boolean },
  ): unknown;
}
interface Tx {
  objectStore(name: string): Store;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  error: unknown;
}
interface Db {
  version: number;
  objectStoreNames: Iterable<string>;
  transaction(names: string | string[], mode: 'readonly' | 'readwrite'): Tx;
  createObjectStore(
    name: string,
    options: { keyPath?: string | string[]; autoIncrement: boolean },
  ): Store;
  close(): void;
}
interface Factory {
  databases(): Promise<{ name?: string; version?: number }[]>;
  open(name: string, version?: number): OpenReq;
  deleteDatabase(name: string): Req<unknown>;
}

interface StoreDump {
  name: string;
  version: number;
  stores: {
    name: string;
    keyPath: string | string[] | null;
    autoIncrement: boolean;
    indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
    keys: Key[];
    values: unknown[];
  }[];
}

const failed = (error: unknown) =>
  error instanceof Error ? error : new Error('IndexedDB failed.');

const done = <T>(request: Req<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(failed(request.error));
  });

const factory = () => (globalThis as unknown as { indexedDB: Factory }).indexedDB;

/** Whether this process already has a session's databases (a reconnect, not a start). */
export async function present(prefix: string): Promise<boolean> {
  return (await factory().databases()).some((db) => db.name?.startsWith(prefix));
}

/** The databases whose names start with `prefix`, as one buffer. */
export async function dump(prefix: string): Promise<Buffer> {
  const out: StoreDump[] = [];
  for (const info of await factory().databases()) {
    if (!info.name?.startsWith(prefix)) continue;
    const db = await done(factory().open(info.name));
    const stores: StoreDump['stores'] = [];
    for (const name of db.objectStoreNames) {
      const store = db.transaction(name, 'readonly').objectStore(name);
      const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
      stores.push({
        name,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes: [...store.indexNames].map((index) => {
          const i = store.index(index);
          return { name: index, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry };
        }),
        keys,
        values,
      });
    }
    out.push({ name: info.name, version: db.version, stores });
    db.close();
  }
  return serialize(out);
}

/** Put databases back from `dump`, replacing any of the same names. */
export async function restore(bytes: Buffer): Promise<void> {
  const data = deserialize(bytes) as StoreDump[];
  for (const db of data) {
    await done(factory().deleteDatabase(db.name));
    await new Promise<void>((resolve, reject) => {
      const request = factory().open(db.name, db.version);
      request.onupgradeneeded = () => {
        for (const s of db.stores) {
          const store = request.result.createObjectStore(s.name, {
            ...(s.keyPath !== null && { keyPath: s.keyPath }),
            autoIncrement: s.autoIncrement,
          });
          for (const i of s.indexes)
            store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
        }
      };
      request.onerror = () => reject(failed(request.error));
      request.onsuccess = () => {
        const opened = request.result;
        const names = db.stores.map((s) => s.name);
        if (!names.length) {
          opened.close();
          resolve();
          return;
        }
        const tx = opened.transaction(names, 'readwrite');
        for (const s of db.stores) {
          const store = tx.objectStore(s.name);
          s.values.forEach((value, i) =>
            s.keyPath === null ? store.put(value, s.keys[i]) : store.put(value),
          );
        }
        tx.oncomplete = () => {
          opened.close();
          resolve();
        };
        tx.onerror = () => reject(failed(tx.error));
      };
    });
  }
}

/** Forget a channel's databases (it was removed). */
export async function forget(prefix: string): Promise<void> {
  for (const info of await factory().databases())
    if (info.name?.startsWith(prefix))
      // A session still closing holds it open: the delete finishes when it lets go.
      await Promise.race([
        done(factory().deleteDatabase(info.name)),
        new Promise((resolve) => setTimeout(resolve, 5_000).unref()),
      ]);
}

/** One file per Matrix session: its name says nothing about the account. */
export function memoryPath(home: string, userId: string, deviceId: string): string {
  const id = createHash('sha256').update(`${userId}\n${deviceId}`).digest('hex').slice(0, 24);
  return join(home, 'channels', `matrix-${id}.json`);
}

export async function readMemory(path: string): Promise<MatrixMemory> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as {
      since?: unknown;
      rooms?: unknown;
      crypto?: unknown;
    };
    const rooms: Record<string, string> = {};
    if (raw.rooms && typeof raw.rooms === 'object')
      for (const [user, room] of Object.entries(raw.rooms as Record<string, unknown>))
        if (typeof room === 'string') rooms[user] = room;
    return {
      ...(typeof raw.since === 'string' && { since: raw.since }),
      rooms,
      ...(typeof raw.crypto === 'string' && { crypto: Buffer.from(raw.crypto, 'base64') }),
    };
  } catch {
    // Missing or damaged: start a new session's memory (the crypto makes new keys).
    return { rooms: {} };
  }
}

export async function writeMemory(path: string, memory: MatrixMemory): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFileAtomic(
    path,
    `${JSON.stringify({
      version: 1,
      ...(memory.since && { since: memory.since }),
      rooms: memory.rooms,
      ...(memory.crypto && { crypto: memory.crypto.toString('base64') }),
    })}\n`,
  );
}

export async function removeMemory(path: string): Promise<void> {
  await rm(path, { force: true });
}
