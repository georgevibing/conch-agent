// `pnpm desktop:dev`: the app on the repository, as you change it.
//
// - The web app comes from Vite's dev server, with hot reload.
// - The gateway runs from apps/server/src with the Node that runs pnpm, and
//   the app starts it again when its code changes.
// - The app's own code is rebuilt on change, and the app opened again.
//
// The gateway uses CONCH_HOME and CONCH_PORT like `pnpm dev` does; with a
// Conch already running there, the app shows that one.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { context } from 'esbuild';

import { options, pnpmCommand, resources } from './app-code.mjs';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = join(here, '..', '..');
const WEB = 'http://127.0.0.1:5173';
const electron = createRequire(join(here, 'package.json'))('electron');
const say = (text) => console.warn(`  🐚  ${text}`);

const answers = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
};

// The web app: Vite, unless one is already running (pnpm dev).
let vite;
if (!(await answers(WEB))) {
  const pn = pnpmCommand(['--filter', '@conch/web', 'dev']);
  vite = spawn(pn.command, pn.args, { cwd: repo, stdio: 'inherit', shell: pn.shell });
  for (let i = 0; !(await answers(WEB)); i++) {
    if (i > 120) throw new Error(`The web app's dev server didn't start at ${WEB}.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// The app, opened again each time its own code is rebuilt.
let app;
let stopping = false;
const open = () => {
  app = spawn(electron, [here], {
    stdio: 'inherit',
    env: { ...process.env, CONCH_DESKTOP_WEB: WEB },
  });
  app.on('exit', () => {
    app = undefined;
    // Quit from the app itself: everything stops.
    if (!stopping && !restarting) finish(0);
  });
};
let restarting = false;
const reopen = () => {
  if (!app) return open();
  restarting = true;
  app.once('exit', () => {
    restarting = false;
    open();
  });
  app.kill();
};

let ctx;
function finish(code) {
  stopping = true;
  app?.kill();
  vite?.kill();
  void ctx?.dispose();
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => finish(0));

let first = true;
resources();
ctx = await context({
  ...options,
  plugins: [
    {
      name: 'reopen',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return;
          say(first ? 'Opening Conch…' : 'The app’s code changed: opening it again.');
          first = false;
          reopen();
        });
      },
    },
  ],
});
await ctx.watch();
