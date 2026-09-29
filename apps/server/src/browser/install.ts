import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { agentEnv } from '../lib/proc';

/**
 * Getting a browser when the computer has none (ADR 0014): Chromium, fetched
 * by `playwright-core`'s own installer into Playwright's usual cache, so any
 * copy already there (from other tools) is reused and nothing is fetched twice.
 */

export interface InstallProgress {
  percent: number;
  label: string;
}

export class InstallError extends Error {
  constructor(
    message: string,
    /** Something only you can run (e.g. system libraries on Linux). */
    readonly command?: string,
  ) {
    super(message);
  }
}

const require = createRequire(import.meta.url);

/** `playwright-core`'s command-line entry, which isn't in its `exports`. */
function cli(): string {
  return join(dirname(require.resolve('playwright-core/package.json')), 'cli.js');
}

/** "|■■■■      |  42% of 170.3 MiB" → 42, "170.3 MiB". */
const PROGRESS = /(\d{1,3})% of ([\d.]+\s*\w+)/;

/** Downloads Chromium. Resolves when it's installed; throws `InstallError` in plain words. */
export function installChromium(
  onProgress: (progress: InstallProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli(), 'install', 'chromium'], {
      env: agentEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal,
    });
    let tail = '';
    let last = -1;
    const read = (chunk: Buffer) => {
      const text = String(chunk);
      tail = (tail + text).slice(-4_000);
      for (const line of text.split(/[\r\n]+/)) {
        const match = PROGRESS.exec(line);
        if (!match) continue;
        const percent = Math.min(100, Number(match[1]));
        if (percent === last) continue;
        last = percent;
        onProgress({ percent, label: `Downloading Chromium · ${percent}% of ${match[2]}` });
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    const timer = setTimeout(() => child.kill(), 15 * 60_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new InstallError(`Couldn’t start the browser download: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      if (/ENOSPC|no space/i.test(tail))
        return reject(new InstallError('There isn’t enough disk space to download a browser.'));
      if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network/i.test(tail))
        return reject(
          new InstallError('Couldn’t download a browser: the internet seems to be unreachable.'),
        );
      reject(new InstallError('The browser download didn’t finish.'));
    });
  });
}

/** Errors that mean the system is missing libraries the browser needs (Linux), and the fix. */
export function missingLibraries(message: string): InstallError | undefined {
  if (
    !/error while loading shared libraries|Host system is missing dependencies|libnss3|libgbm/i.test(
      message,
    )
  )
    return undefined;
  return new InstallError(
    'The browser needs a few system libraries that aren’t installed.',
    'sudo npx playwright install-deps chromium',
  );
}
