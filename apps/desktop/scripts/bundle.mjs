// The app's own code, as one file Electron runs (ADR 0054), and its pictures
// and pages beside it: `dist/main.cjs` and `dist/resources/`.
import { rmSync } from 'node:fs';

import { build } from 'esbuild';

import { options, out, resources } from './app-code.mjs';

rmSync(out, { recursive: true, force: true });
await build(options);
resources();
