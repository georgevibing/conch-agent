/**
 * The parts of Conch apps that `ConchAppService` uses but doesn't make
 * (ADR 0061): reading packages, the sealed runtime, the quality bar,
 * signatures, where packages come from, and publishing. Each is built and
 * tested on its own against `types.ts`; this is the one place they're
 * joined, so the service and its tests run with fakes.
 */
import { SERVER_VERSION } from '../version';
import type { SkillTrust } from '../skills/trust';
import { checkApp } from './check';
import { createFetcher } from './fetcher';
import { appHash, findApps, packApp, readFiles, readFolder, SIGNATURE_FILE } from './package';
import { join } from 'node:path';

import { Mutex, readJson, writeJson } from '../lib/fs';
import { createPretendPublisher } from './pretend';
import { createPublisher, type PublishedRepos } from './publish';
import { createRuntime } from './runtime';
import { signApp, verifyAppWith } from './sign';
import { createSources } from './sources';
import type {
  AppFetcher,
  AppFiles,
  AppPackage,
  AppRuntime,
  AppSources,
  CheckApp,
  PackageRead,
  Publisher,
  RuntimeOptions,
  VerifyApp,
} from './types';

export interface ConchAppParts {
  /** An app's files, as bytes, read as a package: the manifest checked and the hash made. */
  readFiles(files: AppFiles): Promise<PackageRead>;
  /** A folder on disk read as a package: regular files only, under the limits. */
  readFolder(dir: string): Promise<PackageRead>;
  /** SHA-256 over every path and its bytes, `conch-app.sig` left out. */
  appHash(files: AppFiles): string;
  /** A `.conchapp` (tar.gz) of these files. */
  packApp(files: AppFiles): Promise<Buffer>;
  /** Every app in an archive (the root, or up to three folders down), each read or not. */
  findApps(archive: Buffer, options?: { path?: string }): Promise<PackageRead[]>;
  checkApp: CheckApp;
  /** The same files with `conch-app.sig` written by the person's signing key. */
  signApp(app: AppPackage, home: string): Promise<AppFiles>;
  verifyApp: VerifyApp;
  /** One app's tools, sealed off in a process of their own (`createRuntime`). */
  runtime(options: RuntimeOptions): AppRuntime;
  /** `app.fetch`, through the SSRF guard, only to `reaches` (`createFetcher`). */
  fetcher: AppFetcher;
  sources: AppSources;
  publisher: Publisher;
}

export interface PartsContext {
  home: string;
  /** A quiet "fixed on its own" sentence. */
  heal: (message: string) => void;
  /** The gateway's own port, which `app.fetch` must never reach. */
  gatewayPort: number;
  /** Whose signatures you trust, and your signing key (shared, so one lock guards it). */
  trust: () => SkillTrust;
  /** The vault's redactor: nothing secret may be written into an app. */
  redact: () => (text: string) => string;
  /** The mock engine: publishing pretends, and never runs `gh` with this machine's sign-in. */
  pretend?: boolean;
}

/**
 * The GitHub repositories each app was published to, by GitHub's own id
 * (`conch-apps-published.json`): publishing again only ever updates that one.
 */
/** One lock per file, however many readers there are. */
const locks = new Map<string, Mutex>();

export function publishedRepos(home: string): PublishedRepos {
  const path = join(home, 'conch-apps-published.json');
  const lock = locks.get(path) ?? new Mutex();
  locks.set(path, lock);
  const read = async (): Promise<Record<string, { repoId: number }>> =>
    (await readJson<Record<string, { repoId: number }>>(path).catch(() => undefined)) ?? {};
  return {
    get: async (appId) => {
      const all = await read();
      const found = Object.hasOwn(all, appId) ? all[appId] : undefined;
      return found && Number.isSafeInteger(found.repoId) ? { repoId: found.repoId } : undefined;
    },
    set: (appId, repoId) =>
      lock.run(async () => {
        const all = await read();
        await writeJson(path, { ...all, [appId]: { repoId } });
      }),
  };
}

/** The real parts, joined: each was built and tested alone against `types.ts`. */
export function conchAppParts(context: PartsContext): ConchAppParts {
  // One fetcher for every app: the hourly limit lives in it.
  const fetcher = createFetcher({ gatewayPort: context.gatewayPort });
  return {
    readFiles: async (files) => readFiles(files),
    readFolder,
    appHash,
    packApp: async (files) => {
      const read = readFiles(files);
      if (!read.ok) throw new Error(read.problems[0]?.message ?? 'This app doesn’t read.');
      // The signature travels with the files, though the hash leaves it out.
      return packApp({ ...read.app, files });
    },
    findApps: async (archive, options) => (await findApps(archive, options)).map((f) => f.read),
    checkApp: (files, options) => checkApp(files, { redact: context.redact(), ...options }),
    signApp: async (app, home) => {
      const sig = await signApp(app, home, { trust: context.trust() });
      return new Map([...app.files, [SIGNATURE_FILE, sig]]);
    },
    verifyApp: (app) => verifyAppWith(app, context.trust()),
    runtime: (options) => createRuntime({ ...options, heal: options.heal ?? context.heal }),
    fetcher,
    sources: createSources({ version: SERVER_VERSION }),
    publisher: context.pretend
      ? createPretendPublisher()
      : createPublisher({
          home: context.home,
          redact: (text) => context.redact()(text),
          published: publishedRepos(context.home),
        }),
  };
}
