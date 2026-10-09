/**
 * The printer heals what it can (agreement 11): a browser that won't start
 * sends PDFs to Conch's own writer at once (not after a wait per PDF), Conch's
 * own Chromium is fetched for the next one, a Snap-confined browser is tried
 * last, and missing system libraries come back as the command to run.
 */
import type { Browser, LaunchOptions } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import { pdfCheck } from '../../doctor/checks';
import { ChromiumPrinter, snapConfined } from './printer';

const browser = () =>
  ({
    on: () => undefined,
    close: () => Promise.resolve(),
  }) as unknown as Browser;

const LIBS =
  'browserType.launch: Failed to launch: error while loading shared libraries: libnss3.so: cannot open shared object file';

describe('ChromiumPrinter', () => {
  it('tries a Snap-confined Chromium last, with flags for small /dev/shm', async () => {
    const tried: LaunchOptions[] = [];
    const printer = new ChromiumPrinter({
      platform: 'linux',
      locate: () => [
        { id: 'chromium', name: 'Chromium', path: '/snap/bin/chromium' },
        { id: 'downloaded', name: 'Chromium (downloaded by Conch)', path: '/home/me/pw/chrome' },
      ],
      launch: (options) => {
        tried.push(options);
        return Promise.resolve(browser());
      },
    });
    expect(await printer.repair()).toEqual({ by: 'Chromium' });
    expect(tried[0]?.executablePath).toBe('/home/me/pw/chrome');
    expect(tried[0]?.args).toContain('--disable-dev-shm-usage');
    await printer.close();
  });

  it('when no browser starts, makes PDFs without one at once and fetches Chromium for the next', async () => {
    let fetched: () => void = () => undefined;
    const install = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          fetched = resolve;
        }),
    );
    const heal = vi.fn();
    const launch = vi.fn((_: LaunchOptions) => Promise.reject(new Error('Target crashed')));
    const printer = new ChromiumPrinter({
      platform: 'linux',
      locate: () => [{ id: 'chrome', name: 'Google Chrome', path: '/usr/bin/google-chrome' }],
      launch,
      install,
      heal,
    });
    expect(printer.by()).toBe('Google Chrome');
    expect(await printer.pdf('<p>x</p>', { size: 'A4', landscape: false })).toBeUndefined();
    expect(printer.problem()?.message).toMatch(/Google Chrome wouldn’t start/);
    // The next PDF doesn't wait for the browsers again.
    expect(printer.by()).toBeUndefined();
    expect(await printer.pdf('<p>y</p>', { size: 'A4', landscape: false })).toBeUndefined();
    expect(launch).toHaveBeenCalledTimes(1);
    fetched();
    await vi.waitFor(() =>
      expect(heal).toHaveBeenCalledWith(expect.stringMatching(/Downloaded Chromium/)),
    );
    expect(install).toHaveBeenCalledTimes(1);
    // With Chromium fetched, printing is tried again.
    expect(printer.by()).toBe('Google Chrome');
    await printer.close();
  });

  it('says which command adds missing system libraries, and fetches nothing', async () => {
    const install = vi.fn(() => Promise.resolve());
    const printer = new ChromiumPrinter({
      platform: 'linux',
      locate: () => [
        { id: 'downloaded', name: 'Chromium (downloaded by Conch)', path: '/home/me/pw/chrome' },
      ],
      launch: () => Promise.reject(new Error(LIBS)),
      install,
    });
    const repaired = await printer.repair();
    expect(repaired.by).toBeUndefined();
    expect(repaired.problem?.command).toBe('sudo npx playwright install-deps chromium');
    expect(install).not.toHaveBeenCalled();
  });

  it('tells a Snap browser by its path or by the script that opens it', () => {
    expect(snapConfined('/snap/bin/chromium')).toBe(true);
    expect(snapConfined('/nowhere/chrome')).toBe(false);
  });
});

describe('Repair everything: Making PDFs', () => {
  const signal = new AbortController().signal;
  const fonts = () => ({ roles: { regular: '/f/DejaVuSans.ttf' }, fallbacks: [] });

  it('is ready with a browser, without starting it to look', async () => {
    const repair = vi.fn();
    const items = await pdfCheck({
      printer: { by: () => 'Chrome', problem: () => undefined, repair },
      fonts,
    }).run({ repair: false, signal });
    expect(items).toEqual([expect.objectContaining({ state: 'ok', message: 'Ready · Chrome' })]);
    expect(repair).not.toHaveBeenCalled();
  });

  it('offers Repair without a browser, which fetches Chromium in the background', async () => {
    const check = pdfCheck({
      printer: {
        by: () => undefined,
        problem: () => undefined,
        repair: () =>
          Promise.resolve({
            problem: { message: 'there’s no browser on this computer to print with' },
            fetching: true,
          }),
      },
      fonts,
    });
    expect(await check.run({ repair: false, signal })).toEqual([
      expect.objectContaining({ state: 'warning', repairable: true }),
    ]);
    expect(await check.run({ repair: true, signal })).toEqual([
      expect.objectContaining({
        state: 'info',
        message: expect.stringMatching(/Getting Chromium/),
      }),
    ]);
  });

  it('gives the command for missing libraries, and for a Linux server with no fonts', async () => {
    const problem = {
      message: 'The browser that prints PDFs needs system libraries that aren’t installed',
      command: 'sudo npx playwright install-deps chromium',
    };
    const items = await pdfCheck({
      printer: { by: () => undefined, problem: () => problem, repair: vi.fn() },
      fonts: () => ({ roles: {}, fallbacks: [] }),
      platform: 'linux',
      apt: () => true,
    }).run({ repair: false, signal });
    expect(items).toEqual([
      expect.objectContaining({
        id: 'pdf',
        state: 'needs-you',
        action: expect.objectContaining({ command: problem.command }),
      }),
      expect.objectContaining({
        id: 'pdf:fonts',
        state: 'needs-you',
        action: expect.objectContaining({ command: expect.stringContaining('fonts-noto-core') }),
      }),
    ]);
  });

  it('says it fixed it when a browser prints again', async () => {
    const items = await pdfCheck({
      printer: {
        by: () => undefined,
        problem: () => ({ message: 'Chrome wouldn’t start to print' }),
        repair: () => Promise.resolve({ by: 'Chromium' }),
      },
      fonts,
    }).run({ repair: true, signal });
    expect(items).toEqual([
      expect.objectContaining({ state: 'fixed', message: 'Prints with Chromium again.' }),
    ]);
  });
});
