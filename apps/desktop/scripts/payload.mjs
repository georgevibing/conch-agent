// What the app carries (ADR 0054), for this computer:
//
//   payload/<platform>-<arch>/conch   Conch, laid out like a checkout
//   payload/<platform>-<arch>/node    Node itself, checked against nodejs.org's SHASUMS256.txt
//
//   node scripts/payload.mjs              build the web app, then everything
//   node scripts/payload.mjs --skip-web   reuse apps/web/dist as it is
//
// Native modules come from this computer's install, so a payload is built on
// the kind of computer it's for (CI builds each on its own).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { pnpmCommand } from './app-code.mjs';
import { readBuild } from '../../server/src/build.ts';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = join(here, '..', '..');
const platform = process.platform;
const arch = process.arch;
const own = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const NODE = own.conch?.node;
if (!/^\d+\.\d+\.\d+$/.test(NODE ?? ''))
  throw new Error('apps/desktop/package.json needs conch.node');

const target = join(here, 'payload', `${platform}-${arch}`);
const conch = join(target, 'conch');
const server = join(conch, 'apps', 'server');
const say = (text) => console.warn(`  🐚  ${text}`);
/** pnpm itself: its script with this Node when pnpm started us, else the `pnpm` on PATH. */
const pnpm = (args, cwd = repo) => {
  const pn = pnpmCommand(args);
  const result = spawnSync(pn.command, pn.args, { cwd, stdio: 'inherit', shell: pn.shell });
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed`);
};

// ── Conch ──────────────────────────────────────────────────────────────────

if (!process.argv.includes('--skip-web')) {
  say('Building the web app…');
  pnpm(['--filter', '@conch/web', 'build']);
}
if (!existsSync(join(repo, 'apps', 'web', 'dist', 'index.html')))
  throw new Error('apps/web/dist is missing: run without --skip-web');

say('Copying the gateway and what it needs to run…');
rmSync(conch, { recursive: true, force: true });
mkdirSync(join(conch, 'apps', 'web'), { recursive: true });
const staging = join(here, 'payload', `.deploy-${process.pid}`);
rmSync(staging, { recursive: true, force: true });
// Hoisted: a flat node_modules with no links, which every installer copies as it is.
pnpm([
  '--config.inject-workspace-packages=true',
  '--config.node-linker=hoisted',
  '--filter',
  '@conch/server',
  'deploy',
  '--prod',
  staging,
]);
renameSync(staging, server);

// Only what runs: no tests, no tooling, no lockfile.
for (const name of [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'eslint.config.js',
  'vitest.config.ts',
])
  rmSync(join(server, name), { force: true });

/** Every file under `dir`, recursively. */
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}
for (const file of files(join(server, 'src'))) if (/\.test\.tsx?$/.test(file)) rmSync(file);

// The gateway's tsconfig, resolved: the shared one it extends isn't shipped.
const base = JSON.parse(readFileSync(join(repo, 'packages', 'tsconfig', 'base.json'), 'utf8'));
const node = JSON.parse(readFileSync(join(repo, 'packages', 'tsconfig', 'node.json'), 'utf8'));
writeFileSync(
  join(server, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: { ...base.compilerOptions, ...node.compilerOptions, types: [] },
      include: ['src'],
    },
    null,
    2,
  )}\n`,
);

// The one version, and where releases come from (ADR 0051, ADR 0054).
const rootPackage = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
writeFileSync(
  join(conch, 'package.json'),
  `${JSON.stringify(
    {
      name: rootPackage.name,
      version: rootPackage.version,
      private: true,
      description: rootPackage.description,
      repository: rootPackage.repository,
      type: 'module',
    },
    null,
    2,
  )}\n`,
);
writeFileSync(join(conch, 'conch-build.json'), `${JSON.stringify(readBuild(repo), null, 2)}\n`);
mkdirSync(join(conch, 'release'), { recursive: true });
cpSync(join(repo, 'release', 'allowed_signers'), join(conch, 'release', 'allowed_signers'));
cpSync(join(repo, 'apps', 'web', 'dist'), join(conch, 'apps', 'web', 'dist'), { recursive: true });

// Other computers' binaries, and source maps nobody reads.
const modules = join(server, 'node_modules');
const keepOnly = (dir, keep) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir))
    if (!keep(entry)) rmSync(join(dir, entry), { recursive: true, force: true });
};
const ortOs = { win32: 'win32', darwin: 'darwin', linux: 'linux' }[platform];
for (const napi of existsSync(join(modules, 'onnxruntime-node', 'bin'))
  ? readdirSync(join(modules, 'onnxruntime-node', 'bin'))
  : []) {
  const dir = join(modules, 'onnxruntime-node', 'bin', napi);
  keepOnly(dir, (os) => os === ortOs);
  keepOnly(join(dir, ortOs), (a) => a === arch);
}
keepOnly(join(modules, 'node-pty', 'prebuilds'), (name) => name === `${platform}-${arch}`);
// transformers.js carries its own copy of onnxruntime-web and runs on onnxruntime-node here:
// the package itself is only a dependency on paper (130 MB of browser builds).
rmSync(join(modules, 'onnxruntime-web', 'dist'), { recursive: true, force: true });
for (const file of files(modules)) if (file.endsWith('.map')) rmSync(file);

// ── Node ───────────────────────────────────────────────────────────────────

const nodeOs = { win32: 'win', darwin: 'darwin', linux: 'linux' }[platform];
const ext = platform === 'win32' ? 'zip' : 'tar.gz';
const archive = `node-v${NODE}-${nodeOs}-${arch}.${ext}`;
const cache = join(here, '.cache');
mkdirSync(cache, { recursive: true });

async function download(name) {
  const path = join(cache, `${NODE}-${name}`);
  if (existsSync(path)) return path;
  const url = `https://nodejs.org/dist/v${NODE}/${name}`;
  say(`Downloading ${url}…`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${path}.part`));
  renameSync(`${path}.part`, path);
  return path;
}

const sums = readFileSync(await download('SHASUMS256.txt'), 'utf8');
const expected = sums
  .split('\n')
  .map((line) => line.trim().split(/\s+/))
  .find(([, name]) => name === archive)?.[0];
if (!expected) throw new Error(`nodejs.org lists no ${archive}`);
const file = await download(archive);
const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
if (actual !== expected) {
  rmSync(file, { force: true });
  throw new Error(
    `${archive} doesn't match nodejs.org's SHASUMS256.txt; it was deleted. Run again.`,
  );
}
say(`Node ${NODE} checks out (sha256 ${actual.slice(0, 12)}…).`);

const unpacked = join(target, '.node');
rmSync(unpacked, { recursive: true, force: true });
rmSync(join(target, 'node'), { recursive: true, force: true });
mkdirSync(unpacked, { recursive: true });
// bsdtar reads zip as well; Windows 10 and later ship it as System32\tar.exe (Git's own tar
// on PATH can't read a zip, or a path with a drive letter).
const tar =
  platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
execFileSync(tar, ['-xf', file, '-C', unpacked], { stdio: 'inherit' });
renameSync(join(unpacked, archive.replace(/\.(zip|tar\.gz)$/, '')), join(target, 'node'));
rmSync(unpacked, { recursive: true, force: true });

// ── Does it run? ───────────────────────────────────────────────────────────

const nodeExe =
  platform === 'win32' ? join(target, 'node', 'node.exe') : join(target, 'node', 'bin', 'node');
const check = spawnSync(
  nodeExe,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    "const v = await import('./src/version.ts'); console.log(v.SERVER_VERSION, JSON.stringify(v.REPOSITORY));",
  ],
  { cwd: server, encoding: 'utf8' },
);
if (check.status !== 0) throw new Error(`The payload's gateway doesn't load:\n${check.stderr}`);
// Conch apps' sealed runtime is a plain .mjs the gateway starts by path (ADR 0061): it must be there.
const sealed = spawnSync(
  nodeExe,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    "const { HOST_SCRIPT } = await import('./src/conchapps/runtime.ts'); const { existsSync } = await import('node:fs'); if (!existsSync(HOST_SCRIPT)) throw new Error('missing ' + HOST_SCRIPT);",
  ],
  { cwd: server, encoding: 'utf8' },
);
if (sealed.status !== 0)
  throw new Error(`The payload is missing the runtime Conch apps run in:\n${sealed.stderr}`);

const size = (dir) => {
  let total = 0;
  for (const f of files(dir)) total += statSync(f).size;
  return total;
};
say(
  `Ready in ${relative(repo, target)}: Conch ${check.stdout.trim()}, ${Math.round(size(target) / 1e6)} MB.`,
);
