/// <reference types="vitest/config" />
import { resolve } from 'node:path';

import { nacreCssModules } from '@conch/nacre/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { conchReference } from './reference/plugin.ts';

const REPO = resolve(import.meta.dirname, '../..');

export default defineConfig({
  // `CONCH_DOCS_BASE=/conch-agent/ pnpm docs:build` for a site served from a folder.
  base: process.env.CONCH_DOCS_BASE ?? '/',
  plugins: [react(), conchReference()],
  // Every page is drawn ahead of time (scripts/prerender.mjs): the manifest says which
  // code and styles each one loads, and the build for Node takes Nacre's source as it is.
  build: { manifest: true },
  ssr: { noExternal: ['@conch/nacre'] },
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
