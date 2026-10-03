/**
 * The sealed runtime for a Conch app's tools (ADR 0061 §2). The gateway
 * starts one of these per app, in a Node process of its own, held by Node's
 * permission model (it reads only this file and the app's folder, and writes
 * only the app's data folder; no programs, workers, addons or `eval`). This
 * file then fences off the network and the rest of Node before the app's
 * code loads, and runs its tools when the gateway asks.
 *
 * ## The tools module
 *
 * `tools.mjs` exports one object, `tools`. Each key is a tool's name
 * (lowercase letters, numbers and underscores, starting with a letter, at
 * most 20 characters):
 *
 * ```js
 * export const tools = {
 *   log_watering: {
 *     title: 'Log watering',
 *     description: 'Records that a plant was watered. Use when the person says they watered one.',
 *     input: {
 *       type: 'object',
 *       properties: { plant: { type: 'string', description: 'The plant, as the person calls it' } },
 *       required: ['plant'],
 *     },
 *     changes: true,
 *     async run({ plant }, app) {
 *       await app.data.update('log', (log = []) => [...log, { plant, at: app.now() }]);
 *       return `Logged: ${plant} watered.`;
 *     },
 *   },
 * };
 * ```
 *
 * - `title`: a few words for people. `description`: what it does, and "Use
 *   when …", for the model.
 * - `input`: a JSON Schema object. Conch checks what the model sends against
 *   it before `run` sees it: `type`, `properties`, `required`, `enum`,
 *   `minimum`/`maximum`, `minLength`/`maxLength` and `items`.
 * - `changes: true` when it changes something (it keeps, sends or deletes);
 *   leave it out for a tool that only looks.
 * - `run(input, app)` may be async. It returns text (a string), JSON (an
 *   object or an array: the model gets it as pretty JSON), or nothing
 *   ("Done."). An Error it throws gives the model its message (at most
 *   2,000 characters), so write one the model can act on.
 *
 * `app` is everything a tool can reach:
 *
 * - `app.data`: what the app keeps, as JSON, on this computer.
 *   `get(key)`, `set(key, value)`, `update(key, fn)` (`fn` gets the value
 *   kept now and returns the new one; don't call `set` on the same key
 *   inside it), `delete(key)` and `keys()`. Keys are 1–64 letters, numbers,
 *   `_` or `-`. Writes are atomic and one at a time per key; 50 MB in all.
 * - `app.fetch(url, init)`: a web request, only to the hosts in the
 *   manifest's `reaches`, over https, made by Conch for the app: `method`,
 *   `headers` and `body` (text or bytes, at most 1 MB). It answers with
 *   `ok`, `status`, `headers.get(name)`, `text()`, `json()` and
 *   `arrayBuffer()` (at most 5 MB). When Conch refuses, it throws an Error
 *   that says why.
 * - `app.settings`: what the person typed for the manifest's `settings`.
 * - `app.now()`: the time now, as an ISO string.
 * - `app.log(...)`: a line in the app's log, for working out what happened.
 *
 * A tool can't import anything but the app's own files (`./like-this.mjs`),
 * and can't reach Node's modules, `fetch`, `process` or `eval`. Built-in
 * objects (`Object.prototype`, `Array.prototype` and the like) are frozen.
 * A call has 30 seconds.
 *
 * ## The wire (gateway ⇄ this process, over the IPC channel)
 *
 * - in: `init` (paths, settings, limits), `call` (id, tool, input), `fetched`
 *   (id, response);
 * - out: `ready` (the tools' definitions) or `broken` (why it didn't load),
 *   `result` (id, text or the error's message), `fetch` (id, request).
 *
 * The app never touches the channel: it sees a stand-in `process` with no
 * `send`, and the gateway checks every message anyway.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isBuiltin, registerHooks } from 'node:module';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'node:util';

// ── What this process keeps for itself, before anything else runs ─────────

const real = globalThis.process;
const send = real.send?.bind(real);
const onMessage = real.on.bind(real);
const writeErr = real.stderr.write.bind(real.stderr);
const exit = real.exit.bind(real);
const nextTick = real.nextTick.bind(real);
const hrtime = real.hrtime.bind(real);
const hrtimeBigint = real.hrtime.bigint.bind(real.hrtime);
const uptime = real.uptime.bind(real);
const HOST_URL = import.meta.url;
const { URL } = globalThis;
const { parse: jsonParse, stringify: jsonStringify } = JSON;
const { freeze, defineProperty, getPrototypeOf, entries, hasOwn } = Object;
const { isArray } = Array;
const BufferFrom = Buffer.from.bind(Buffer);
const BufferByteLength = Buffer.byteLength.bind(Buffer);

if (!send) {
  writeErr('This runtime only runs inside Conch.\n');
  exit(1);
}

/** Error messages name the app's own files, never where they are on this computer. */
let appDir = '';
let appUrl = '';
const local = (text) =>
  String(text)
    .split(appUrl)
    .join('')
    .split(appDir)
    .join('')
    .replace(/^[/\\]+/, '');

const trim = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ── The fence ─────────────────────────────────────────────────────────────

const deniedError = (message) => {
  const error = new Error(message);
  error.code = 'ERR_CONCH_APP_DENIED';
  return error;
};

const builtinName = (specifier) =>
  String(specifier)
    .replace(/^node:/, '')
    .split('/')[0];

/** Why a builtin is out of reach, in words a model can act on. */
function builtinDenied(specifier) {
  const name = builtinName(specifier);
  const why =
    name === 'fs' || name === 'sqlite'
      ? 'use app.data to keep things'
      : /^(net|tls|http|https|http2|dgram|dns|undici)$/.test(name)
        ? 'use app.fetch to reach the web'
        : 'a tool module only uses its own files and `app`';
  return deniedError(`Conch apps can’t use Node’s “${name}” module: ${why}.`);
}

const inside = (path) => {
  const rel = relative(appDir, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

function fileInApp(url) {
  if (!url.startsWith('file:')) return false;
  try {
    return inside(fileURLToPath(url));
  } catch {
    return false;
  }
}

let entryUrl = '';
let appContext;

/**
 * Only the app's own files, by relative paths that stay in its folder.
 * Everything else — Node's modules, packages, `data:`, `http:`, absolute
 * paths — is refused before Node looks for it.
 */
function installHooks() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL ?? '';
      const fromHost = parent === HOST_URL && specifier === entryUrl;
      if (!fromHost) {
        if (isBuiltin(specifier)) throw builtinDenied(specifier);
        if (/^[@a-z0-9_][^:]*$/i.test(specifier) && !specifier.startsWith('.'))
          throw deniedError(
            `Conch apps can’t import packages (“${trim(specifier, 80)}”): a tool module has no dependencies, so write what it needs in the app’s own files.`,
          );
        if (!fileInApp(parent) || !(specifier.startsWith('./') || specifier.startsWith('../')))
          throw deniedError(
            `Conch apps can’t import “${trim(String(specifier), 80)}”: a tool module only imports the app’s own files, like ./helpers.mjs.`,
          );
        let target;
        try {
          target = new URL(specifier, parent).href;
        } catch {
          throw deniedError(`“${trim(specifier, 80)}” isn’t a file in the app’s folder.`);
        }
        if (!fileInApp(target))
          throw deniedError(
            `Conch apps can’t import “${trim(specifier, 80)}”: it’s outside the app’s folder.`,
          );
      }
      const resolved = nextResolve(specifier, context);
      if (!fileInApp(resolved.url))
        throw deniedError(`Conch apps can’t import “${trim(specifier, 80)}”.`);
      return resolved;
    },
    load(url, context, nextLoad) {
      if (!fileInApp(url)) throw deniedError('Conch apps only load their own files.');
      const path = url.split(/[?#]/)[0] ?? '';
      // Always a module, never CommonJS (whose `require` and `module` reach further).
      if (/\.m?js$/i.test(path)) return nextLoad(url, { ...context, format: 'module' });
      if (/\.json$/i.test(path)) return nextLoad(url, { ...context, format: 'json' });
      throw deniedError(
        `Conch apps can only import .mjs, .js and .json files, not “${local(path)}”.`,
      );
    },
  });
}

/** `fetch`, sockets and undici's dispatcher: refused, so `app.fetch` is the only way out. */
function fenceNetwork() {
  const useAppFetch = () => {
    throw deniedError('Use app.fetch: Conch makes web requests for apps, to the sites they reach.');
  };
  defineProperty(globalThis, 'fetch', {
    value: freeze(function fetch() {
      return useAppFetch();
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
  for (const name of ['WebSocket', 'EventSource', 'WebSocketStream'])
    defineProperty(globalThis, name, {
      value: undefined,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  // undici (Node's fetch, `Request`, `Response`) finds its dispatcher at
  // `undici.globalDispatcher.<n>` (Node 24's is 2, with 1 for older code) and
  // makes a real one on first use if none is there. This one is there first,
  // in every slot, so it never does.
  const refusing = freeze({
    dispatch: useAppFetch,
    close: async () => {},
    destroy: async () => {},
    on() {
      return this;
    },
    once() {
      return this;
    },
    off() {
      return this;
    },
    emit: () => false,
  });
  for (let n = 1; n <= 9; n++)
    defineProperty(globalThis, Symbol.for(`undici.globalDispatcher.${n}`), {
      value: refusing,
      writable: false,
      configurable: false,
      enumerable: false,
    });
}

/**
 * The app's `process`: harmless facts and nothing to hold. The real one
 * (with `kill`, `send`, the IPC channel and its handles) stays with this file.
 */
function standInProcess() {
  const no = (what) =>
    freeze(function refused() {
      throw deniedError(`Conch apps can’t use process.${what}.`);
    });
  const hr = freeze(Object.assign((...args) => hrtime(...args), { bigint: () => hrtimeBigint() }));
  return freeze({
    env: freeze({}),
    argv: freeze([]),
    execArgv: freeze([]),
    platform: real.platform,
    arch: real.arch,
    version: real.version,
    versions: freeze({ ...real.versions }),
    release: freeze({ name: real.release.name }),
    pid: 0,
    ppid: 0,
    title: 'conch-app',
    exitCode: undefined,
    nextTick: (fn, ...args) => nextTick(fn, ...args),
    hrtime: hr,
    uptime: () => uptime(),
    cwd: () => '/',
    emitWarning: () => {},
    on() {
      return this;
    },
    once() {
      return this;
    },
    off() {
      return this;
    },
    getBuiltinModule: freeze(function getBuiltinModule(id) {
      throw builtinDenied(id);
    }),
    binding: no('binding'),
    _linkedBinding: no('_linkedBinding'),
    dlopen: no('dlopen'),
    kill: no('kill'),
    exit: no('exit'),
    abort: no('abort'),
    chdir: no('chdir'),
    send: no('send'),
    disconnect: no('disconnect'),
    execve: no('execve'),
    memoryUsage: no('memoryUsage'),
  });
}

/** The real one too, in case anything ever hands it out: its doors are locked. */
function lockRealProcess() {
  const no = (what) =>
    function refused() {
      throw deniedError(`Conch apps can’t use process.${what}.`);
    };
  for (const name of [
    'getBuiltinModule',
    'kill',
    'send',
    'disconnect',
    'execve',
    'dlopen',
    'binding',
    '_linkedBinding',
    '_getActiveHandles',
    '_getActiveRequests',
    'chdir',
    'setuid',
    'setgid',
    'setegid',
    'seteuid',
    'setgroups',
    'initgroups',
    'loadEnvFile',
  ])
    if (name in real)
      try {
        defineProperty(real, name, { value: no(name), writable: false, configurable: false });
      } catch {
        // A property Node already made fixed stays as Node made it (and the permission model guards it).
      }
  // `channel` stays: Node's own IPC reads through it (and the app never sees this object).
  for (const name of ['mainModule', 'report'])
    try {
      defineProperty(real, name, { value: undefined, writable: false, configurable: false });
    } catch {
      // As above.
    }
  defineProperty(globalThis, 'process', {
    value: standInProcess(),
    writable: false,
    configurable: false,
    enumerable: false,
  });
}

/**
 * The app's `console`: lines in its log. Node's own holds its streams
 * (`console._stderr` is a socket here, whose constructor could dial out).
 */
function standInConsole() {
  const write = (...args) => {
    writeErr(`${trim(format(...args), 4000)}\n`);
  };
  const quiet = () => {};
  defineProperty(globalThis, 'console', {
    value: freeze({
      log: write,
      info: write,
      warn: write,
      error: write,
      debug: write,
      trace: write,
      dir: write,
      dirxml: write,
      table: write,
      assert: (ok, ...args) => {
        if (!ok) write('Assertion failed', ...args);
      },
      count: quiet,
      countReset: quiet,
      group: quiet,
      groupCollapsed: quiet,
      groupEnd: quiet,
      time: quiet,
      timeEnd: quiet,
      timeLog: quiet,
      clear: quiet,
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
}

/**
 * Built-ins the app could reshape to reach what this file holds (a getter on
 * `Object.prototype` sees every object Node reads a missing property from):
 * frozen before its code runs.
 */
function harden() {
  const iteratorProto = getPrototypeOf(getPrototypeOf([][Symbol.iterator]()));
  const asyncIteratorProto = getPrototypeOf(
    getPrototypeOf(getPrototypeOf((async function* () {})())),
  );
  const generatorProto = getPrototypeOf(function* () {});
  const asyncGeneratorProto = getPrototypeOf(async function* () {});
  const asyncFunctionProto = getPrototypeOf(async function () {});
  const typedArray = getPrototypeOf(Uint8Array);
  const targets = [
    Object,
    Object.prototype,
    Function,
    Function.prototype,
    Array,
    Array.prototype,
    String,
    String.prototype,
    Number,
    Number.prototype,
    Boolean,
    Boolean.prototype,
    Symbol,
    Symbol.prototype,
    BigInt,
    BigInt.prototype,
    Promise,
    Promise.prototype,
    RegExp,
    RegExp.prototype,
    Map,
    Map.prototype,
    Set,
    Set.prototype,
    WeakMap,
    WeakMap.prototype,
    WeakSet,
    WeakSet.prototype,
    WeakRef,
    WeakRef.prototype,
    JSON,
    Reflect,
    Proxy,
    URL,
    URL.prototype,
    URLSearchParams,
    URLSearchParams.prototype,
    ArrayBuffer,
    ArrayBuffer.prototype,
    typedArray,
    typedArray.prototype,
    Uint8Array,
    Uint8Array.prototype,
    DataView,
    DataView.prototype,
    iteratorProto,
    asyncIteratorProto,
    generatorProto,
    generatorProto.prototype,
    asyncGeneratorProto,
    asyncGeneratorProto.prototype,
    asyncFunctionProto,
    asyncFunctionProto.constructor,
    generatorProto.constructor,
    asyncGeneratorProto.constructor,
    Buffer,
  ];
  if (typeof Iterator === 'function') targets.push(Iterator, Iterator.prototype);
  for (const target of targets) freeze(target);
}

// ── What a tool can reach ─────────────────────────────────────────────────

const KEY = /^[A-Za-z0-9_-]{1,64}$/;
let dataDir = '';
let limits = { data: 50 * 1024 * 1024, fetchOut: 1024 * 1024, text: 100_000, error: 2000 };

function checkKey(key) {
  if (typeof key !== 'string' || !KEY.test(key))
    throw new Error(
      `“${trim(String(key), 40)}” can’t be a key: use 1 to 64 letters, numbers, _ or -.`,
    );
  return key;
}

/** Bytes kept per key, read once, then kept up to date by the writes below. */
let sizes;
async function knownSizes() {
  if (sizes) return sizes;
  const found = new Map();
  for (const name of await readdir(dataDir).catch(() => [])) {
    if (!name.endsWith('.json') || !KEY.test(name.slice(0, -5))) continue;
    const info = await stat(join(dataDir, name)).catch(() => undefined);
    if (info?.isFile()) found.set(name.slice(0, -5), info.size);
  }
  sizes = found;
  return found;
}

const SHARING = new Set(['EPERM', 'EACCES', 'EBUSY']);
async function replace(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (real.platform !== 'win32' || !SHARING.has(error?.code) || attempt >= 8) throw error;
      await new Promise((done) => setTimeout(done, Math.min(20 * 2 ** attempt, 500)));
    }
  }
}

async function readValue(key) {
  let text;
  try {
    text = await readFile(join(dataDir, `${key}.json`), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw new Error(`Couldn’t read “${key}” from the app’s data.`);
  }
  try {
    return jsonParse(text);
  } catch {
    throw new Error(`What’s kept under “${key}” is damaged. Set it again, or delete it.`);
  }
}

/** Bytes being written right now, one entry per write: counted against the cap. */
const writing = new Map();
let lastReservation = 0;

/** A write's temp file, left behind when the process was stopped mid-write. */
const TEMP_FILE = /^\..*\.tmp$/;

/** Temp files from a process stopped mid-write: never counted, so never kept. */
async function sweepTemp() {
  for (const name of await readdir(dataDir).catch(() => []))
    if (TEMP_FILE.test(name)) await rm(join(dataDir, name), { force: true }).catch(() => undefined);
}

async function writeValue(key, value) {
  if (value === undefined) return removeValue(key);
  let text;
  try {
    text = jsonStringify(value);
  } catch (error) {
    throw new Error(`Only JSON can be kept, and “${key}” isn’t: ${error?.message ?? error}`);
  }
  if (text === undefined) throw new Error(`Only JSON can be kept, and “${key}” isn’t.`);
  const bytes = BufferByteLength(text);
  const known = await knownSizes();
  // From here to the reservation nothing waits, so two writes at once can't
  // both fit in the room only one has. A write's temp file counts until it's
  // renamed; the value it replaces is subtracted, since the rename removes it.
  let total = 0;
  for (const size of known.values()) total += size;
  for (const size of writing.values()) total += size;
  if (total - (known.get(key) ?? 0) + bytes > limits.data)
    throw new Error(
      `The app’s data is full (${Math.round(limits.data / 1024 / 1024)} MB). Delete what it no longer needs, then try again.`,
    );
  const reservation = ++lastReservation;
  writing.set(reservation, bytes);
  const path = join(dataDir, `${key}.json`);
  const tmp = join(dataDir, `.${key}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(tmp, text);
    await replace(tmp, path);
    known.set(key, bytes);
  } catch (error) {
    await rm(tmp, { force: true });
    throw new Error(`Couldn’t keep “${key}”: ${error?.code ?? 'the disk refused'}.`);
  } finally {
    writing.delete(reservation);
  }
}

async function removeValue(key) {
  await rm(join(dataDir, `${key}.json`), { force: true });
  (await knownSizes()).delete(key);
}

/** One write at a time per key, in the order they were asked for. */
const queues = new Map();
function serial(key, work) {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(work, work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return run;
}

const data = freeze({
  get: async (key) => readValue(checkKey(key)),
  set: async (key, value) => {
    checkKey(key);
    await serial(key, () => writeValue(key, value));
  },
  update: async (key, fn) => {
    checkKey(key);
    if (typeof fn !== 'function') throw new Error('app.data.update needs a function.');
    return serial(key, async () => {
      const next = await fn(await readValue(key));
      await writeValue(key, next);
      return next;
    });
  },
  delete: async (key) => {
    checkKey(key);
    await serial(key, () => removeValue(key));
  },
  keys: async () => {
    const names = await readdir(dataDir).catch(() => []);
    return names
      .filter((name) => name.endsWith('.json') && KEY.test(name.slice(0, -5)))
      .map((name) => name.slice(0, -5))
      .sort();
  },
});

// ── app.fetch, through Conch ──────────────────────────────────────────────

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
let lastId = 0;
const fetches = new Map();

function headersOf(given) {
  const out = {};
  if (given === undefined || given === null) return out;
  const add = (name, value) => {
    out[String(name).toLowerCase()] = String(value);
  };
  if (typeof given.forEach === 'function' && !isArray(given)) given.forEach((v, k) => add(k, v));
  else if (isArray(given))
    for (const pair of given) {
      if (!isArray(pair) || pair.length !== 2) throw new Error('Headers are [name, value] pairs.');
      add(pair[0], pair[1]);
    }
  else if (typeof given === 'object') for (const [k, v] of entries(given)) add(k, v);
  else throw new Error('Headers are an object of names and values.');
  return out;
}

function bodyOf(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return { body, bodyBase64: false, bytes: BufferByteLength(body) };
  if (body instanceof URLSearchParams) {
    const text = body.toString();
    return { body: text, bodyBase64: false, bytes: BufferByteLength(text), form: true };
  }
  let bytes;
  if (body instanceof ArrayBuffer) bytes = BufferFrom(body);
  else if (ArrayBuffer.isView(body))
    bytes = BufferFrom(body.buffer, body.byteOffset, body.byteLength);
  else
    throw new Error(
      'app.fetch sends text or bytes: use JSON.stringify(…) for JSON, with a content-type header.',
    );
  return { body: bytes.toString('base64'), bodyBase64: true, bytes: bytes.length };
}

function responseOf(answer) {
  const bytes = answer.bodyBase64
    ? BufferFrom(answer.body ?? '', 'base64')
    : BufferFrom(answer.body ?? '', 'utf8');
  const headers = freeze({ ...(answer.headers ?? {}) });
  let used = false;
  const take = () => {
    if (used) throw new Error('This answer was already read: keep what text() or json() gave.');
    used = true;
    return bytes;
  };
  return freeze({
    ok: answer.ok === true,
    status: Number(answer.status) || 0,
    headers: freeze({
      get: (name) => headers[String(name).toLowerCase()] ?? null,
      has: (name) => hasOwn(headers, String(name).toLowerCase()),
      forEach: (fn) => {
        for (const [k, v] of entries(headers)) fn(v, k);
      },
    }),
    text: async () => take().toString('utf8'),
    json: async () => {
      const text = take().toString('utf8');
      try {
        return jsonParse(text);
      } catch {
        throw new Error(`The site’s answer isn’t JSON: ${trim(text.trim(), 120) || '(empty)'}`);
      }
    },
    arrayBuffer: async () => {
      const b = take();
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  });
}

async function appFetch(input, init = {}) {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : typeof input?.url === 'string'
          ? input.url
          : undefined;
  if (!url) throw new Error('app.fetch needs a web address, like https://api.example.com/x.');
  init = init ?? {};
  const method = String(init.method ?? 'GET').toUpperCase();
  if (!METHODS.has(method))
    throw new Error(
      `app.fetch can’t send ${trim(method, 20)}: use GET, POST, PUT, PATCH, DELETE or HEAD.`,
    );
  const headers = headersOf(init.headers);
  const body = bodyOf(init.body);
  if (body && (method === 'GET' || method === 'HEAD'))
    throw new Error(`A ${method} request can’t carry a body.`);
  if (body && body.bytes > limits.fetchOut)
    throw new Error(
      `That’s too much to send: at most ${Math.round(limits.fetchOut / 1024)} KB in one request.`,
    );
  if (body?.form && !headers['content-type'])
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  const id = ++lastId;
  const answer = await new Promise((resolve) => {
    fetches.set(id, resolve);
    send({
      t: 'fetch',
      id,
      request: {
        url: trim(url, 4000),
        method,
        headers,
        ...(body && { body: body.body, bodyBase64: body.bodyBase64 }),
      },
    });
  });
  if (answer.refused) throw new Error(answer.refused);
  return responseOf(answer);
}

// ── Loading the app, and running its tools ────────────────────────────────

let tools = {};

function definitionOf(name, tool) {
  const text = (value) => (typeof value === 'string' ? value : null);
  let input = null;
  try {
    input = tool.input === undefined ? null : jsonParse(jsonStringify(tool.input) ?? 'null');
  } catch {
    input = 'unreadable';
  }
  return {
    // Cut to what the gateway reads, so a long one is named as too long rather than lost.
    name: trim(name, 100),
    title: text(tool.title) === null ? null : trim(tool.title, 2000),
    description: text(tool.description) === null ? null : trim(tool.description, 10_000),
    input,
    changes: typeof tool.changes === 'boolean' ? tool.changes : null,
    runs: typeof tool.run === 'function',
  };
}

async function load(message) {
  appDir = message.appDir;
  dataDir = message.dataDir;
  appUrl = pathToFileURL(appDir).href;
  limits = { ...limits, ...message.limits };
  entryUrl = pathToFileURL(join(appDir, message.tools)).href;
  const settings = freeze({ ...message.settings });
  await sweepTemp();
  installHooks();
  fenceNetwork();
  lockRealProcess();
  standInConsole();
  harden();
  appContext = freeze({
    data,
    fetch: appFetch,
    settings,
    now: () => new Date().toISOString(),
    log: (...args) => {
      writeErr(`${trim(format(...args), 4000)}\n`);
    },
  });
  let module;
  try {
    module = await import(entryUrl);
  } catch (error) {
    return send({
      t: 'broken',
      message: trim(local(error?.message ?? String(error)), 1500),
    });
  }
  const exported = module.tools;
  if (!exported || typeof exported !== 'object' || isArray(exported))
    return send({
      t: 'broken',
      message: `${message.tools} doesn’t export its tools: add export const tools = { … }.`,
    });
  tools = exported;
  const definitions = [];
  for (const [name, tool] of entries(exported).slice(0, 64)) {
    if (!tool || typeof tool !== 'object')
      return send({ t: 'broken', message: `The tool “${trim(name, 40)}” isn’t an object.` });
    definitions.push(definitionOf(name, tool));
  }
  send({ t: 'ready', tools: definitions });
}

function textOf(value) {
  if (value === undefined) return { text: 'Done.' };
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'bigint') return { text: value.toString() };
  let json;
  try {
    json = jsonStringify(value, null, 2);
  } catch (error) {
    throw new Error(
      `The tool returned something that isn’t text or JSON: ${error?.message ?? error}`,
    );
  }
  if (json === undefined) throw new Error('The tool returned something that isn’t text or JSON.');
  if (json.length > limits.text)
    return { text: `${json.slice(0, limits.text)}\n… (cut: the answer was too long)` };
  return { text: json, json: jsonParse(json) };
}

async function call(message) {
  const tool = hasOwn(tools, message.tool) ? tools[message.tool] : undefined;
  let reply;
  try {
    if (!tool || typeof tool.run !== 'function')
      throw new Error(`This app has no tool called “${trim(String(message.tool), 40)}”.`);
    const out = textOf(await tool.run(freeze(message.input ?? {}), appContext));
    reply = { t: 'result', id: message.id, ok: true, text: trim(out.text, limits.text) };
    if (out.json !== undefined) reply.json = out.json;
  } catch (error) {
    const said =
      error instanceof Error || typeof error?.message === 'string' ? error.message : String(error);
    reply = {
      t: 'result',
      id: message.id,
      ok: false,
      message: trim(
        local(String(said)).trim() || 'The tool failed without saying why.',
        limits.error,
      ),
    };
  }
  send(reply);
}

let loaded = false;
onMessage('message', (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.t === 'init' && !loaded) {
    loaded = true;
    load(message).catch((error) =>
      send({ t: 'broken', message: trim(local(error?.message ?? String(error)), 1500) }),
    );
  } else if (message.t === 'call' && loaded && typeof message.id === 'number') {
    call(message);
  } else if (message.t === 'fetched' && typeof message.id === 'number') {
    const resolve = fetches.get(message.id);
    fetches.delete(message.id);
    resolve?.(message.response ?? { refused: 'Conch couldn’t make that request.' });
  }
});
onMessage('disconnect', () => exit(0));
// A tool's stray rejection is its own problem, not the end of every other call.
onMessage('unhandledRejection', (reason) => {
  writeErr(`${trim(local(String(reason?.stack ?? reason)), 2000)}\n`);
});
