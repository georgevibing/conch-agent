// This computer's installers for the app (ADR 0054), in apps/desktop/out:
//
//   node scripts/dist.mjs                 the app's code, what it carries, then the installers
//   node scripts/dist.mjs --dir           an unpacked app only (quick; nothing to install)
//   node scripts/dist.mjs --skip-payload  reuse payload/ as it is
//
// macOS: Conch-<v>-mac-<arch>.dmg and .zip (the zip is what updates use)
// Windows: Conch-<v>-win-<arch>.exe (installs for this person; no administrator)
// Linux: Conch-<v>-linux-<arch>.AppImage and .deb
//
// Each is built on the kind of computer it's for: the native modules it
// carries are this computer's. Signing happens when its secrets are set:
// CSC_LINK and CSC_KEY_PASSWORD (Mac and Windows certificates), and
// APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER (or APPLE_ID,
// APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID) to notarize on a Mac.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import builder from 'electron-builder';
import { desktopPackageVersion, readBuild } from '../../server/src/build.ts';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = join(here, '..', '..');
const platform = process.platform;
const arch = process.arch;
const args = process.argv.slice(2);
const root = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const repository = /github\.com\/([^/]+)\/([^/.]+)/.exec(root.repository?.url ?? '');
if (!repository) throw new Error('The root package.json must name its GitHub repository.');
const [, owner, repo_] = repository;

// `pnpm desktop:build:mac` and friends: only on that kind of computer.
const asked = { '--mac': 'darwin', '--win': 'win32', '--linux': 'linux' };
const NAMES = { darwin: 'a Mac', win32: 'Windows', linux: 'Linux' };
for (const [flag, wanted] of Object.entries(asked))
  if (args.includes(flag) && wanted !== platform) {
    console.error(
      `\n  The ${NAMES[wanted]} app is built on ${NAMES[wanted]}: it carries native modules made there.\n` +
        `  Run this on ${NAMES[wanted]}, or let GitHub Actions build every platform:\n` +
        `  merge the release pull request, or run the "Desktop app" workflow by hand (docs/RELEASING.md).\n`,
    );
    process.exit(1);
  }

const step = (script, extra = []) => {
  const result = spawnSync(process.execPath, [join(here, 'scripts', script), ...extra], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
step('bundle.mjs');
if (!args.includes('--skip-payload')) step('payload.mjs');
const payload = join(here, 'payload', `${platform}-${arch}`);
if (!existsSync(join(payload, 'conch')) || !existsSync(join(payload, 'node')))
  throw new Error(`Nothing to carry in ${payload}: run without --skip-payload.`);

const signing = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarizing = Boolean(
  process.env.APPLE_API_KEY || process.env.APPLE_ID || process.env.APPLE_KEYCHAIN_PROFILE,
);
const icon = join(repo, 'apps', 'web', 'public', 'icons', 'conch-1024.png');
const archName = arch === 'arm64' ? 'arm64' : 'x64';
const builderArch = builder.Arch[archName];

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.conchagent.app',
  productName: 'Conch',
  copyright: 'Copyright © 2026 George Kal',
  directories: { output: join(here, 'out'), buildResources: join(here, 'build') },
  // The app's own code is one bundled file: no node_modules inside the app.
  files: ['dist/**/*', '!dist/**/*.map', 'package.json'],
  extraMetadata: {
    name: 'conch',
    version: desktopPackageVersion(readBuild(join(payload, 'conch'))),
    description: root.description,
    // The .deb wants one; the Linux desktop links the window to its entry by desktopName.
    homepage: root.homepage,
    desktopName: 'conch.desktop',
    main: 'dist/main.cjs',
    // Read by the app: a signed Mac app can replace itself (ADR 0054).
    conch: { signed: signing },
  },
  extraResources: [
    { from: join(payload, 'conch'), to: 'conch' },
    { from: join(payload, 'node'), to: 'node' },
  ],
  asar: true,
  // Electron's fuses (its security checklist): no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS, no
  // inspector, encrypted cookies, and only the checked archive is ever loaded.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  // One name for the chip everywhere (x64, arm64), whatever each format calls it.
  artifactName: `Conch-\${version}-\${os}-${archName}.\${ext}`,
  // Writes latest*.yml beside the installers, which updates read. The release
  // workflow attaches them; nothing is published from here.
  publish: [{ provider: 'github', owner, repo: repo_, releaseType: 'release' }],
  detectUpdateChannel: false,
  mac: {
    category: 'public.app-category.developer-tools',
    icon,
    target: [
      { target: 'dmg', arch: [archName] },
      { target: 'zip', arch: [archName] },
    ],
    hardenedRuntime: true,
    entitlements: join(here, 'build', 'entitlements.mac.plist'),
    entitlementsInherit: join(here, 'build', 'entitlements.mac.plist'),
    // Unsigned unless a certificate is given: "-" is ad hoc, which Apple silicon needs to run at all.
    ...(signing ? {} : { identity: '-' }),
    notarize: signing && notarizing,
    extendInfo: {
      NSMicrophoneUsageDescription: 'Conch listens when you talk to it.',
      LSApplicationCategoryType: 'public.app-category.developer-tools',
    },
  },
  dmg: { title: 'Conch ${version}' },
  win: {
    // The pearl alone, drawn at every size Windows uses (scripts/icons.mjs).
    icon: join(repo, 'apps', 'web', 'public', 'icons', 'conch.ico'),
    target: [{ target: 'nsis', arch: [archName] }],
  },
  nsis: {
    // One click, for this person only: no administrator, no questions.
    oneClick: true,
    perMachine: false,
    shortcutName: 'Conch',
    uninstallDisplayName: 'Conch',
    // Conch's own things live in ~/.conch and stay when the app goes.
    deleteAppDataOnUninstall: false,
  },
  linux: {
    icon,
    category: 'Development',
    executableName: 'conch',
    synopsis: root.description,
    description: root.description,
    maintainer: `Conch <${owner}@users.noreply.github.com>`,
    target: [
      { target: 'AppImage', arch: [archName] },
      { target: 'deb', arch: [archName] },
    ],
    syncDesktopName: true,
  },
};

const target = {
  darwin: builder.Platform.MAC,
  win32: builder.Platform.WINDOWS,
  linux: builder.Platform.LINUX,
}[platform];
if (!target) throw new Error(`There's no Conch app for ${platform}.`);

const built = await builder.build({
  targets: args.includes('--dir')
    ? target.createTarget('dir', builderArch)
    : target.createTarget(null, builderArch),
  config,
  publish: 'never',
});
console.warn(`\n  🐚  Built:\n${built.map((file) => `      ${file}`).join('\n')}\n`);
