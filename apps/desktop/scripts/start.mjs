// `pnpm desktop:start`: the app as it ships, without packaging it. Builds the
// web app, the app's code and what it carries (payload/), then opens it.
//
//   node scripts/start.mjs               build everything, then open the app
//   node scripts/start.mjs --fast        reuse a payload that's already built
//   node scripts/start.mjs --build-only  build, don't open (pnpm desktop:e2e)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const run = (script, extra = []) => {
  const result = spawnSync(process.execPath, [join(here, 'scripts', script), ...extra], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('bundle.mjs');
const payload = join(here, 'payload', `${process.platform}-${process.arch}`, 'conch');
if (!args.includes('--fast') || !existsSync(payload)) run('payload.mjs');
if (args.includes('--build-only')) process.exit(0);

const electron = createRequire(join(here, 'package.json'))('electron');
const app = spawn(electron, [here, ...args.filter((a) => !a.startsWith('--fast'))], {
  stdio: 'inherit',
  env: Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('ELECTRON_RUN_AS_NODE')),
  ),
});
app.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.kill(signal));
