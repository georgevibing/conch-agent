/**
 * Stand-ins for the parts of Conch apps (ADR 0061) that other parts of the
 * gateway make: the package reader, the quality bar, signatures, the sealed
 * runtime, sources and publishing. Good enough to run an app for real in a
 * test — its tools module is imported and run in this process, which only a
 * test may do — and honest about what they don't do (no seal, no network).
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type AppCheckItem,
  ConchAppManifest,
  type ConchAppTool,
  type PublishState,
  type SkillSignature,
} from '@conch/protocol';

import type { ConchAppParts } from '../conchapps/deps';
import type {
  AppCallOutcome,
  AppFetchRequest,
  AppFiles,
  AppPackage,
  AppRuntime,
  CommunityRepo,
  FetchedPackage,
  PackageRead,
  RuntimeOptions,
} from '../conchapps/types';

const SIG = 'conch-app.sig';

export function fakeHash(files: AppFiles): string {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].filter((p) => p !== SIG).sort()) {
    hash.update(path);
    hash.update('\0');
    hash.update(files.get(path) ?? Buffer.alloc(0));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function fakeRead(files: AppFiles): Promise<PackageRead> {
  const raw = files.get('conch-app.json');
  if (!raw) return { ok: false, problems: [{ message: 'There’s no conch-app.json.' }] };
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    return {
      ok: false,
      problems: [{ message: 'conch-app.json isn’t JSON.', file: 'conch-app.json' }],
    };
  }
  const manifest = ConchAppManifest.safeParse(json);
  if (!manifest.success)
    return {
      ok: false,
      problems: [
        {
          message: manifest.error.issues[0]?.message ?? 'It doesn’t read.',
          file: 'conch-app.json',
        },
      ],
    };
  return { ok: true, app: { manifest: manifest.data, files, hash: fakeHash(files) } };
}

/** Every file under a folder, by `/` path. */
export async function filesIn(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const visit = async (at: string, rel: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(at, entry.name), path);
      else if (entry.isFile()) out.set(path, await readFile(join(at, entry.name)));
    }
  };
  await visit(dir, '');
  return out;
}

/** A pretend archive: JSON of every path and its bytes. */
export const fakePack = (files: AppFiles) =>
  Buffer.from(
    JSON.stringify(Object.fromEntries([...files].map(([p, b]) => [p, b.toString('base64')]))),
  );

export function unpack(archive: Buffer): Map<string, Buffer> {
  const json = JSON.parse(archive.toString('utf8')) as Record<string, string>;
  return new Map(Object.entries(json).map(([p, b]) => [p, Buffer.from(b, 'base64')]));
}

/** Files from text. */
export const textFiles = (files: Record<string, string>): Map<string, Buffer> =>
  new Map(Object.entries(files).map(([p, t]) => [p, Buffer.from(t, 'utf8')]));

/** A signature the fakes understand: who, and the hash it was made over. */
export function fakeSign(files: AppFiles, who: { fingerprint: string; publisher: string }) {
  const out = new Map(files);
  out.set(SIG, Buffer.from(JSON.stringify({ ...who, hash: fakeHash(files) })));
  return out;
}

interface ToolDef {
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  changes?: boolean;
  run: (input: Record<string, unknown>, app: unknown) => Promise<unknown>;
}

export interface FakeOptions {
  /** Runtimes that fail to start. */
  failing?: Set<string>;
  links?: Map<string, FetchedPackage>;
  repos?: CommunityRepo[];
  latest?: Map<string, { ref: string; commit?: string }>;
  signer?: { fingerprint: string; publisher: string };
}

export interface FakeParts extends ConchAppParts {
  calls: { app: string; tool: string; input: Record<string, unknown> }[];
  fetches: AppFetchRequest[];
  started: string[];
  options: FakeOptions;
  published: Map<string, PublishState>;
}

/** The parts of Conch apps, pretended well enough to run a real app's tools. */
export function fakeParts(options: FakeOptions = {}): FakeParts {
  const calls: FakeParts['calls'] = [];
  const fetches: AppFetchRequest[] = [];
  const started: string[] = [];
  const published = new Map<string, PublishState>();

  const runtime = (o: RuntimeOptions): AppRuntime => {
    let tools: Record<string, ToolDef> | undefined;
    let running = false;
    const dataFile = join(o.dataDir, 'data.json');
    const data = async () =>
      JSON.parse(await readFile(dataFile, 'utf8').catch(() => '{}')) as Record<string, unknown>;
    const save = async (all: Record<string, unknown>) => {
      await mkdir(o.dataDir, { recursive: true });
      await writeFile(dataFile, JSON.stringify(all));
    };
    const load = async () => {
      if (tools) return tools;
      if (options.failing?.has(o.manifest.id)) throw new Error('The tools module didn’t load');
      if (!o.manifest.tools) return (tools = {});
      const code = await readFile(join(o.appDir, ...o.manifest.tools.split('/')), 'utf8');
      const mod = (await import(
        `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
      )) as { tools?: Record<string, ToolDef> };
      tools = mod.tools ?? {};
      running = true;
      started.push(o.manifest.id);
      return tools;
    };
    const settings = o.settings;
    return {
      get running() {
        return running;
      },
      async list(): Promise<ConchAppTool[]> {
        return Object.entries(await load()).map(([name, t]) => ({
          name,
          title: t.title ?? name,
          description: t.description ?? '',
          changes: t.changes === true,
          ...(t.input && { input: t.input }),
        }));
      },
      async call(tool, input): Promise<AppCallOutcome> {
        const def = (await load())[tool];
        if (!def) return { ok: false, text: `There’s no tool called ${tool}.` };
        calls.push({ app: o.manifest.id, tool, input });
        const app = {
          data: {
            get: async (k: string) => (await data())[k],
            set: async (k: string, v: unknown) => save({ ...(await data()), [k]: v }),
            update: async (k: string, fn: (v: unknown) => unknown) => {
              const all = await data();
              await save({ ...all, [k]: fn(all[k]) });
            },
            delete: async (k: string) =>
              save(Object.fromEntries(Object.entries(await data()).filter(([key]) => key !== k))),
            keys: async () => Object.keys(await data()),
          },
          settings: await settings(),
          now: () => Date.now(),
          log: () => undefined,
          fetch: async (url: string) => {
            const request: AppFetchRequest = { url, method: 'GET', headers: {} };
            fetches.push(request);
            return o.fetcher(
              { id: o.manifest.id, reaches: o.manifest.reaches },
              request,
              new AbortController().signal,
            );
          },
        };
        try {
          const result = await def.run(input, app);
          return typeof result === 'string'
            ? { ok: true, text: result }
            : { ok: true, text: JSON.stringify(result), json: result };
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : 'It failed.' };
        }
      },
      async stop() {
        running = false;
      },
    };
  };

  const parts: FakeParts = {
    calls,
    fetches,
    started,
    options,
    published,
    readFiles: fakeRead,
    readFolder: async (dir) => fakeRead(await filesIn(dir).catch(() => new Map<string, Buffer>())),
    appHash: fakeHash,
    packApp: async (files) => fakePack(files),
    async findApps(archive, find) {
      const all = unpack(archive);
      const base = find?.path ? `${find.path.replace(/\/+$/, '')}/` : '';
      const roots = [...all.keys()]
        .filter((p) => p.startsWith(base) && p.endsWith('conch-app.json'))
        .map((p) => p.slice(0, -'conch-app.json'.length))
        .filter((root) => root.split('/').length <= 4);
      return Promise.all(
        roots.map((root) =>
          fakeRead(
            new Map(
              [...all]
                .filter(([p]) => p.startsWith(root))
                .map(([p, b]) => [p.slice(root.length), b] as const),
            ),
          ),
        ),
      );
    },
    async checkApp(files, check) {
      const read = await fakeRead(files);
      if (!read.ok)
        return {
          ok: false,
          hash: fakeHash(files),
          at: Date.now(),
          problems: read.problems,
          warnings: [],
          tools: [],
          tried: [],
        };
      const problems: AppCheckItem[] = [];
      let tools: ConchAppTool[] = [];
      try {
        tools = await check.runtime(read.app).list();
      } catch (error) {
        problems.push({ message: `The tools module didn’t load: ${(error as Error).message}` });
      }
      for (const tool of tools)
        if (!tool.description) problems.push({ message: `${tool.name} has no description.` });
      for (const [path, bytes] of files)
        if (bytes.toString('utf8').includes('BROKEN'))
          problems.push({ message: 'Something here is broken on purpose.', file: path });
      const tried = (check.tried ?? []).filter((t) => tools.some((x) => x.name === t));
      const untried = tools.filter((t) => !tried.includes(t.name));
      return {
        ok: !problems.length && (check.safetyOnly === true || !untried.length),
        hash: read.app.hash,
        at: Date.now(),
        problems,
        warnings: [],
        tools,
        tried,
      };
    },
    async signApp(app: AppPackage) {
      return fakeSign(app.files, options.signer ?? { fingerprint: 'AAAA 1111', publisher: 'Ada' });
    },
    async verifyApp(app): Promise<SkillSignature> {
      const sig = app.files.get(SIG);
      if (!sig) return { state: 'unsigned' };
      const parsed = JSON.parse(sig.toString('utf8')) as {
        fingerprint: string;
        publisher: string;
        hash: string;
      };
      if (parsed.hash !== app.hash)
        return { state: 'invalid', problem: 'What’s in it isn’t what was signed' };
      return { state: 'untrusted', fingerprint: parsed.fingerprint, publisher: parsed.publisher };
    },
    runtime,
    fetcher: async (_app, request) => ({
      ok: true,
      status: 200,
      headers: {},
      body: `fetched ${request.url}`,
    }),
    sources: {
      async fetch(link) {
        const found = options.links?.get(link);
        if (!found) throw new Error(`No pretend package at ${link}`);
        return found;
      },
      async search() {
        return { repos: options.repos ?? [], limited: false, offline: false };
      },
      async latest(source) {
        return options.latest?.get(`${source.owner}/${source.repo}`);
      },
    },
    publisher: {
      state: (id) => published.get(id) ?? { state: 'idle' },
      async publish(app) {
        const state: PublishState = {
          state: 'published',
          url: `https://github.com/ada/${app.id}`,
          version: app.manifest.version,
        };
        published.set(app.id, state);
        return state;
      },
    },
  };
  return parts;
}
