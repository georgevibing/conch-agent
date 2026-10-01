import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { normalizePath, type Plugin } from 'vite';

import type { Reference } from './types.ts';

const ID = 'virtual:conch-reference';
const RESOLVED = `\0${ID}`;

const ROOT = resolve(import.meta.dirname, '..');
const REPO = resolve(ROOT, '../..');
/** Where the reference is read from: a change here means the pages changed. */
const WATCHED = ['apps/server/src', 'apps/web/src', 'packages/protocol/src'].map((path) =>
  normalizePath(resolve(REPO, path)),
);

/** Reads the code in a process of its own (`print.ts`), the way the server loads it. */
function read(): Reference {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'reference/print.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      `The documentation couldn't read the code it describes (apps/docs/reference/build.ts):\n${result.stderr || result.error?.message || 'no output'}`,
    );
  }
  return JSON.parse(result.stdout) as Reference;
}

/**
 * `virtual:conch-reference`: what the code says about itself, read when the
 * documentation starts, builds or is tested, and again whenever the code changes.
 */
export function conchReference(): Plugin {
  let cached: string | undefined;
  return {
    name: 'conch-reference',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return undefined;
      cached ??= `export default ${JSON.stringify(read())};`;
      return cached;
    },
    configureServer(server) {
      server.watcher.add(WATCHED);
      let timer: NodeJS.Timeout | undefined;
      const changed = (file: string) => {
        const path = normalizePath(file);
        if (!/\.tsx?$/.test(path) || !WATCHED.some((dir) => path.startsWith(dir))) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          const before = cached;
          try {
            cached = `export default ${JSON.stringify(read())};`;
          } catch (error) {
            server.config.logger.error((error as Error).message);
            return;
          }
          if (cached === before) return;
          const module = server.moduleGraph.getModuleById(RESOLVED);
          if (module) server.moduleGraph.invalidateModule(module);
          server.ws.send({ type: 'full-reload' });
        }, 150);
      };
      server.watcher.on('change', changed);
      server.watcher.on('add', changed);
      server.watcher.on('unlink', changed);
    },
  };
}
