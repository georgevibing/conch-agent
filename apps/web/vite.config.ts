/// <reference types="vitest/config" />
import { nacreCssModules } from '@conch/nacre/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const gateway = process.env.CONCH_GATEWAY ?? '127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  css: { modules: nacreCssModules },
  server: {
    // Loopback only: `vite --host` would let LAN visitors reach the gateway
    // through the proxy looking like this computer.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://${gateway}`,
      '/ws': { target: `ws://${gateway}`, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    // jsdom renders on a shared CI runner can be several times slower than locally.
    testTimeout: 15_000,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
