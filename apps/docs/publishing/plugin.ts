import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';

import { SitePublication } from './schema.ts';

export function conchPublication(repo: string): Plugin {
  const id = 'virtual:conch-publication';
  return {
    name: 'conch-publication',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(source) {
      if (source !== `\0${id}`) return undefined;
      const file = process.env.CONCH_SITE_MANIFEST;
      const data = SitePublication.parse(
        file
          ? JSON.parse(readFileSync(file, 'utf8'))
          : {
              channel: 'development',
              commit: execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repo,
                encoding: 'utf8',
              }).trim(),
              next: process.env.CONCH_DOCS_BASE === '/docs/next/',
              releases: [],
            },
      );
      return `export default ${JSON.stringify(data)};`;
    },
  };
}
