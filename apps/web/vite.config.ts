/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { nacreCssModules } from '@conch/nacre/vite';
import react from '@vitejs/plugin-react';
import { createLogger, defineConfig, type Logger, type Plugin, type ProxyOptions } from 'vite';

const USUAL = '127.0.0.1:4317';
let known = { at: 0, address: USUAL };

/**
 * Where the gateway is: `CONCH_GATEWAY` when set, else where the gateway
 * says it listens (`~/.conch/gateway.json`; it starts on the next free port
 * when 4317 is taken), read again at most once a second.
 */
function gateway(): string {
  if (process.env.CONCH_GATEWAY) return process.env.CONCH_GATEWAY;
  if (Date.now() - known.at < 1_000) return known.address;
  let address = USUAL;
  try {
    const home = process.env.CONCH_HOME ?? join(homedir(), '.conch');
    const record: unknown = JSON.parse(readFileSync(join(home, 'gateway.json'), 'utf8'));
    if (typeof record === 'object' && record !== null && 'port' in record) {
      const { port } = record;
      if (typeof port === 'number' && Number.isInteger(port)) address = `127.0.0.1:${port}`;
    }
  } catch {
    // Not started yet: the usual port.
  }
  known = { at: Date.now(), address };
  return address;
}

/** Proxy to the gateway, following it to another port if it moved there. */
function toGateway(scheme: 'http' | 'ws', options: ProxyOptions): ProxyOptions {
  let live: ProxyOptions | undefined;
  return {
    ...options,
    target: `${scheme}://${gateway()}`,
    // The proxy reads these options on every request; point them at where it is now.
    configure: (_proxy, own) => void (live = own),
    bypass: () => {
      if (live) live.target = `${scheme}://${gateway()}`;
      return undefined;
    },
  };
}

/**
 * Vite's own logger, with the proxy's everyday errors put plainly: a page
 * that went away mid-reply (a reload, a sign-in) isn't news, and a gateway
 * starting again is one line, not a stack trace per request.
 */
function quietProxyLogger(): Logger {
  const logger = createLogger();
  const error = logger.error.bind(logger);
  let waitingSaid = 0;
  logger.error = (msg, options) => {
    const code = (options?.error as NodeJS.ErrnoException | null | undefined)?.code;
    if (!code || !/proxy/.test(msg)) return error(msg, options);
    if (/^(ECONNABORTED|ECONNRESET|EPIPE)$/.test(code)) return;
    if (code === 'ECONNREFUSED') {
      if (Date.now() - waitingSaid > 5_000)
        logger.warn(`Conch isn’t answering at ${gateway()} yet (starting, or starting again).`, {
          timestamp: true,
        });
      waitingSaid = Date.now();
      return;
    }
    error(msg, options);
  };
  return logger;
}

/**
 * Every build says what it was built from: `dist/build.json`, `{ commit,
 * builtAt }` (no commit without git). A gateway whose code was pulled by
 * hand sees its web app is older and builds it again
 * (apps/server/src/updates/webbuild.ts); the page knows its own `builtAt`
 * and offers to reload onto a newer one.
 */
function buildStamp(): Plugin {
  const builtAt = new Date().toISOString();
  let commit: string | undefined;
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
    if (/^[0-9a-f]{40,64}$/.test(head)) commit = head;
  } catch {
    // Not a git checkout (or no git): the stamp says when, not what.
  }
  return {
    name: 'conch-build-stamp',
    config: (_config, { command }) => ({
      define: { __CONCH_WEB_BUILT_AT__: JSON.stringify(command === 'build' ? builtAt : null) },
    }),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.json',
        source: `${JSON.stringify({ ...(commit && { commit }), builtAt })}\n`,
      });
    },
  };
}

export default defineConfig({
  customLogger: quietProxyLogger(),
  plugins: [react(), buildStamp()],
  css: { modules: nacreCssModules },
  server: {
    // Loopback only: `vite --host` would let LAN visitors reach the gateway
    // through the proxy looking like this computer.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // The browser's own Host goes through untouched (no `changeOrigin`): the
      // gateway refuses a write whose Origin isn't the Host it was asked on.
      '/api': toGateway('http', {}),
      // Where a service sends you back after a sign-in: the gateway's page, not the app's.
      '/oauth': toGateway('http', {}),
      '/ws': toGateway('ws', { ws: true }),
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
