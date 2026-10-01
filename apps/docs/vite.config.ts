/// <reference types="vitest/config" />
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { nacreCssModules } from '@conch/nacre/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { conchReference } from './reference/plugin.ts';

const REPO = resolve(import.meta.dirname, '../..');

/**
 * A static host answers an address it has no file for with `404.html`. A copy
 * of the page there means every address opens the documentation, which then
 * shows the right page itself.
 */
function everyAddressOpens(): Plugin {
  let out = '';
  return {
    name: 'conch-docs-every-address-opens',
    apply: 'build',
    configResolved(config) {
      out = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
    },
  };
}

export default defineConfig({
  // `CONCH_DOCS_BASE=/conch-agent/ pnpm docs:build` for a site served from a folder.
  base: process.env.CONCH_DOCS_BASE ?? '/',
  plugins: [react(), conchReference(), everyAddressOpens()],
  css: { modules: nacreCssModules },
  server: {
    host: '127.0.0.1',
    port: 4400,
    // The guides at the top of the repository (docs/, ARCHITECTURE.md) are pages too.
    fs: { allow: [REPO] },
  },
  preview: { host: '127.0.0.1', port: 4400 },
  test: {
    environment: 'jsdom',
    testTimeout: 15_000,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
