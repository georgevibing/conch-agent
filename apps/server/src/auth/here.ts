/**
 * "This computer", proven rather than guessed from the address (ADR 0063).
 *
 * A request is from this computer when it looks local *and* carries proof
 * that only your account on this computer can have: a cookie made with a key
 * in a file only you can read (`here/key`). A browser gets it with a one-time
 * code, handed over through a private file that sends the browser on — never
 * on a command line, where other accounts can read it.
 *
 * The key never leaves its file, and nothing secret goes over the network to
 * ask for a code: whatever listens on Conch's port while Conch is stopped
 * would get it. Launchers ask through a folder only your account can write
 * (`here/asks`), and Conch answers there (`answer`).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { watch as watchFolder, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { writeFileAtomic } from '../lib/fs';
import { hashToken, randomToken, safeEqual } from './secrets';

export const hereDir = (home: string) => join(home, 'here');
export const hereKeyFile = (home: string) => join(hereDir(home), 'key');
const openDir = (home: string) => join(hereDir(home), 'open');
/** Where launchers ask for a link, and find the answer (only your account can write here). */
export const hereAsksDir = (home: string) => join(hereDir(home), 'asks');
const ASK = /^([0-9a-f]{16,64})\.ask$/;
/** The name of a private page Conch writes; launchers open nothing else. */
export const OPEN_FILE = /^conch-open-[0-9a-f]{24}\.html$/;

/** The cookie carries the port: cookies aren't kept apart by port (RFC 6265bis). */
export const hereCookieName = (port: number) => `conch_here_${port}`;
/** Browsers keep a cookie 400 days at most (RFC 6265bis); so does Conch. */
export const HERE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
export const HERE_CODE_TTL_MS = 2 * 60_000;
const MAX_CODES = 32;
/** How often the key file is looked at again, for `pnpm conch reset` in another process. */
const RECHECK_MS = 1_000;

const KEY = /^[A-Za-z0-9_-]{43}$/;
const COOKIE = /^v1\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const FILE_PREFIX = 'conch-open-';

/** A page of this Conch to open: a path on this origin, nothing that leaves it. */
export function safePage(page: string | undefined): string | undefined {
  if (page === undefined) return '/';
  if (page.length > 512) return undefined;
  return /^\/(?![/\\])[^\s\\#]*$/.test(page) ? page : undefined;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/** The private file a launcher opens: it sends the browser on to Conch, with the code. */
export function trampolineHtml(url: string): string {
  const to = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=${to}">
<title>Opening Conch…</title>
<body style="font: 16px system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; padding: 0 1rem">
<p>Opening Conch… <a href="${to}">Open it</a> if nothing happens.</p>
<p style="color: #666">This page works once, and only on this computer.</p>
</body>
</html>
`;
}

export interface ThisComputerDeps {
  /** Say what was fixed, quietly (Settings → Health → Fixed on its own). */
  heal?: (message: string) => void;
  now?: () => number;
  /**
   * A folder the default browser may read, when it can't read Conch's own
   * (a snap or a Flatpak can't see hidden folders in your home).
   */
  browserHome?: () => Promise<string | undefined>;
}

interface Waiting {
  expiresAt: number;
  /** The private file that opens the link (first), and the answers to an ask: gone with the code. */
  files: string[];
}

export class ThisComputer {
  #key = '';
  #checkedAt = Number.NEGATIVE_INFINITY;
  /** Waiting one-time codes, by their hash. */
  readonly #codes = new Map<string, Waiting>();
  readonly #now: () => number;

  constructor(
    readonly home: string,
    private readonly deps: ThisComputerDeps = {},
  ) {
    this.#now = deps.now ?? Date.now;
  }

  /** The key, made the first time and healed when it's wrong. */
  key(): string {
    const now = this.#now();
    if (this.#key && now - this.#checkedAt < RECHECK_MS) return this.#key;
    this.#checkedAt = now;
    const file = hereKeyFile(this.home);
    let stat;
    try {
      stat = statSync(file);
    } catch {
      return this.#make();
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      chmodSync(file, 0o600);
      this.deps.heal?.('Made this computer’s key private again');
    }
    const text = readFileSync(file, 'utf8').trim();
    if (!KEY.test(text)) {
      this.deps.heal?.(
        'Made a new key for this computer. Open Conch from your apps to use it here again.',
      );
      return this.#make();
    }
    this.#key = text;
    return text;
  }

  /**
   * How the key file is, without changing it (Repair everything looks first):
   * `readable` when other accounts could read it.
   */
  inspect(): 'ok' | 'missing' | 'damaged' | 'readable' {
    const file = hereKeyFile(this.home);
    let mode: number;
    try {
      mode = statSync(file).mode;
    } catch {
      return 'missing';
    }
    try {
      if (!KEY.test(readFileSync(file, 'utf8').trim())) return 'damaged';
    } catch {
      return 'damaged';
    }
    return process.platform !== 'win32' && (mode & 0o077) !== 0 ? 'readable' : 'ok';
  }

  /** Look at the key file now, not when it's next due, and heal what's wrong (Repair everything). */
  heal(): void {
    this.#checkedAt = Number.NEGATIVE_INFINITY;
    this.key();
  }

  /** A new key: every browser on this computer is opened from Conch once more. */
  rotate(): void {
    this.#codes.clear();
    this.#make();
  }

  #make(): string {
    const dir = hereDir(this.home);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(dir, 0o700);
    const file = hereKeyFile(this.home);
    const key = randomToken(32);
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, `${key}\n`, { mode: 0o600 });
    try {
      renameSync(tmp, file);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
    this.#key = key;
    this.#checkedAt = this.#now();
    return key;
  }

  #mac(payload: string): string {
    return createHmac('sha256', this.key()).update(payload, 'utf8').digest('base64url');
  }

  /** A new cookie value for a browser on this computer. */
  cookie(): string {
    const payload = `v1.${this.#now().toString(36)}.${randomToken(16)}`;
    return `${payload}.${this.#mac(payload)}`;
  }

  checkCookie(value: string | undefined): boolean {
    const match = value ? COOKIE.exec(value) : null;
    if (!match) return false;
    const issued = Number.parseInt(match[1] ?? '', 36);
    const age = this.#now() - issued;
    if (!Number.isFinite(issued) || age < -60_000 || age > HERE_COOKIE_MAX_AGE_S * 1000)
      return false;
    const payload = `v1.${match[1]}.${match[2]}`;
    return safeEqual(match[3] ?? '', this.#mac(payload));
  }

  /**
   * A one-time code that opens `page` and makes the browser "this computer".
   * With `file`, also the private file a launcher opens instead of the address.
   */
  async link(options: {
    port: number;
    page?: string;
    file?: boolean;
  }): Promise<{ code: string; url: string; file?: string }> {
    const page = safePage(options.page) ?? '/';
    this.#drop();
    while (this.#codes.size >= MAX_CODES) {
      const oldest = this.#codes.keys().next().value;
      if (oldest === undefined) break;
      this.#forget(oldest);
    }
    const code = randomToken(32);
    const url = `http://localhost:${options.port}${page}#here=${code}`;
    const waiting: Waiting = { expiresAt: this.#now() + HERE_CODE_TTL_MS, files: [] };
    let file: string | undefined;
    if (options.file) {
      const dir = (await this.deps.browserHome?.().catch(() => undefined)) ?? openDir(this.home);
      file = join(dir, `${FILE_PREFIX}${randomBytes(12).toString('hex')}.html`);
      await writeFileAtomic(file, trampolineHtml(url), 0o600);
      waiting.files.push(file);
    }
    this.#codes.set(hashToken(code), waiting);
    return { code, url, ...(file && { file }) };
  }

  /** Use a code: true once, for a code that is waiting and in time. */
  redeem(code: string): boolean {
    if (!KEY.test(code)) return false;
    const id = hashToken(code);
    const waiting = this.#codes.get(id);
    if (!waiting) return false;
    this.#forget(id);
    return waiting.expiresAt > this.#now();
  }

  #forget(id: string) {
    const files = this.#codes.get(id)?.files ?? [];
    this.#codes.delete(id);
    for (const file of files) rmSync(file, { force: true });
  }

  #drop() {
    const now = this.#now();
    for (const [id, waiting] of this.#codes) if (waiting.expiresAt <= now) this.#forget(id);
  }

  /** Forget codes that ran out, and their files. */
  async sweep(): Promise<void> {
    this.#drop();
  }

  /**
   * Answer what launchers asked for (`here/asks`). A launcher leaves
   * `<id>.ask` holding the page it wants; Conch writes back `<id>.link` (the
   * address with a one-time code) and, last, `<id>.open` (the private file
   * that opens it), so a launcher that sees `.open` finds both. Only your
   * account can write in that folder, so whatever is in it was asked by you.
   */
  async answer(port: number): Promise<number> {
    const dir = hereAsksDir(this.home);
    let answered = 0;
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const id = ASK.exec(name)?.[1];
      if (!id) continue;
      const asked = join(dir, name);
      let page: string | undefined;
      try {
        page = safePage((await readFile(asked, 'utf8')).trim().slice(0, 512));
      } catch {
        continue;
      }
      await rm(asked, { force: true });
      const made = await this.link({ port, page, file: true });
      const link = join(dir, `${id}.link`);
      const open = join(dir, `${id}.open`);
      await writeFileAtomic(link, made.url, 0o600);
      await writeFileAtomic(open, made.file ?? '', 0o600);
      this.#codes.get(hashToken(made.code))?.files.push(link, open);
      answered++;
    }
    return answered;
  }

  /** Answer asks as they come (and once a second, where the system misses a change). Returns stop. */
  watch(port: () => number): () => void {
    const dir = hereAsksDir(this.home);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(dir, 0o700);
    let busy = false;
    let again = false;
    const run = () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      void this.answer(port())
        .catch(() => 0)
        .finally(() => {
          busy = false;
          if (again) {
            again = false;
            run();
          }
        });
    };
    let watcher: FSWatcher | undefined;
    try {
      watcher = watchFolder(dir, run);
      watcher.on('error', () => undefined);
    } catch {
      // Polling below still answers.
    }
    const timer = setInterval(run, 1_000);
    timer.unref();
    run();
    return () => {
      watcher?.close();
      clearInterval(timer);
    };
  }

  /** On start: the key exists, and no file or ask a crash left behind still waits. */
  async start(): Promise<void> {
    this.key();
    await rm(hereAsksDir(this.home), { recursive: true, force: true });
    await mkdir(hereAsksDir(this.home), { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(hereAsksDir(this.home), 0o700);
    const dirs = [openDir(this.home)];
    const browser = await this.deps.browserHome?.().catch(() => undefined);
    if (browser) dirs.push(browser);
    for (const dir of dirs) {
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const name of names)
        if (name.startsWith(FILE_PREFIX)) await rm(join(dir, name), { force: true });
    }
    await mkdir(openDir(this.home), { recursive: true, mode: 0o700 });
  }
}

// ── Which folder the default browser can read (Linux) ────────────────────

type Exec = (file: string, args: string[]) => Promise<string | undefined>;

const execText: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 3_000 }, (error, stdout) =>
      resolve(error ? undefined : String(stdout).trim()),
    );
  });

/**
 * Ubuntu's Firefox is a snap, and a snap can't read hidden folders in your
 * home, so a file in `~/.conch` would be "not found" there. A snap may read
 * its own `~/snap/<name>/common`; a Flatpak its own `~/.var/app/<id>`.
 * Anything else reads Conch's own folder (undefined).
 */
export async function linuxBrowserHome(
  deps: { exec?: Exec; home?: string; exists?: (path: string) => boolean } = {},
): Promise<string | undefined> {
  const exec = deps.exec ?? execText;
  const home = deps.home ?? homedir();
  const exists = deps.exists ?? existsSync;
  const desktop = await exec('xdg-settings', ['get', 'default-web-browser']);
  const id = desktop?.replace(/\.desktop$/, '');
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return undefined;
  // A snap's desktop files are named `<snap>_<app>.desktop`.
  const snap = /^([a-z0-9-]+)_[A-Za-z0-9.-]+$/.exec(id)?.[1];
  if (snap && exists(join('/snap', snap)) && exists(join(home, 'snap', snap)))
    return join(home, 'snap', snap, 'common');
  const flatpak = [
    join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications', `${id}.desktop`),
    join('/var', 'lib', 'flatpak', 'exports', 'share', 'applications', `${id}.desktop`),
  ].some(exists);
  if (flatpak && exists(join(home, '.var', 'app', id)))
    return join(home, '.var', 'app', id, 'cache');
  return undefined;
}
