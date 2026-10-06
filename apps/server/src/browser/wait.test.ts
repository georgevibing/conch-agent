import type { Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import { Tab } from './tab';
import { VIEWPORT } from './runtime';

function tab() {
  // No browser or network: exercise the real control/wait lifecycle.
  const page = {
    on: vi.fn(),
    viewportSize: () => VIEWPORT,
    close: vi.fn(async () => undefined),
  } as unknown as Page;
  return new Tab('wait-test', page, () => new Set(), {
    changed: () => undefined,
    loaded: () => undefined,
    crashed: () => undefined,
  });
}

describe('waiting for browser control', () => {
  it('rejects a Stop that arrived before the wait began', async () => {
    const browser = tab();
    browser.setControl('user');
    const stop = new AbortController();
    stop.abort();
    const result = browser.whenFree(stop.signal);
    try {
      await expect(
        Promise.race([
          result.then(
            () => 'resumed',
            () => 'stopped',
          ),
          new Promise((resolve) => setTimeout(() => resolve('still waiting'), 30)),
        ]),
      ).resolves.toBe('stopped');
    } finally {
      browser.setControl('idle');
    }
  });

  it('does not resume a stopped operation even if the browser is idle', async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(tab().whenFree(stop.signal)).rejects.toThrow('stopped');
  });

  it('cancels a current wait and allows a fresh one to resume', async () => {
    const browser = tab();
    browser.setControl('user');
    const stop = new AbortController();
    const result = browser.whenFree(stop.signal);
    stop.abort();
    await expect(result).rejects.toThrow('stopped');
    const next = browser.whenFree(new AbortController().signal);
    browser.setControl('idle');
    await expect(next).resolves.toBeUndefined();
  });

  it('rejects waiting operations when their tab closes', async () => {
    const browser = tab();
    browser.setControl('user');
    const result = browser.whenFree(new AbortController().signal);
    const checked = expect(result).rejects.toThrow('stopped');
    await browser.close();
    await checked;
    await expect(browser.whenFree(new AbortController().signal)).rejects.toThrow('stopped');
  });
});
