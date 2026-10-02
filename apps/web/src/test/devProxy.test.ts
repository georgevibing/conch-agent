import type { ProxyOptions, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';

import config from '../../vite.config';

/**
 * `pnpm dev` serves the app on :5173 and hands the gateway's paths on. The
 * gateway refuses a write whose Origin isn't the Host it was asked on, so the
 * proxy must pass the browser's Host through: with `changeOrigin`, every
 * switch and every Connect answers 403 "Cross-origin request refused."
 */
describe('the dev server’s proxy', () => {
  const proxy = ((config as UserConfig).server?.proxy ?? {}) as Record<string, ProxyOptions>;

  it.each(['/api', '/oauth'])('%s goes to the gateway with the browser’s own Host', (path) => {
    const options = proxy[path];
    expect(options, `${path} must be handed to the gateway`).toBeTypeOf('object');
    expect(
      options?.changeOrigin,
      `${path}: changeOrigin rewrites Host, and the gateway then refuses every write from the page`,
    ).toBeFalsy();
    expect(String(options?.target)).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('hands the live socket on too', () => {
    expect(proxy['/ws']?.ws).toBe(true);
    expect(proxy['/ws']?.changeOrigin).toBeFalsy();
  });
});
