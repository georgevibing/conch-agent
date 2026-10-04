import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { writeFileAtomic } from '../lib/fs';
import { openInBrowser } from '../lib/open';
import { hereAsksDir, OPEN_FILE, safePage } from './here';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask the running Conch for a one-time link, through the folder only your
 * account can write (ADR 0063): `<id>.ask` holds the page; Conch answers with
 * `<id>.link` and `<id>.open`. Nothing goes over the network, so whatever
 * listens on Conch's port while Conch is stopped learns nothing. Undefined
 * when no Conch answers in time.
 */
export async function askHere(options: {
  home: string;
  page?: string;
  timeoutMs?: number;
}): Promise<{ url: string; file?: string } | undefined> {
  const dir = hereAsksDir(options.home);
  if (!existsSync(dir)) return undefined;
  const ask = join(dir, randomBytes(12).toString('hex'));
  await writeFileAtomic(`${ask}.ask`, `${safePage(options.page) ?? '/'}\n`, 0o600);
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  try {
    while (Date.now() < deadline) {
      if (existsSync(`${ask}.open`)) {
        const file = (await readFile(`${ask}.open`, 'utf8')).trim();
        const url = (await readFile(`${ask}.link`, 'utf8')).trim();
        return { url, ...(file && { file }) };
      }
      await wait(100);
    }
    return undefined;
  } finally {
    await rm(`${ask}.ask`, { force: true });
  }
}

/**
 * Open Conch in this computer's browser as "this computer" (ADR 0063), from
 * another process: `pnpm conch open`, and `pnpm start` when Conch is already
 * running. It opens the private file Conch wrote, so the code is never on a
 * command line. When no Conch answers (an older one, say), it opens the plain
 * address, and the page says what to do.
 */
/**
 * Whether `file` is a private page Conch wrote: its name, a plain file (not a
 * link), and yours. Only your account and Conch write where it's named, but a
 * launcher opens nothing else regardless.
 */
export async function isOpenFile(file: string): Promise<boolean> {
  if (!OPEN_FILE.test(basename(file))) return false;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return process.platform === 'win32' || stat.uid === process.getuid?.();
  } catch {
    return false;
  }
}

export async function openHere(options: {
  home: string;
  /** Where the browser goes when there's no link: `http://localhost:<port>`. */
  url: string;
  page?: string;
  timeoutMs?: number;
  open?: (target: string) => Promise<boolean>;
}): Promise<'opened' | 'plain' | 'no-browser'> {
  const open = options.open ?? openInBrowser;
  const page = safePage(options.page) ?? '/';
  const link = await askHere({ ...options, page });
  if (link?.file && (await isOpenFile(link.file)))
    return (await open(link.file)) ? 'opened' : 'no-browser';
  return (await open(`${options.url}${page}`)) ? 'plain' : 'no-browser';
}
