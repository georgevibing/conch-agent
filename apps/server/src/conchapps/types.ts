/**
 * The seams between the parts of Conch apps (ADR 0061), so each part can be
 * built and tested alone: the package (what's in a folder or an archive), the
 * sealed runtime, the quality bar, where packages come from, and sharing.
 */
import type {
  AppCheckItem,
  ConchAppCheck,
  ConchAppManifest,
  ConchAppTool,
  PublishState,
  SkillSignature,
} from '@conch/protocol';

// ── The package ─────────────────────────────────────────────────────────────

/** An app's files, by path inside its folder (`/`-separated), as bytes. */
export type AppFiles = ReadonlyMap<string, Buffer>;

/** A package that read: its manifest, its files and their fingerprint. */
export interface AppPackage {
  manifest: ConchAppManifest;
  files: AppFiles;
  /** SHA-256 over every path and its bytes, `conch-app.sig` left out (`appHash`). */
  hash: string;
}

/** Reading a package either gives one, or says what's wrong in words. */
export type PackageRead = { ok: true; app: AppPackage } | { ok: false; problems: AppCheckItem[] };

// ── The sealed runtime ──────────────────────────────────────────────────────

/** A request an app's tool asks Conch to make for it (`app.fetch`). */
export interface AppFetchRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers: Record<string, string>;
  /** Text or base64 (`bodyBase64`), at most `APP_LIMITS.fetchOut`. */
  body?: string;
  bodyBase64?: boolean;
}

export interface AppFetchResponse {
  /** Final address after validated redirects. */
  url?: string;
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  /** The answer as text, or base64 when it isn't text. */
  body: string;
  bodyBase64?: boolean;
  /** Set when Conch refused or failed it: one sentence the tool can pass on. */
  refused?: string;
}

/** Makes `app.fetch` requests, only to `reaches`, through the SSRF guard. */
export type AppFetcher = (
  app: { id: string; reaches: readonly string[] },
  request: AppFetchRequest,
  signal: AbortSignal,
) => Promise<AppFetchResponse>;

/** What a tool call gives back to the model. */
export interface AppCallOutcome {
  ok: boolean;
  /** Text for the model: the tool's answer, or what went wrong in words. */
  text: string;
  /** When the tool returned JSON. */
  json?: unknown;
}

/**
 * A tool exactly as the module defined it, before it's held to the
 * protocol's shape: what the quality bar reads to say what's wrong with it.
 */
export interface AppToolDefinition {
  name: string;
  title: string | null;
  description: string | null;
  /** Its input schema, as JSON (`'unreadable'` when it isn't JSON). */
  input: unknown;
  /** `null` when the module didn't say. */
  changes: boolean | null;
  cache?: unknown;
  /** It has a `run` function. */
  runs: boolean;
}

/** One app's tools, running sealed off in a Node process of their own. */
export interface AppRuntime {
  /** The tools the module exports, as the runtime read them (starts it if needed). */
  list(): Promise<ConchAppTool[]>;
  /** The tools as the module defined them, unchecked (starts it if needed). */
  definitions?(): Promise<AppToolDefinition[]>;
  call(tool: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<AppCallOutcome>;
  /** Whether a process is running now. */
  readonly running: boolean;
  stop(): Promise<void>;
}

export interface RuntimeOptions {
  /** The app's folder: read-only to it. */
  appDir: string;
  /** Its data folder: the only place it writes. */
  dataDir: string;
  manifest: ConchAppManifest;
  /** Every setting's value, secrets included: handed over at start, never in env or argv. */
  settings: () => Promise<Record<string, string>>;
  fetcher: AppFetcher;
  /** A quiet "fixed on its own" sentence (a crash it recovered from). */
  heal?: (message: string) => void;
  /** Stop after this long unused (default ten minutes). */
  idleMs?: number;
}

// ── The quality bar ─────────────────────────────────────────────────────────

export interface CheckOptions {
  /** Runs the tools module sealed off, to list its tools. */
  runtime: (app: AppPackage) => AppRuntime;
  /** Tools that `app_try` ran without throwing, for this exact hash. */
  tried?: readonly string[];
  /** Only the safety half: for a package someone else made (no `tried` needed). */
  safetyOnly?: boolean;
  /** The vault's redactor (`VaultService.redactor()`): a file it would change holds a secret. */
  redact?: (text: string) => string;
  now?: () => number;
}

export type CheckApp = (files: AppFiles, options: CheckOptions) => Promise<ConchAppCheck>;

// ── Signatures ──────────────────────────────────────────────────────────────

export type VerifyApp = (app: AppPackage, home: string) => Promise<SkillSignature>;

// ── Where packages come from ────────────────────────────────────────────────

/** What a link points at, once read. */
export interface FetchedPackage {
  /** A `.conchapp` or GitHub's tar.gz, as downloaded (at most `APP_LIMITS.download`). */
  archive: Buffer;
  /** A folder inside the archive to look in, for a link to one. */
  path?: string;
  source:
    | {
        kind: 'github';
        owner: string;
        repo: string;
        path?: string;
        ref?: string;
        commit?: string;
        url: string;
      }
    | { kind: 'link'; url: string };
}

export interface CommunityRepo {
  owner: string;
  repo: string;
  description: string;
  stars: number;
  updatedAt?: number;
  url: string;
}

export interface AppSources {
  /** A GitHub repository (or a folder, a tag, a release in one), or an https `.conchapp`. */
  fetch(link: string, signal?: AbortSignal): Promise<FetchedPackage>;
  /** Repositories with the topic `conch-app`. */
  search(query: string): Promise<{ repos: CommunityRepo[]; limited: boolean; offline: boolean }>;
  /** The newest version available where an app came from, without downloading it. */
  latest(source: {
    owner: string;
    repo: string;
    ref?: string;
  }): Promise<{ ref: string; commit?: string } | undefined>;
}

/** A link a person or the assistant gave that isn't one Conch can read. */
export class SourceError extends Error {
  constructor(
    readonly code: 'not-a-link' | 'not-found' | 'too-big' | 'refused' | 'limited' | 'offline',
    message: string,
  ) {
    super(message);
  }
}

// ── Sharing ─────────────────────────────────────────────────────────────────

/** Publishing on GitHub through GitHub's own program (`gh`). */
export interface Publisher {
  /** Where publishing this app stands now. */
  state(appId: string): PublishState;
  /**
   * Start or carry on: finds `gh` (or says what to install), signs in with
   * GitHub's device flow, then makes or updates the repository from `dir`.
   */
  publish(app: {
    id: string;
    dir: string;
    manifest: ConchAppManifest;
    /** Its tools as the runtime listed them, for the README it writes when the app has none. */
    tools?: readonly ConchAppTool[];
  }): Promise<PublishState>;
}
