/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { nacreCssModules } from './vite.shared';

export default defineConfig({
  plugins: [react()],
  css: { modules: nacreCssModules },
  test: {
    environment: 'jsdom',
    // jsdom renders on a shared CI runner can be several times slower than locally.
    testTimeout: 15_000,
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
