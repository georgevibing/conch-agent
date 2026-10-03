/**
 * The parts of Conch apps that `ConchAppService` uses but doesn't make
 * (ADR 0061): reading packages, the sealed runtime, the quality bar,
 * signatures, where packages come from, and publishing. Each is built and
 * tested on its own against `types.ts`; this is the one place they're
 * joined, so the service and its tests run with fakes.
 */
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
}

const notWired = (part: string): never => {
  throw new Error(`Not wired yet: ${part}`);
};

/**
 * The real parts. Each throws until it's joined here, so a Conch without
 * them still starts: apps you have show as broken, and making one says so.
 */
export function conchAppParts(context: PartsContext): ConchAppParts {
  void context;
  return {
    readFiles: async () => notWired('readFiles'),
    readFolder: async () => notWired('readFolder'),
    appHash: () => notWired('appHash'),
    packApp: async () => notWired('packApp'),
    findApps: async () => notWired('findApps'),
    checkApp: async () => notWired('checkApp'),
    signApp: async () => notWired('signApp'),
    verifyApp: async () => notWired('verifyApp'),
    runtime: () => notWired('createRuntime'),
    fetcher: async () => notWired('createFetcher'),
    sources: {
      fetch: async () => notWired('sources.fetch'),
      search: async () => notWired('sources.search'),
      latest: async () => notWired('sources.latest'),
    },
    publisher: {
      state: () => notWired('publisher.state'),
      publish: async () => notWired('publisher.publish'),
    },
  };
}
