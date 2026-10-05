/**
 * The sealed runtime (ADR 0061 §2), tested from inside real child
 * processes: every way out an app's code might try is refused, the
 * permission model itself holds (with a stand-in runtime that has Node's
 * modules, to prove the flags do what they say), the gateway believes
 * nothing the process says that isn't in the protocol, and the lifecycle
 * heals: timeouts, crashes, idle, concurrent calls.
 *
 * Every folder has a space in its name, as on many Windows and macOS homes.
 */
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { APP_LIMITS, ConchAppManifest } from '@conch/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createRuntime,
  HOST_SCRIPT,
  inputProblem,
  sealedArgs,
  sealedEnv,
  sweepTemp,
  type SealedRuntime,
} from './runtime';
import type { AppFetcher } from './types';

const running: SealedRuntime[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.stop()));
});

let root = '';
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'conch runtime ')));
});

const manifestFor = (extra: Record<string, unknown> = {}) =>
  ConchAppManifest.parse({
    conch: 1,
    id: 'plant-diary',
    name: 'Plant diary',
    tagline: 'Keeps track of watering',
    version: '1.0.0',
    icon: { glyph: 'leaf', color: 'green' },
    tools: 'tools.mjs',
    reaches: ['api.example.com'],
    ...extra,
  });

let count = 0;
async function makeApp(tools: string, extra: Record<string, string> = {}) {
  const base = join(root, `app ${++count}`);
  const appDir = join(base, 'plant diary');
  const dataDir = join(base, 'app data');
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, 'tools.mjs'), tools);
  for (const [path, text] of Object.entries(extra)) {
    await mkdir(join(appDir, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(appDir, ...path.split('/')), text);
  }
  return { base, appDir, dataDir };
}

const noFetch: AppFetcher = async () => ({
  ok: false,
  status: 0,
  headers: {},
  body: '',
  refused: 'No fetching in this test.',
});

function start(
  app: { appDir: string; dataDir: string },
  options: Partial<Parameters<typeof createRuntime>[0]> = {},
) {
  const runtime = createRuntime({
    appDir: app.appDir,
    dataDir: app.dataDir,
    manifest: manifestFor(),
    settings: async () => ({ city: 'Lisbon', apiKey: 'sk-test-SECRET-123' }),
    fetcher: noFetch,
    ...options,
  });
  running.push(runtime);
  return runtime;
}

const tool = (name: string, run: string, extra = '') =>
  `${name}: { title: 'T', description: 'Does a thing. Use when asked.', input: { type: 'object' }, ${extra} async run(input, app) { ${run} } },`;

async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting.');
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ── The fence, from the app's side ────────────────────────────────────────

const DENIED_MODULES = [
  'net',
  'tls',
  'http',
  'https',
  'http2',
  'dgram',
  'dns',
  'dns/promises',
  'child_process',
  'cluster',
  'worker_threads',
  'inspector',
  'inspector/promises',
  'module',
  'vm',
  'wasi',
  'repl',
  'v8',
  'trace_events',
  'diagnostics_channel',
  'fs',
  'fs/promises',
  'os',
  'process',
  'async_hooks',
  'perf_hooks',
  'stream',
  'path',
];

describe('the fence: every way out an app might try is refused', () => {
  let tcp: Server;
  let connections = 0;
  let port = 0;
  let outside = '';
  let app: Awaited<ReturnType<typeof makeApp>>;
  let runtime: SealedRuntime;

  beforeAll(async () => {
    tcp = createServer((socket) => {
      connections++;
      socket.destroy();
    });
    await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
    port = (tcp.address() as { port: number }).port;
    outside = join(root, 'outside secret.mjs');
    await writeFile(outside, 'export const secret = "the gateway’s";\n');
    await writeFile(join(root, 'outside.json'), '{"secret":1}');
    // Each attempt returns "ESCAPED" if it worked; a refusal throws, and the tool's error is the refusal.
    app = await makeApp(
      `
const attempts = {
  ...Object.fromEntries(${JSON.stringify(DENIED_MODULES)}.flatMap((m) => [
    ['import ' + m, () => import(m)],
    ['import node:' + m, () => import('node:' + m)],
    ['getBuiltinModule ' + m, () => process.getBuiltinModule(m)],
    ['getBuiltinModule node:' + m, () => process.getBuiltinModule('node:' + m)],
  ])),
  'import node:sqlite': () => import('node:sqlite'),
  'import node:test': () => import('node:test'),
  'import a package': () => import('undici'),
  'import a data: URL': () => import('data:text/javascript,export default globalThis'),
  'import an absolute file: URL outside': (i) => import(i.outside),
  'import an absolute file: URL inside': () => import(new URL('./helper.mjs', import.meta.url).href),
  'import ../ out of the folder': () => import('../../outside secret.mjs'),
  'import JSON out of the folder': () => import('../../outside.json', { with: { type: 'json' } }),
  'import over https': () => import('https://example.com/x.mjs'),
  'import.meta.resolve a builtin': () => import.meta.resolve('node:net'),
  'require': () => require('node:fs'),
  'fetch': () => fetch('http://127.0.0.1:' + 'PORT'),
  'fetch with a Request': () => fetch(new Request('http://127.0.0.1:PORT')),
  'console’s stderr socket': () => new (console._stderr.constructor)().connect(PORT, '127.0.0.1'),
  'console’s stdout': () => console._stdout.write('x'),
  'a new Console': () => new console.Console({ write() {} }),
  'undici’s own dispatcher': () => globalThis[Symbol.for('undici.globalDispatcher.2')].request({ origin: 'http://127.0.0.1:PORT', path: '/', method: 'GET' }),
  'undici’s dispatcher after Response loads': () => { new Response('x'); return globalThis[Symbol.for('undici.globalDispatcher.2')].dispatch({ origin: 'http://127.0.0.1:PORT', path: '/', method: 'GET' }, {}); },
  'a stack frame’s function': (i, app) => {
    let leaked = [];
    Error.prepareStackTrace = (e, frames) => {
      leaked = frames.map((f) => f.getFunction() ?? f.getThis()).filter((x) => x !== undefined && x !== globalThis);
      return '';
    };
    try { app.data.get('not a key!'); } catch {}
    const e = new Error('x');
    void e.stack;
    Error.prepareStackTrace = undefined;
    if (leaked.length) return leaked.map(String).join(';');
    throw new Error('No frame gave anything away.');
  },
  'undici dispatcher': () => globalThis[Symbol.for('undici.globalDispatcher.1')].dispatch({ origin: 'http://127.0.0.1:PORT', path: '/', method: 'GET' }, {}),
  'replace the dispatcher': () => { globalThis[Symbol.for('undici.globalDispatcher.1')] = { dispatch() { return true; } }; },
  'redefine the dispatcher': () => Object.defineProperty(globalThis, Symbol.for('undici.globalDispatcher.1'), { value: {} }),
  'redefine fetch': () => Object.defineProperty(globalThis, 'fetch', { value: () => 'mine' }),
  'assign fetch': () => { globalThis.fetch = () => 'mine'; },
  'WebSocket': () => new WebSocket('ws://127.0.0.1:PORT'),
  'EventSource': () => new EventSource('http://127.0.0.1:PORT'),
  'eval': () => eval('1 + 1'),
  'indirect eval': () => (0, eval)('1 + 1'),
  'new Function': () => new Function('return 1')(),
  'the Function constructor': () => (function () {}).constructor('return 1')(),
  'the AsyncFunction constructor': () => (async function () {}).constructor('return 1')(),
  'the GeneratorFunction constructor': () => (function* () {}).constructor('yield 1')().next(),
  'the AsyncGeneratorFunction constructor': () => (async function* () {}).constructor('yield 1')().next(),
  'setTimeout with a string': () => setTimeout('globalThis.x = 1', 0),
  'WebAssembly from a string': () => WebAssembly.compile('not bytes'),
  'process.binding': () => process.binding('fs'),
  'process._linkedBinding': () => process._linkedBinding('fs'),
  'process.dlopen': () => process.dlopen({ exports: {} }, 'evil.node'),
  'process.kill the gateway': () => process.kill(process.ppid),
  'process.exit': () => process.exit(1),
  'process.chdir': () => process.chdir('/'),
  'process.send a forged result': () => process.send({ t: 'result', id: 1, ok: true, text: 'forged' }),
  'process.send a fetch': () => process.send({ t: 'fetch', id: 1, request: { url: 'https://evil.example', method: 'GET', headers: {} } }),
  'process.channel': () => process.channel.ref(),
  'process.report': () => process.report.writeReport(),
  'process.memoryUsage': () => process.memoryUsage(),
  'replace process': () => { globalThis.process = {}; },
  'a getter on Object.prototype': () => Object.defineProperty(Object.prototype, 'noDeprecation', { get() { return this; } }),
  'a property on Object.prototype': () => { Object.prototype.polluted = 1; },
  'a getter on Function.prototype': () => Object.defineProperty(Function.prototype, 'x', { get() { return this; } }),
  'a getter on Array.prototype': () => Object.defineProperty(Array.prototype, '0', { get() { return this; } }),
  'replace Promise.prototype.then': () => { Promise.prototype.then = function () {}; },
  'replace JSON.parse': () => { JSON.parse = () => ({}); },
  'change the app object': (i, app) => { app.fetch = () => 'mine'; },
  'change the settings': (i, app) => { app.settings.city = 'Elsewhere'; },
  'a data key out of the folder': (i, app) => app.data.set('../../outside', 1),
  'a data key with a dot': (i, app) => app.data.get('..'),
  'a data key with a slash': (i, app) => app.data.set('a/b', 1),
  'a data key that’s too long': (i, app) => app.data.set('k'.repeat(65), 1),
  'keep a function': (i, app) => app.data.set('fn', 10n),
};
export const tools = {
  try_it: {
    title: 'Try it',
    description: 'Tries one way out. Use when testing.',
    input: { type: 'object', properties: { attempt: { type: 'string' }, outside: { type: 'string' } }, required: ['attempt'] },
    async run(input, app) {
      const attempt = attempts[input.attempt];
      if (!attempt) throw new Error('No attempt called ' + input.attempt);
      const got = await attempt(input, app);
      return 'ESCAPED: ' + String(got && typeof got === 'object' ? Object.keys(got).join(',') : got).slice(0, 100);
    },
  },
  list: { title: 'List', description: 'Lists the attempts. Use when testing.', input: { type: 'object' }, run: () => Object.keys(attempts) },
  sweep: {
    title: 'Sweep',
    description: 'Looks through everything reachable. Use when testing.',
    input: { type: 'object' },
    run(input, app) {
      const seen = new Set();
      const found = [];
      const visit = (value, path, depth) => {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
        if (seen.has(value)) return;
        seen.add(value);
        let name = '';
        try { name = String(value.constructor && value.constructor.name); } catch {}
        if (/Socket|Pipe|^TCP|UDP|Handle|Server|ChildProcess|^Worker$|Agent|Dispatcher|Client|Pool|^Console$/.test(name)) found.push(path + ' is a ' + name);
        try { if (typeof value.kill === 'function' && typeof value.binding === 'function' && value.pid > 0) found.push(path + ' is the real process'); } catch {}
        if (depth >= 5) return;
        let keys = [];
        try { keys = Reflect.ownKeys(value); } catch {}
        for (const k of keys) {
          let v;
          try { const d = Object.getOwnPropertyDescriptor(value, k); v = d && ('value' in d ? d.value : d.get ? d.get.call(value) : undefined); } catch { continue; }
          visit(v, path + '.' + String(k), depth + 1);
        }
        try { visit(Object.getPrototypeOf(value), path + '.__proto__', depth + 1); } catch {}
      };
      new Response('x');
      visit(globalThis, 'globalThis', 0);
      visit(app, 'app', 0);
      visit(setTimeout(() => {}, 1), 'a timeout', 0);
      visit(setImmediate(() => {}), 'an immediate', 0);
      visit(new Request('https://x.example'), 'a request', 0);
      visit(new MessageChannel(), 'a channel', 0);
      return found;
    },
  },
  look: {
    title: 'Look',
    description: 'Says what the app can see. Use when testing.',
    input: { type: 'object' },
    run: (input, app) => ({
      env: Object.keys(process.env),
      argv: process.argv,
      settings: app.settings,
      frozen: Object.isFrozen(app.settings) && Object.isFrozen(Object.prototype),
      fetchType: typeof fetch,
      webSocket: typeof WebSocket,
      cwd: process.cwd(),
      pid: process.pid,
    }),
  },
};
`.replaceAll('PORT', '__PORT__'),
      { 'helper.mjs': 'export const helper = 1;\n' },
    );
    // The port goes in after the template above is written, so it's a plain number in the code.
    const path = join(app.appDir, 'tools.mjs');
    await writeFile(path, (await readFile(path, 'utf8')).replaceAll('__PORT__', String(port)));
    runtime = start(app);
  });

  afterAll(async () => {
    await runtime.stop();
    await new Promise<void>((r) => tcp.close(() => r()));
  });

  it('refuses every attempt, in words, and nothing reaches the network', async () => {
    const list = await runtime.call('list', {});
    const names = list.json as string[];
    expect(names.length).toBeGreaterThan(100);
    const escaped: string[] = [];
    for (const attempt of names) {
      const got = await runtime.call('try_it', { attempt, outside: pathToFileURL(outside).href });
      if (got.ok || /ESCAPED/.test(got.text)) escaped.push(`${attempt}: ${got.text}`);
      expect(got.text, attempt).not.toMatch(/the gateway’s/);
    }
    expect(escaped).toEqual([]);
    expect(connections).toBe(0);
    // Still the same process: nothing above brought it down.
    expect(runtime.running).toBe(true);
  }, 60_000);

  it('leaves nothing in reach that holds a socket, a handle, a process or a dispatcher', async () => {
    const swept = await runtime.call('sweep', {});
    expect(swept.ok).toBe(true);
    expect(swept.json).toEqual([]);
  });

  it('says why, in words a model can act on', async () => {
    const why = async (attempt: string) =>
      (await runtime.call('try_it', { attempt, outside: pathToFileURL(outside).href })).text;
    expect(await why('import node:net')).toBe(
      'Conch apps can’t use Node’s “net” module: use app.fetch to reach the web.',
    );
    expect(await why('getBuiltinModule fs')).toBe(
      'Conch apps can’t use Node’s “fs” module: use app.data to keep things.',
    );
    expect(await why('import child_process')).toMatch(/can’t use Node’s “child_process” module/);
    expect(await why('fetch')).toBe(
      'Use app.fetch: Conch makes web requests for apps, to the sites they reach.',
    );
    expect(await why('undici dispatcher')).toMatch(/^Use app\.fetch/);
    expect(await why('import a data: URL')).toMatch(/only imports the app’s own files/);
    expect(await why('import an absolute file: URL outside')).toMatch(
      /only imports the app’s own files/,
    );
    expect(await why('import ../ out of the folder')).toMatch(/outside the app’s folder/);
    expect(await why('import a package')).toMatch(/can’t import packages/);
    expect(await why('eval')).toMatch(/Code generation from strings disallowed/);
    expect(await why('process.kill the gateway')).toBe('Conch apps can’t use process.kill.');
    expect(await why('process.send a forged result')).toBe('Conch apps can’t use process.send.');
    expect(await why('a data key out of the folder')).toMatch(/can’t be a key/);
    expect(await why('keep a function')).toMatch(/Only JSON can be kept/);
    // Error messages never say where the app is on this computer.
    for (const attempt of ['import ../ out of the folder', 'import JSON out of the folder'])
      expect(await why(attempt)).not.toContain(app.appDir);
  });

  it('shows the app no environment, no arguments, and settings it can’t change', async () => {
    const seen = (await runtime.call('look', {})).json as Record<string, unknown>;
    expect(seen).toMatchObject({
      env: [],
      argv: [],
      settings: { city: 'Lisbon', apiKey: 'sk-test-SECRET-123' },
      frozen: true,
      fetchType: 'function',
      webSocket: 'undefined',
      cwd: '/',
      pid: 0,
    });
  });
});

// ── The permission model itself, with a stand-in runtime that has all of Node ──

/** What a stand-in runtime needs to speak the wire: lines of JSON in on stdin, out on fd 3. */
const WIRE = `
import { Socket } from 'node:net';
const wire = new Socket({ fd: 3, readable: false, writable: true });
const send = (m) => wire.write(JSON.stringify(m) + '\\n');
const raw = (text) => wire.write(text);
const handlers = [];
const onMessage = (f) => handlers.push(f);
let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buffered += c;
  let i;
  while ((i = buffered.indexOf('\\n')) >= 0) {
    const line = buffered.slice(0, i);
    buffered = buffered.slice(i + 1);
    for (const f of handlers) f(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
`;

const PROBE = `${WIRE}
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const results = {};
const t = async (name, f) => {
  try { await f(); results[name] = 'allowed'; }
  catch (e) { results[name] = e.code || e.message; }
};
onMessage(async (m) => {
  if (m.t !== 'init') return;
  await t('read its own folder', () => readFile(join(m.appDir, 'tools.mjs')));
  await t('read outside its folder', () => readFile(m.settings.outside));
  await t('read beside the runtime', () => readFile(m.settings.beside));
  await t('write to its own folder', () => writeFile(join(m.appDir, 'new.mjs'), 'x'));
  await t('write outside', () => writeFile(m.settings.outsideWrite, 'x'));
  await t('write to its data', () => writeFile(join(m.dataDir, 'x.json'), '1'));
  await t('run a program', () => { const r = spawnSync(process.execPath, ['-v']); if (r.error) throw r.error; });
  await t('start a worker', async () => { const { Worker } = await import('node:worker_threads'); new Worker('1', { eval: true }); });
  await t('process.binding', () => process.binding('fs'));
  await t('load an addon', () => process.dlopen({ exports: {} }, m.settings.outside));
  await t('WASI', async () => { const { WASI } = await import('node:wasi'); new WASI({ version: 'preview1' }); });
  await t('the inspector', async () => { const inspector = await import('node:inspector'); inspector.open(0); });
  await t('eval', () => eval('1'));
  const seen = JSON.stringify({ env: process.env, argv: process.argv, execArgv: process.execArgv });
  results.leaks = seen.includes(m.settings.apiKey) || seen.includes('CONCH_TEST_GATEWAY_SECRET')
    || seen.includes('gateway-only') || seen.includes(':0x4D2:0x162E');
  // Windows needs SYSTEMROOT. CoreFoundation may add its encoding cache on macOS
  // even with env: {} (Apple CFStringEncodings.c, _CFStringGetUserDefaultEncoding).
  // The parent sentinel verifies that its value was not inherited.
  const systemKey = (k) =>
    (process.platform === 'win32' && k.toUpperCase() === 'SYSTEMROOT') ||
    (process.platform === 'darwin' && k === '__CF_USER_TEXT_ENCODING');
  results.env = Object.entries(process.env).filter(([k, v]) => v && !systemKey(k)).map(([k]) => k);
  results.flags = process.execArgv;
  send({ t: 'ready', tools: [{ name: 'probe', title: null, description: JSON.stringify(results), input: null, changes: null, runs: true }] });
});
`;

describe('the permission model holds, whatever the code in the process', () => {
  it('reads only its folder and the runtime, writes only its data, runs nothing, and inherits no gateway environment', async () => {
    vi.stubEnv('CONCH_TEST_GATEWAY_SECRET', 'gateway-only');
    // A valid triple for this UID survives if inherited. macOS replaces
    // malformed values itself, which would conceal a leak in this check.
    vi.stubEnv(
      '__CF_USER_TEXT_ENCODING',
      `0x${process.getuid?.().toString(16) ?? '0'}:0x4D2:0x162E`,
    );
    try {
      const app = await makeApp('export const tools = {};\n');
      const runtimeDir = join(app.base, 'the runtime');
      await mkdir(runtimeDir);
      await writeFile(join(runtimeDir, 'probe host.mjs'), PROBE);
      await writeFile(join(runtimeDir, 'beside.txt'), 'gateway file');
      const outside = join(app.base, 'secret.txt');
      await writeFile(outside, 'secret');
      const runtime = start(app, {
        hostScript: join(runtimeDir, 'probe host.mjs'),
        settings: async () => ({
          outside,
          beside: join(runtimeDir, 'beside.txt'),
          outsideWrite: join(app.base, 'written.txt'),
          apiKey: 'sk-test-SECRET-123',
        }),
      });
      const [probe] = await runtime.definitions();
      const results = JSON.parse(probe?.description ?? '{}') as Record<string, unknown>;
      expect(results).toMatchObject({
        'read its own folder': 'allowed',
        'read outside its folder': 'ERR_ACCESS_DENIED',
        'read beside the runtime': 'ERR_ACCESS_DENIED',
        'write to its own folder': 'ERR_ACCESS_DENIED',
        'write outside': 'ERR_ACCESS_DENIED',
        'write to its data': 'allowed',
        'run a program': 'ERR_ACCESS_DENIED',
        'start a worker': 'ERR_ACCESS_DENIED',
        'process.binding': 'ERR_ACCESS_DENIED',
        'load an addon': 'ERR_DLOPEN_DISABLED',
        WASI: 'ERR_ACCESS_DENIED',
        'the inspector': 'ERR_ACCESS_DENIED',
        eval: 'Code generation from strings disallowed for this context',
        leaks: false,
        env: [],
      });
      expect(sealedEnv('linux')).toEqual({});
      expect(sealedEnv('darwin')).toEqual({});
      expect(results.flags).toEqual(
        expect.arrayContaining(['--permission', '--disallow-code-generation-from-strings']),
      );
      expect(await readdir(app.appDir)).toEqual(['tools.mjs']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts Node with the permission model and nothing more allowed', () => {
    const args = sealedArgs({
      host: 'C:\\Program Files\\Conch\\host.mjs',
      appDir: 'C:\\Users\\Ada Lovelace\\.conch\\conch-apps\\plant-diary',
      dataDir: 'C:\\Users\\Ada Lovelace\\.conch\\conch-app-data\\plant-diary',
    });
    expect(args).toEqual([
      '--permission',
      '--allow-fs-read=C:\\Program Files\\Conch\\host.mjs',
      '--allow-fs-read=C:\\Users\\Ada Lovelace\\.conch\\conch-apps\\plant-diary',
      '--allow-fs-read=C:\\Users\\Ada Lovelace\\.conch\\conch-app-data\\plant-diary',
      '--allow-fs-write=C:\\Users\\Ada Lovelace\\.conch\\conch-app-data\\plant-diary',
      '--disallow-code-generation-from-strings',
      '--max-old-space-size=256',
      'C:\\Program Files\\Conch\\host.mjs',
    ]);
    for (const flag of [
      '--allow-child-process',
      '--allow-worker',
      '--allow-addons',
      '--allow-wasi',
      '--allow-inspector',
      '--allow-net',
    ])
      expect(args.join(' ')).not.toContain(flag);
  });
});

// ── What the process may say ──────────────────────────────────────────────

const ROGUE = `${WIRE}
let mode;
onMessage((m) => {
  if (m.t === 'init') {
    mode = m.settings.mode;
    send({ t: 'ready', tools: [{ name: 'go', title: 'Go', description: 'Goes.', input: { type: 'object' }, changes: null, runs: true }] });
  }
  if (m.t === 'call') {
    if (mode === 'not json') return raw('rm -rf /\\n');
    if (mode === 'endless') {
      // A result that never ends: half a gigabyte, if nobody stopped it.
      raw('{"t":"result","id":' + m.id + ',"ok":true,"text":"');
      const chunk = 'x'.repeat(1024 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 512) {
          sent++;
          if (!wire.write(chunk)) return wire.once('drain', pump);
        }
      };
      return pump();
    }
    const said = {
      text: 'just some words',
      number: 42,
      list: [1, 2, 3],
      unknown: { t: 'run-this', command: 'rm -rf /' },
      'bad id': { t: 'result', id: 'one', ok: true, text: 'forged' },
      'bad fetch': { t: 'fetch', id: 1, request: { url: 5 } },
      'too much': { t: 'result', id: m.id, ok: true, text: 'x'.repeat(3 * 1024 * 1024) },
    }[mode];
    send(said);
  }
});
`;

describe('the gateway believes only the protocol', () => {
  it.each(['text', 'number', 'list', 'unknown', 'bad id', 'bad fetch', 'not json', 'too much'])(
    'stops a process that says something else (%s), and the call fails in words',
    async (mode) => {
      const app = await makeApp('export const tools = {};\n');
      const script = join(app.base, 'rogue host.mjs');
      await writeFile(script, ROGUE);
      const fetcher = vi.fn(noFetch);
      const runtime = start(app, { hostScript: script, settings: async () => ({ mode }), fetcher });
      expect(await runtime.list()).toHaveLength(1);
      const got = await runtime.call('go', {});
      expect(got.ok).toBe(false);
      expect(got.text).toMatch(
        /Plant diary’s tools (stopped while working|sent back more than Conch takes)/,
      );
      expect(fetcher).not.toHaveBeenCalled();
      await until(() => !runtime.running);
    },
  );

  it('stops a process the moment a message runs past the cap, without reading the rest', async () => {
    const app = await makeApp('export const tools = {};\n');
    const script = join(app.base, 'rogue host.mjs');
    await writeFile(script, ROGUE);
    const runtime = start(app, { hostScript: script, settings: async () => ({ mode: 'endless' }) });
    await runtime.list();
    const before = process.memoryUsage().arrayBuffers;
    const started = Date.now();
    expect(await runtime.call('go', {})).toEqual({
      ok: false,
      text: 'Plant diary’s tools sent back more than Conch takes, so it stopped them. Return less at once.',
    });
    // Cut off at about 2 MB, long before half a gigabyte arrived.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(64 * 1024 * 1024);
    await until(() => !runtime.running);
  });
});

// ── The tools module contract ─────────────────────────────────────────────

describe('running an app’s tools', () => {
  it('lists its tools, validated, and runs them with text, JSON or “Done.”', async () => {
    const app = await makeApp(
      `
import { twice } from './lib/twice.mjs';
export const tools = {
  ${tool('say', 'return `Hello, ${input.name}.`', 'changes: false,')}
  ${tool('numbers', 'return { twice: twice(input.n), list: [1, 2] };')}
  ${tool('nothing', 'return undefined;', 'changes: true,')}
};`,
      { 'lib/twice.mjs': 'export const twice = (n) => n * 2;\n' },
    );
    const runtime = start(app);
    const listed = await runtime.list();
    // Each carries its input schema, so every model is told what to send.
    expect(listed.every((t) => typeof t.input === 'object')).toBe(true);
    expect(listed.map(({ input: _input, ...rest }) => rest)).toEqual([
      { name: 'say', title: 'T', description: 'Does a thing. Use when asked.', changes: false },
      { name: 'numbers', title: 'T', description: 'Does a thing. Use when asked.', changes: false },
      { name: 'nothing', title: 'T', description: 'Does a thing. Use when asked.', changes: true },
    ]);
    expect(await runtime.call('say', { name: 'Ada' })).toEqual({ ok: true, text: 'Hello, Ada.' });
    expect(await runtime.call('numbers', { n: 21 })).toEqual({
      ok: true,
      text: JSON.stringify({ twice: 42, list: [1, 2] }, null, 2),
      json: { twice: 42, list: [1, 2] },
    });
    expect(await runtime.call('nothing', {})).toEqual({ ok: true, text: 'Done.' });
    expect(await runtime.call('missing', {})).toEqual({
      ok: false,
      text: 'Plant diary has no tool called “missing”. Its tools are: say, numbers, nothing.',
    });
  });

  it('gives the model a thrown error’s message, cut to 2,000 characters, and carries on', async () => {
    const app = await makeApp(`
class Wrong extends Error { constructor(m) { super(m); this.name = 'Wrong'; } }
export const tools = {
  ${tool('fail', 'throw new Wrong("That plant isn’t in the diary. Call list_plants first.");')}
  ${tool('long', 'throw new Error("x".repeat(5000));')}
  ${tool('odd', 'throw "a string";')}
  ${tool('fine', 'return "still here";')}
};`);
    const runtime = start(app);
    expect(await runtime.call('fail', {})).toEqual({
      ok: false,
      text: 'That plant isn’t in the diary. Call list_plants first.',
    });
    expect((await runtime.call('long', {})).text.length).toBe(2000);
    expect(await runtime.call('odd', {})).toEqual({ ok: false, text: 'a string' });
    expect(await runtime.call('fine', {})).toEqual({ ok: true, text: 'still here' });
  });

  it('checks the input against the tool’s schema before the tool sees it', async () => {
    const app = await makeApp(`
export const tools = {
  water: {
    title: 'Water', description: 'Logs watering. Use when asked.',
    input: {
      type: 'object',
      properties: {
        plant: { type: 'string', minLength: 1, maxLength: 20 },
        litres: { type: 'number', minimum: 0, maximum: 5 },
        how: { enum: ['can', 'hose'] },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      },
      required: ['plant'],
      additionalProperties: false,
    },
    run: (input) => 'ran with ' + JSON.stringify(input),
  },
};`);
    const runtime = start(app);
    const fix = ' Check the tool’s input and call it again.';
    expect(await runtime.call('water', {})).toEqual({ ok: false, text: `Missing “plant”.${fix}` });
    expect((await runtime.call('water', { plant: 3 })).text).toBe(`“plant” must be text.${fix}`);
    expect((await runtime.call('water', { plant: '' })).text).toMatch(/at least 1 characters/);
    expect((await runtime.call('water', { plant: 'f', litres: 9 })).text).toMatch(
      /“litres” must be at most 5/,
    );
    expect((await runtime.call('water', { plant: 'f', how: 'bucket' })).text).toMatch(
      /“how” must be one of: "can", "hose"/,
    );
    expect((await runtime.call('water', { plant: 'f', tags: ['a', 2] })).text).toMatch(
      /“tags\[1\]” must be text/,
    );
    expect((await runtime.call('water', { plant: 'f', colour: 'red' })).text).toMatch(
      /“colour” isn’t something this tool takes/,
    );
    expect(await runtime.call('water', { plant: 'fern', litres: 1.5, how: 'can' })).toMatchObject({
      ok: true,
    });
  });

  it('runs calls side by side, each answered by its own id', async () => {
    const app = await makeApp(`
export const tools = {
  ${tool('wait', 'await new Promise((r) => setTimeout(r, input.ms)); return String(input.ms);')}
};`);
    const runtime = start(app);
    const answers = await Promise.all([300, 50, 150, 10].map((ms) => runtime.call('wait', { ms })));
    expect(answers.map((a) => a.text)).toEqual(['300', '50', '150', '10']);
  });

  it('runs a .js tools module as a module, never as CommonJS', async () => {
    const app = await makeApp('');
    await writeFile(
      join(app.appDir, 'tools.js'),
      `export const tools = { ${tool('cjs', 'return typeof require + " " + typeof module;')} };`,
    );
    const runtime = start(app, { manifest: manifestFor({ tools: 'tools.js' }) });
    expect(await runtime.call('cjs', {})).toEqual({ ok: true, text: 'undefined undefined' });
  });

  it('cuts an answer that’s too long for the model', async () => {
    const app = await makeApp(
      `export const tools = { ${tool('long', 'return "y".repeat(300000);')} };`,
    );
    const got = await start(app).call('long', {});
    expect(got.ok).toBe(true);
    expect(got.text.length).toBeLessThanOrEqual(100_000);
  });

  it('starts nothing for an app with no tools', async () => {
    const app = await makeApp('');
    const runtime = start(app, { manifest: manifestFor({ tools: undefined }) });
    expect(await runtime.list()).toEqual([]);
    expect(runtime.running).toBe(false);
    expect(await runtime.call('x', {})).toEqual({ ok: false, text: 'Plant diary has no tools.' });
  });
});

describe('a module that doesn’t load says why, plainly', () => {
  it('names a tool whose name is far too long, instead of failing to start', async () => {
    const app = await makeApp(
      `export const tools = { ${'x'.repeat(300)}: { title: 'T', description: 'D', input: { type: 'object' }, run() {} } };`,
    );
    await expect(start(app).list()).rejects.toThrow(/The tool “x{40}” doesn’t fit: its name/);
  });

  it.each<[string, string, RegExp]>([
    [
      'a syntax error',
      'export const tools = {',
      /^tools\.mjs didn’t load: .*(Unexpected end of input|SyntaxError)/,
    ],
    [
      'no tools',
      'export const nothing = 1;',
      /doesn’t export its tools: add export const tools = \{ … \}\./,
    ],
    [
      'a throw while loading',
      'throw new Error("No API key yet.");',
      /didn’t load: No API key yet\./,
    ],
    [
      'an import of Node',
      'import fs from "node:fs"; export const tools = {};',
      /can’t use Node’s “fs” module/,
    ],
    [
      'a missing file',
      'import { x } from "./nowhere.mjs"; export const tools = {};',
      /didn’t load: .*nowhere\.mjs/,
    ],
  ])('%s', async (_, code, message) => {
    const app = await makeApp(code);
    const runtime = start(app);
    const error = await runtime.list().catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain(app.appDir);
    expect((error as Error).message).not.toContain(pathToFileURL(app.appDir).href);
  });

  it('names a tool that doesn’t fit, and still shows it as written', async () => {
    const app = await makeApp(`export const tools = {
      LogWatering: { title: 'Log', description: 'Logs. Use when asked.', input: { type: 'object' }, run() {} },
      no_run: { title: 'No run', description: 'Has none.', input: { type: 'object' } },
    };`);
    const runtime = start(app);
    await expect(runtime.list()).rejects.toThrow(/The tool “LogWatering” doesn’t fit: its name/);
    expect(await runtime.definitions()).toEqual([
      {
        name: 'LogWatering',
        title: 'Log',
        description: 'Logs. Use when asked.',
        input: { type: 'object' },
        changes: null,
        runs: true,
      },
      {
        name: 'no_run',
        title: 'No run',
        description: 'Has none.',
        input: { type: 'object' },
        changes: null,
        runs: false,
      },
    ]);
  });
});

// ── What a tool can reach ─────────────────────────────────────────────────

describe('app.data', () => {
  it('keeps JSON, one file per key, atomically, and across restarts', async () => {
    const app = await makeApp(`
export const tools = {
  ${tool('keep', 'await app.data.set(input.key, input.value); return app.data.keys();')}
  ${tool('read', 'const v = await app.data.get(input.key); return { v: v === undefined ? "nothing" : v };')}
  ${tool('drop', 'await app.data.delete(input.key); return app.data.keys();')}
  ${tool('bump', 'return String(await app.data.update("n", (n) => (n ?? 0) + 1));')}
};`);
    const runtime = start(app);
    expect((await runtime.call('keep', { key: 'log', value: [{ plant: 'fern' }] })).json).toEqual([
      'log',
    ]);
    expect((await runtime.call('keep', { key: 'note-1', value: 'hi' })).json).toEqual([
      'log',
      'note-1',
    ]);
    expect((await runtime.call('read', { key: 'log' })).json).toEqual({ v: [{ plant: 'fern' }] });
    expect(JSON.parse(await readFile(join(app.dataDir, 'log.json'), 'utf8'))).toEqual([
      { plant: 'fern' },
    ]);
    // Writes one at a time per key: thirty at once all count.
    await Promise.all(Array.from({ length: 30 }, () => runtime.call('bump', {})));
    expect((await runtime.call('read', { key: 'n' })).json).toEqual({ v: 30 });
    expect((await runtime.call('drop', { key: 'note-1' })).json).toEqual(['log', 'n']);
    await runtime.stop();
    expect((await runtime.call('read', { key: 'log' })).json).toEqual({ v: [{ plant: 'fern' }] });
    expect((await readdir(app.dataDir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect((await runtime.call('read', { key: 'never' })).json).toEqual({ v: 'nothing' });
  });

  it('stops at the data folder’s cap, and says what to do', async () => {
    const app = await makeApp(`export const tools = {
      ${tool('fill', 'await app.data.set(input.key, "z".repeat(input.n)); return "kept";')}
    };`);
    const runtime = start(app, { dataLimit: 10_000 });
    expect((await runtime.call('fill', { key: 'a', n: 6000 })).text).toBe('kept');
    expect(await runtime.call('fill', { key: 'b', n: 6000 })).toEqual({
      ok: false,
      text: 'The app’s data is full (0 MB). Delete what it no longer needs, then try again.',
    });
    // Replacing a key counts only the new value.
    expect((await runtime.call('fill', { key: 'a', n: 9000 })).text).toBe('kept');
  });

  it('clears the temp files of a process stopped mid-write, so they never get past the cap', async () => {
    const app = await makeApp(`export const tools = {
      ${tool('start_big', 'void app.data.set("big", "z".repeat(input.n)).catch(() => {}); return "started";')}
      ${tool('fill', 'await app.data.set(input.key, "z".repeat(input.n)); return "kept";')}
    };`);
    const runtime = start(app, { dataLimit: 40 * 1024 * 1024 });
    // Stopped while it writes 30 MB: whatever it left half-written is a temp file.
    expect((await runtime.call('start_big', { n: 30 * 1024 * 1024 })).text).toBe('started');
    await runtime.stop();
    // And one from an earlier run, as a crash would leave it.
    await writeFile(join(app.dataDir, '.log.0badc0de.tmp'), 'z'.repeat(1024 * 1024));
    expect((await runtime.call('fill', { key: 'small', n: 10 })).text).toBe('kept');
    expect((await readdir(app.dataDir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    await runtime.stop();
    await writeFile(join(app.dataDir, '.x.1.tmp'), 'leftover');
    await sweepTemp(app.dataDir);
    expect((await readdir(app.dataDir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('holds the cap when several keys are written at once', async () => {
    const app = await makeApp(`export const tools = {
      ${tool('both', 'const r = await Promise.allSettled([app.data.set("a", "z".repeat(6000)), app.data.set("b", "z".repeat(6000)), app.data.set("c", "z".repeat(6000))]); return r.map((x) => x.status);')}
    };`);
    const got = (await start(app, { dataLimit: 10_000 }).call('both', {})).json as string[];
    expect(got.filter((s) => s === 'fulfilled')).toHaveLength(1);
    expect(got.filter((s) => s === 'rejected')).toHaveLength(2);
  });

  it('says so when what’s kept is damaged', async () => {
    const app = await makeApp(
      `export const tools = { ${tool('read', 'return app.data.get("log");')} };`,
    );
    await mkdir(app.dataDir, { recursive: true });
    await writeFile(join(app.dataDir, 'log.json'), '{ broken');
    expect((await start(app).call('read', {})).text).toBe(
      'What’s kept under “log” is damaged. Set it again, or delete it.',
    );
  });
});

describe('app.fetch', () => {
  it('asks the gateway, for this app and its reaches, and reads the answer', async () => {
    const fetcher = vi.fn<AppFetcher>(async (_app, request) => ({
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ echoed: request.body, method: request.method, h: request.headers }),
    }));
    const app = await makeApp(`
export const tools = {
  ${tool(
    'get',
    `
    const r = await app.fetch('https://api.example.com/weather?city=' + app.settings.city, {
      method: 'POST', headers: { 'X-Key': app.settings.apiKey }, body: JSON.stringify({ a: 1 }),
    });
    return { ok: r.ok, status: r.status, type: r.headers.get('Content-Type'), json: await r.json() };`,
  )}
  ${tool(
    'bytes',
    `
    const r = await app.fetch('https://api.example.com/pic', { method: 'PUT', body: new Uint8Array([0, 255]) });
    return [...new Uint8Array(await r.arrayBuffer())];`,
  )}
};`);
    const runtime = start(app, { fetcher });
    expect((await runtime.call('get', {})).json).toEqual({
      ok: true,
      status: 200,
      type: 'application/json',
      json: { echoed: '{"a":1}', method: 'POST', h: { 'x-key': 'sk-test-SECRET-123' } },
    });
    expect(fetcher).toHaveBeenCalledWith(
      { id: 'plant-diary', reaches: ['api.example.com'] },
      expect.objectContaining({
        url: 'https://api.example.com/weather?city=Lisbon',
        method: 'POST',
      }),
      expect.any(AbortSignal),
    );
    fetcher.mockImplementationOnce(async (_app, request) => ({
      ok: true,
      status: 200,
      headers: {},
      body: request.body ?? '',
      bodyBase64: true,
    }));
    expect((await runtime.call('bytes', {})).json).toEqual([0, 255]);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      bodyBase64: true,
      body: Buffer.from([0, 255]).toString('base64'),
    });
  });

  it('throws the gateway’s sentence when it refuses', async () => {
    const app = await makeApp(`export const tools = {
      ${tool('get', 'await app.fetch("https://elsewhere.example/x"); return "fetched";')}
    };`);
    const runtime = start(app, {
      fetcher: async () => ({
        ok: false,
        status: 0,
        headers: {},
        body: '',
        refused: 'This app may only reach api.example.com, not elsewhere.example.',
      }),
    });
    expect(await runtime.call('get', {})).toEqual({
      ok: false,
      text: 'This app may only reach api.example.com, not elsewhere.example.',
    });
  });

  it('works only while one of its tools is running, never in the background', async () => {
    const fetcher = vi.fn(noFetch);
    const app = await makeApp(`export const tools = {
      ${tool('later', 'setTimeout(async () => { try { await app.fetch("https://api.example.com/x"); await app.data.set("later", "fetched"); } catch (e) { await app.data.set("later", e.message); } }, 100); return "scheduled";')}
      ${tool('peek', 'return app.data.get("later");')}
    };`);
    const runtime = start(app, { fetcher });
    expect((await runtime.call('later', {})).text).toBe('scheduled');
    await new Promise((r) => setTimeout(r, 600));
    expect((await runtime.call('peek', {})).text).toBe(
      'app.fetch only works while one of the app’s tools is running.',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ── Lifecycle ─────────────────────────────────────────────────────────────

describe('the process’s life', () => {
  it('stops a call that runs too long, says so, and starts afresh next time (not a crash)', async () => {
    const heal = vi.fn();
    const app = await makeApp(`export const tools = {
      ${tool('spin', 'while (true) {}')}
      ${tool('fine', 'return "fine";')}
    };`);
    const runtime = start(app, { callMs: 1500, heal });
    expect(await runtime.call('spin', {})).toEqual({
      ok: false,
      text: '“spin” took longer than 2 seconds, so Conch stopped it. Try again with less to do at once.',
    });
    await until(() => !runtime.running);
    expect(await runtime.call('fine', {})).toEqual({ ok: true, text: 'fine' });
    expect(heal).not.toHaveBeenCalled();
  });

  it('fails a call in words when the process crashes, starts again next time, and notes it once', async () => {
    const heal = vi.fn();
    const app = await makeApp(`export const tools = {
      ${tool('crash', 'setTimeout(() => { throw new Error("boom"); }, 10); await new Promise(() => {});')}
      ${tool('fine', 'return "fine";')}
      ${tool('slow', 'await new Promise((r) => setTimeout(r, 5000)); return "late";')}
    };`);
    const runtime = start(app, { heal });
    await runtime.list();
    // A call still running on the same process fails too.
    const [crashed, other] = await Promise.all([
      runtime.call('crash', {}),
      runtime.call('slow', {}),
    ]);
    expect(crashed).toEqual({
      ok: false,
      text: 'Plant diary’s tools stopped while working (they crashed). Try again: Conch starts them afresh.',
    });
    expect(other).toEqual(crashed);
    expect(runtime.log).toMatch(/boom/);
    expect(await runtime.call('fine', {})).toEqual({ ok: true, text: 'fine' });
    expect(await runtime.call('fine', {})).toEqual({ ok: true, text: 'fine' });
    expect(heal).toHaveBeenCalledTimes(1);
    expect(heal).toHaveBeenCalledWith(
      'Plant diary’s tools stopped unexpectedly, so Conch started them again.',
    );
  });

  it('stops after a while with nothing to do, and on stop()', async () => {
    const app = await makeApp(`export const tools = { ${tool('fine', 'return "fine";')} };`);
    const runtime = start(app, { idleMs: 200 });
    await runtime.call('fine', {});
    expect(runtime.running).toBe(true);
    await until(() => !runtime.running);
    await runtime.call('fine', {});
    expect(runtime.running).toBe(true);
    await runtime.stop();
    expect(runtime.running).toBe(false);
  });

  it('stops waiting when the call is stopped', async () => {
    const app = await makeApp(
      `export const tools = { ${tool('slow', 'await new Promise((r) => setTimeout(r, 5000)); return "late";')} };`,
    );
    const runtime = start(app);
    await runtime.list();
    const controller = new AbortController();
    const pending = runtime.call('slow', {}, controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ ok: false, text: 'Stopped.' });
    const early = new AbortController();
    early.abort();
    expect(await runtime.call('slow', {}, early.signal)).toEqual({
      ok: false,
      text: 'Stopped before it started.',
    });
  });

  it('logs what the app writes with app.log', async () => {
    const app = await makeApp(
      `export const tools = { ${tool('note', 'app.log("watered", { plant: "fern" }); return app.now();')} };`,
    );
    const runtime = start(app);
    const got = await runtime.call('note', {});
    expect(got.text).toMatch(/^\d{4}-\d\d-\d\dT/);
    await until(() => runtime.log.includes('watered'));
    expect(runtime.log).toContain("watered { plant: 'fern' }");
  });
});

describe('checking input', () => {
  it('handles the schema shapes the contract names', () => {
    expect(inputProblem({ type: 'object' }, {})).toBeUndefined();
    expect(inputProblem(null, { anything: 1 })).toBeUndefined();
    expect(inputProblem({ type: 'integer' }, 1.5)).toBe('The input must be a whole number.');
    expect(inputProblem({ type: ['string', 'null'] }, null)).toBeUndefined();
    expect(inputProblem({ type: 'number' }, 3)).toBeUndefined();
    expect(inputProblem({ type: 'array', minItems: 1 }, [])).toBe(
      'The input needs at least 1 items.',
    );
    expect(
      inputProblem(
        {
          type: 'object',
          properties: {
            a: { type: 'object', properties: { b: { type: 'boolean' } }, required: ['b'] },
          },
        },
        { a: {} },
      ),
    ).toBe('Missing “a.b”.');
  });
});

describe('shipping the runtime', () => {
  it('finds host.mjs beside runtime.ts, as every way of running Conch has it', async () => {
    expect(HOST_SCRIPT.replaceAll('\\', '/')).toMatch(/src\/conchapps\/runtime\/host\.mjs$/);
    expect((await readFile(HOST_SCRIPT, 'utf8')).length).toBeGreaterThan(1000);
    expect(APP_LIMITS.callMs).toBe(30_000);
  });
});

describe('cacheable queries', () => {
  it('lists cache declarations and refuses durable data writes, including overlapping calls', async () => {
    const app = await makeApp(`export const tools = {
      ${tool('query', "await new Promise(r => setTimeout(r, 25)); await app.data.set('notes', [1]);", 'cache: { maxAge: 60 }, changes: false,')}
      ${tool('write', "await app.data.set('notes', [2]); return await app.data.get('notes');", 'changes: true,')}
    };`);
    const runtime = start(app);
    expect(await runtime.list()).toContainEqual(
      expect.objectContaining({ name: 'query', cache: { maxAge: 60 } }),
    );
    const results = await Promise.all([runtime.call('query', {}), runtime.call('write', {})]);
    expect(results[0]).toMatchObject({
      ok: false,
      text: expect.stringContaining('cannot write app.data'),
    });
    expect(results[1]).toMatchObject({ ok: true, json: [2] });
  });
});
