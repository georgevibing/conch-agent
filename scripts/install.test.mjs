import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./install-prerequisites.sh', import.meta.url));

test(
  'one-line installer completes unattended with the Python fallback and no privileged child',
  { skip: process.platform === 'win32' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'conch-install-flow-'));
    const bin = join(root, 'bin');
    const repo = join(root, 'app with spaces');
    mkdirSync(bin);
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    mkdirSync(join(repo, 'apps/server/src'), { recursive: true });
    mkdirSync(join(repo, '.git'));
    writeFileSync(join(repo, 'scripts/install-prerequisites.sh'), readFileSync(helper));
    writeFileSync(
      join(repo, 'apps/server/src/version.ts'),
      "export const SERVER_VERSION = 'test';\n",
    );
    // Only these harmless filesystem/text tools are real. All installers, version
    // probes and repository operations are stand-ins inside the closed PATH.
    for (const name of ['mktemp', 'rm', 'sed', 'dirname', 'head', 'tail']) {
      const path = execFileSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', name], {
        encoding: 'utf8',
      }).trim();
      symlinkSync(path, join(bin, name));
    }
    const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
if (name === 'uname') { console.log('Linux'); process.exit(0); }
if (name === 'id') { console.log('1000'); process.exit(0); }
if (name === 'node') { if(args[0] === '-v') console.log('v24.0.0'); process.exit(0); }
fs.appendFileSync(process.env.CALLS, name + ' ' + args.join(' ') + '\\n');
if (name === 'sudo' || name === 'apt-get') process.exit(99);
if (name === 'corepack' && args.includes('tsx')) console.log('python');
`;
    for (const name of ['uname', 'id', 'node', 'git', 'corepack', 'python3', 'sudo', 'apt-get']) {
      writeFileSync(join(bin, name), stub, { mode: 0o755 });
    }
    try {
      const output = execFileSync(
        '/bin/sh',
        ['-s', '--', '--dir', repo, '--no-background', '--no-shortcut', '--no-open'],
        {
          input: readFileSync(new URL('./install.sh', import.meta.url)),
          encoding: 'utf8',
          timeout: 10_000,
          detached: true,
          env: {
            HOME: root,
            PATH: bin,
            TMPDIR: root,
            CONCH_HOME: join(root, 'data'),
            CALLS: join(root, 'calls'),
          },
        },
      );
      const calls = readFileSync(join(root, 'calls'), 'utf8');
      assert.match(output, /no system packages were changed/);
      assert.match(output, /Full terminal ready \(using Python; no native build needed\)/);
      // No DISPLAY here, so it's a computer with no screen (ADR 0064): nothing to open, and
      // with no keyboard either, it says how to choose the way you'll reach Conch later.
      assert.match(output, /Conch is installed\. When you're at a keyboard, run conch setup/);
      assert.ok(
        calls.indexOf('python3 -c') < calls.indexOf('corepack pnpm install --frozen-lockfile'),
      );
      assert.match(calls, /corepack pnpm --filter @conch\/web build/);
      assert.doesNotMatch(calls, /^(sudo|apt-get) /m);
      assert.doesNotMatch(calls, /--ignore-scripts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

// A closed PATH and pretend package manager: tests can never reach real sudo,
// install anything, change a repository, or contact a network. Only the keyboard
// and command's tty attachment are substituted; all setup decisions run in sh.
const PROGRAM = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const root = process.env.FIXTURE;
const log = (line) => fs.appendFileSync(path.join(root, 'calls'), line + '\\n');
const tools = () => {
  if (process.env.NO_TOOLS) return;
  for (const tool of ['make', 'cc', 'c++', 'python3']) {
    fs.copyFileSync(__filename, path.join(root, 'bin', tool));
    fs.chmodSync(path.join(root, 'bin', tool), 0o755);
  }
  fs.writeFileSync(path.join(root, 'xcode'), 'ready');
};
if (name === 'sudo') {
  log([name, ...args].join(' '));
  if (args[0] === '-v') process.exit(process.env.NO_SUDO ? 1 : 0);
  if (args.shift() !== '-n') process.exit(99);
  const command = args.shift();
  const result = require('node:child_process').spawnSync(command, args, { stdio: 'inherit' });
  process.exit(result.status ?? 99);
}
if (name === 'python3' || name === 'python') process.exit(process.env.BAD_PYTHON ? 1 : 0);
if (name === 'xcode-select' && args[0] === '-p') process.exit(fs.existsSync(path.join(root, 'xcode')) ? 0 : 1);
if (['make', 'cc', 'c++', 'sleep'].includes(name)) process.exit(0);
log([name, ...args].join(' '));
if (process.env.FAIL_COMMAND === args[0]) { console.error('fixture: package manager failed'); process.exit(1); }
if (args[0] !== 'update') tools();
`;

function scenario(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'conch-installer-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const programs = options.programs ?? ['apt-get', 'sudo', 'python3'];
  for (const program of programs) writeFileSync(join(bin, program), PROGRAM, { mode: 0o755 });
  if (options.xcode) writeFileSync(join(root, 'xcode'), 'ready');
  try {
    const output = execFileSync(
      '/bin/sh',
      [
        '-c',
        `
      set -eu
      say() { printf '%s\\n' "$*"; }
      ok() { say "OK $*"; }
      warn() { say "WARN $*"; }
      step() { say "$*"; }
      has_keyboard() { [ "$KEYBOARD" = yes ]; }
      ask() { say "$1"; REPLY=$ANSWER; [ "$READ_OK" = yes ]; }
      . "$HELPER"
      terminal_command() { "$@"; }
      ensure_terminal_prerequisites
      ${options.twice ? 'ensure_terminal_prerequisites' : ''}
      say FINISHED
    `,
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          PATH: bin,
          FIXTURE: root,
          HELPER: helper,
          OS: options.os ?? 'linux',
          SYSTEM_PACKAGES: options.skip ? '' : '1',
          KEYBOARD: options.keyboard === false ? 'no' : 'yes',
          ANSWER: options.answer ?? '',
          READ_OK: options.eof ? 'no' : 'yes',
          ...options.env,
        },
      },
    );
    let calls = '';
    try {
      calls = readFileSync(join(root, 'calls'), 'utf8');
    } catch {
      /* No commands. */
    }
    assert.match(output, /FINISHED/);
    return { output, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  'installer syntax and piped help work without Node, Git or a terminal',
  { skip: process.platform === 'win32' },
  () => {
    const installer = fileURLToPath(new URL('./install.sh', import.meta.url));
    execFileSync('/bin/sh', ['-n', installer]);
    execFileSync('/bin/sh', ['-n', helper]);
    const help = execFileSync('/bin/sh', ['-s', '--', '--help'], {
      input: readFileSync(installer),
      encoding: 'utf8',
    });
    assert.match(help, /--no-system-packages/);
  },
);

test('terminal prerequisites', { skip: process.platform === 'win32' }, async (t) => {
  await t.test('does nothing when tools are already installed', () => {
    const { output, calls } = scenario({
      programs: ['make', 'cc', 'c++', 'python3', 'sudo', 'apt-get'],
    });
    assert.match(output, /Terminal build tools ready/);
    assert.equal(calls, '');
    assert.doesNotMatch(output, /Install these/);
  });
  await t.test('shows the plan, asks once, authenticates once, installs, and is idempotent', () => {
    const { output, calls } = scenario({ twice: true });
    assert.match(output, /sudo apt-get install -y build-essential python3/);
    assert.equal(output.match(/Install these tools now/g)?.length, 1);
    assert.equal(
      calls,
      'sudo -v\nsudo -n apt-get update\napt-get update\nsudo -n apt-get install -y build-essential python3\napt-get install -y build-essential python3\n',
    );
    assert.equal(output.match(/OK Terminal build tools ready/g)?.length, 2);
  });
  for (const [name, options] of Object.entries({
    declined: { answer: 'n' },
    'unrecognised answer': { answer: 'maybe' },
    'no controlling terminal': { keyboard: false },
    'end of input': { eof: true },
    'explicit opt-out': { skip: true },
    'no sudo': { programs: ['apt-get', 'python3'] },
  })) {
    await t.test(`uses Python without making changes: ${name}`, () => {
      const { output, calls } = scenario(options);
      assert.match(output, /Continuing with Python/);
      assert.equal(calls, '');
    });
  }
  await t.test('a refused password does not run a package manager', () => {
    const { output, calls } = scenario({ env: { NO_SUDO: '1' } });
    assert.match(output, /Administrator access wasn't granted/);
    assert.equal(calls, 'sudo -v\n');
  });
  for (const step of ['update', 'install']) {
    await t.test(`continues after ${step} fails, without hiding the diagnostic`, () => {
      const { output, calls } = scenario({ env: { FAIL_COMMAND: step } });
      assert.match(output, /Continuing with Python/);
      assert.doesNotMatch(output, /OK Terminal build tools ready/);
      if (step === 'update') assert.doesNotMatch(calls, /apt-get install/);
    });
  }
  await t.test('does not claim success until the tools can be found', () => {
    const { output } = scenario({ env: { NO_TOOLS: '1' } });
    assert.match(output, /some terminal tools still aren't available/);
    assert.doesNotMatch(output, /OK Terminal build tools ready/);
  });
  await t.test('explains basic mode when neither native tools nor Python are available', () => {
    const { output, calls } = scenario({ programs: [] });
    assert.match(output, /basic mode/);
    assert.match(output, /Install Python 3/);
    assert.equal(calls, '');
  });
  await t.test('does not mistake broken Python for a working fallback', () => {
    const { output } = scenario({ answer: 'n', env: { BAD_PYTHON: '1' } });
    assert.match(output, /basic mode/);
  });
  for (const [manager, expected] of Object.entries({
    dnf: 'dnf install -y make gcc gcc-c++ python3',
    pacman: 'pacman -S --needed --noconfirm base-devel python',
    zypper: 'zypper --non-interactive install make gcc gcc-c++ python3',
    apk: 'apk add build-base python3',
  })) {
    await t.test(`supports ${manager} without a distribution-wide upgrade`, () => {
      const { calls } = scenario({ programs: [manager, 'sudo'] });
      assert.equal(calls, `sudo -v\nsudo -n ${expected}\n${expected}\n`);
    });
  }
  await t.test('offers Apple tools and waits for them, rechecking Python before using brew', () => {
    const { output, calls } = scenario({ os: 'darwin', programs: ['xcode-select', 'brew'] });
    assert.equal(calls, 'xcode-select --install\n');
    assert.match(output, /OK Terminal build tools ready/);
  });
  await t.test('gets Python via brew when the Apple tools are already present', () => {
    const { calls } = scenario({
      os: 'darwin',
      programs: ['xcode-select', 'brew', 'make', 'cc', 'c++'],
      xcode: true,
    });
    assert.equal(calls, 'brew install python\n');
  });
  await t.test('never opens Apple dialogs or brew on unattended installations', () => {
    const { output, calls } = scenario({
      os: 'darwin',
      programs: ['xcode-select', 'brew'],
      keyboard: false,
    });
    assert.equal(calls, '');
    assert.match(output, /basic mode/);
  });
});

// ── Releases (ADR 0051) ──────────────────────────────────────────────────

const installerText = readFileSync(new URL('./install.sh', import.meta.url), 'utf8');
/** Just the part that picks a release, run on its own. */
const releasePart = installerText.slice(
  installerText.indexOf('# >>> releases'),
  installerText.indexOf('# <<< releases'),
);
const pick = (tags, channel = 'stable') =>
  execFileSync('/bin/sh', ['-c', `${releasePart}\npick_release "$1"`, 'sh', channel], {
    input: tags.join('\n') + '\n',
    encoding: 'utf8',
  }).trim();

test('picking the release to install', { skip: process.platform === 'win32' }, async (t) => {
  const tags = [
    'v0.2.0',
    'v0.3.0-beta.1',
    'v0.3.0-alpha.4',
    'v0.1.0',
    'nightly',
    'v1.0',
    'v0.2.0-rc.1',
  ];
  await t.test('the newest stable release by default, over a newer beta', () => {
    assert.equal(pick(tags), 'v0.2.0');
  });
  await t.test('beta takes betas and stable releases; alpha takes everything', () => {
    assert.equal(pick(tags, 'beta'), 'v0.3.0-beta.1');
    assert.equal(pick(tags, 'alpha'), 'v0.3.0-beta.1');
    assert.equal(pick(['v0.3.0-alpha.4', 'v0.2.0'], 'alpha'), 'v0.3.0-alpha.4');
    assert.equal(pick(['v0.3.0-alpha.4', 'v0.2.0'], 'beta'), 'v0.2.0');
  });
  await t.test('in semver’s order', () => {
    assert.equal(pick(['v0.9.0', 'v0.10.0', 'v0.2.11']), 'v0.10.0');
    assert.equal(pick(['v0.4.0-beta.2', 'v0.4.0-beta.10', 'v0.3.9'], 'beta'), 'v0.4.0-beta.10');
    assert.equal(pick(['v0.4.0-beta.10', 'v0.4.0'], 'beta'), 'v0.4.0');
  });
  await t.test('nothing when there are no releases', () => {
    assert.equal(pick(['nightly', 'v01.2.3', 'v1.2.3-beta.0']), '');
    assert.equal(pick([]), '');
  });
});

/** Real git with signed tags, and everything else Conch's installer runs pretended. */
function releaseWorld({ tags = [], sign = 'maker' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'conch-install-release-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  const key = (name) => {
    execFileSync('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      name,
      '-f',
      join(root, name),
    ]);
    return { file: join(root, name), pub: readFileSync(join(root, `${name}.pub`), 'utf8') };
  };
  const maker = key('maker');
  const stranger = key('stranger');
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(root, 'clone', '--quiet', origin, work);
  git(work, 'checkout', '--quiet', '-b', 'main');
  const signers = `ada@example.com namespaces="git" ${maker.pub.split(' ').slice(0, 2).join(' ')}\n`;
  const commit = (version) => {
    mkdirSync(join(work, 'release'), { recursive: true });
    writeFileSync(join(work, 'release/allowed_signers'), signers);
    writeFileSync(
      join(work, 'package.json'),
      `{\n  "name": "conch",\n  "version": "${version}"\n}\n`,
    );
    git(work, 'add', '-A');
    git(work, 'commit', '--quiet', '-m', `release: v${version}`);
  };
  for (const name of tags) {
    commit(name.slice(1));
    const by = sign === 'stranger' ? stranger : sign === 'none' ? undefined : maker;
    if (by)
      git(
        work,
        '-c',
        'gpg.format=ssh',
        '-c',
        `user.signingkey=${by.file}`,
        'tag',
        '-s',
        '-m',
        `Conch ${name}`,
        name,
      );
    else git(work, 'tag', '-a', '-m', `Conch ${name}`, name);
  }
  commit('0.9.9-main');
  git(work, 'push', '--quiet', 'origin', 'main', '--tags');

  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const name of [
    'git',
    'ssh-keygen',
    'mktemp',
    'rm',
    'sed',
    'dirname',
    'head',
    'tail',
    'sort',
    'grep',
    'mkdir',
    'cat',
  ]) {
    const path = execFileSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', name], {
      encoding: 'utf8',
    }).trim();
    symlinkSync(path, join(bin, name));
  }
  const stub = `#!${process.execPath}
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
if (name === 'uname') console.log('Linux');
if (name === 'id') console.log('1000');
if (name === 'node' && args[0] === '-v') console.log('v24.0.0');
if (name === 'corepack' && args.includes('tsx')) console.log('python');
`;
  for (const name of ['uname', 'id', 'node', 'corepack'])
    writeFileSync(join(bin, name), stub, { mode: 0o755 });
  const dir = join(root, 'app');
  const install = (extra = {}) => {
    try {
      const output = execFileSync(
        '/bin/sh',
        [
          '-s',
          '--',
          '--dir',
          dir,
          '--no-background',
          '--no-shortcut',
          '--no-open',
          '--no-system-packages',
        ],
        {
          input: installerText,
          encoding: 'utf8',
          timeout: 20_000,
          env: {
            HOME: root,
            PATH: bin,
            TMPDIR: root,
            CONCH_HOME: join(root, 'data'),
            CONCH_REPO: origin,
            GIT_CONFIG_GLOBAL: '/dev/null',
            ...extra,
          },
        },
      );
      return { ok: true, output };
    } catch (error) {
      return { ok: false, output: `${error.stdout}${error.stderr}` };
    }
  };
  const at = () => git(dir, 'describe', '--tags', '--exact-match', 'HEAD');
  return {
    root,
    dir,
    git,
    install,
    at,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('installing a release', { skip: process.platform === 'win32' }, async (t) => {
  await t.test('the newest stable release, checked, detached at its tag', () => {
    const w = releaseWorld({ tags: ['v0.1.0', 'v0.2.0', 'v0.3.0-beta.1'] });
    try {
      const { ok, output } = w.install();
      assert.ok(ok, output);
      assert.equal(w.at(), 'v0.2.0');
      assert.match(output, /Conch 0\.2\.0/);
      assert.doesNotMatch(output, /can't be checked/);
      assert.throws(() => w.git(w.dir, 'symbolic-ref', '-q', 'HEAD'));
      // Run again: it doesn't pull; Conch updates itself.
      const again = w.install();
      assert.match(again.output, /Conch updates itself: Settings → Health → Updates/);
      assert.equal(w.at(), 'v0.2.0');
    } finally {
      w.cleanup();
    }
  });
  await t.test('CONCH_CHANNEL=beta takes the beta, and says so to Conch', () => {
    const w = releaseWorld({ tags: ['v0.2.0', 'v0.3.0-beta.1'] });
    try {
      assert.ok(w.install({ CONCH_CHANNEL: 'beta' }).ok);
      assert.equal(w.at(), 'v0.3.0-beta.1');
      assert.equal(w.git(w.dir, 'config', 'conch.channel'), 'beta');
      assert.equal(w.install({ CONCH_CHANNEL: 'nightly' }).ok, false);
    } finally {
      w.cleanup();
    }
  });
  await t.test(
    'a release signed by someone else stops the installer, leaving nothing behind',
    () => {
      const w = releaseWorld({ tags: ['v0.2.0'], sign: 'stranger' });
      try {
        const { ok, output } = w.install();
        assert.equal(ok, false);
        assert.match(
          output,
          /This release of Conch isn't signed by Conch's makers, so the installer stopped/,
        );
        assert.throws(() => readFileSync(join(w.dir, 'package.json')));
      } finally {
        w.cleanup();
      }
    },
  );
  await t.test('before the first release, main, as before', () => {
    const w = releaseWorld();
    try {
      const { ok, output } = w.install();
      assert.ok(ok, output);
      assert.match(output, /no releases yet/);
      assert.equal(w.git(w.dir, 'symbolic-ref', '--short', 'HEAD'), 'main');
    } finally {
      w.cleanup();
    }
  });
  await t.test('CONCH_BRANCH: a developer’s copy that follows its branch', () => {
    const w = releaseWorld({ tags: ['v0.2.0'] });
    try {
      assert.ok(w.install({ CONCH_BRANCH: 'main' }).ok);
      assert.equal(w.git(w.dir, 'symbolic-ref', '--short', 'HEAD'), 'main');
      assert.equal(w.git(w.dir, 'config', 'conch.follow'), 'branch');
    } finally {
      w.cleanup();
    }
  });
});

test('the Windows installer follows the same releases', () => {
  const ps = readFileSync(new URL('./install.ps1', import.meta.url), 'utf8');
  // Its tag pattern, read as .NET reads it (the same syntax JavaScript has here).
  const pattern = /\[regex\]::Match\("\$tag"\.Trim\(\), "(.+?)"\)/.exec(ps)?.[1];
  assert.ok(pattern);
  const tagRe = new RegExp(
    pattern.replaceAll('$num', '(0|[1-9][0-9]{0,5})').replace(/\?\$$/, '?$'),
  );
  const kind = (tag) => tagRe.exec(tag)?.[4] ?? (tagRe.test(tag) ? 'stable' : undefined);
  assert.equal(kind('v0.3.0'), 'stable');
  assert.equal(kind('v0.3.0-beta.2'), 'beta');
  assert.equal(tagRe.exec('v0.3.0-beta.12')?.[5], '12');
  assert.equal(kind('v01.2.3'), undefined);
  assert.equal(kind('v1.2.3-rc.1'), undefined);
  for (const piece of [
    'conch.follow branch',
    'conch.channel',
    "'versions\\current'",
    'verify-tag',
    'CONCH_CHANNEL',
  ])
    assert.ok(ps.includes(piece), piece);
});

test(
  'offers to seal commands once on Linux, shows the exact command, and runs it only on a yes',
  { skip: process.platform === 'win32' },
  () => {
    const run = (answer, keyboard = 'yes') => {
      const root = mkdtempSync(join(tmpdir(), 'conch-seal-'));
      try {
        const bin = join(root, 'bin');
        mkdirSync(bin);
        const script = join(root, 'app', 'apps/server/src/setup/seal-commands.sh');
        mkdirSync(join(root, 'app', 'apps/server/src/setup'), { recursive: true });
        writeFileSync(
          script,
          `echo "sealed by $(id -u >/dev/null 2>&1; echo script)" >> "${root}/calls"\n`,
        );
        // Not installed yet; `sudo` only records and hands over (never a real password prompt).
        writeFileSync(
          join(bin, 'sudo'),
          `#!/bin/sh\necho "sudo $*" >> "${root}/calls"\nexec "$@"\n`,
          { mode: 0o755 },
        );
        const output = execFileSync(
          '/bin/sh',
          [
            '-c',
            `
        set -eu
        say() { printf '%s\n' "$*"; }
        ok() { say "OK $*"; }
        warn() { say "WARN $*"; }
        step() { say "$*"; }
        has_keyboard() { [ "$KEYBOARD" = yes ]; }
        ask() { say "$1"; REPLY=$ANSWER; true; }
        . "$HELPER"
        terminal_command() { "$@"; }
        ensure_command_sandbox
        say FINISHED
      `,
          ],
          {
            encoding: 'utf8',
            env: {
              PATH: `${bin}:/usr/bin:/bin`,
              HELPER: helper,
              OS: 'linux',
              RUN_DIR: join(root, 'app'),
              SYSTEM_PACKAGES: '1',
              KEYBOARD: keyboard,
              ANSWER: answer,
            },
          },
        );
        let calls = '';
        try {
          calls = readFileSync(join(root, 'calls'), 'utf8');
        } catch {
          /* Nothing ran. */
        }
        return { output, calls, script };
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
    // bwrap on this machine may be real; only when it isn't is there anything to offer.
    const probe = execFileSync('/bin/sh', ['-c', 'command -v bwrap || true'], { encoding: 'utf8' });
    if (probe.trim()) return;
    const yes = run('');
    assert.match(yes.output, /sudo sh .*seal-commands\.sh/);
    assert.match(yes.calls, /^sudo sh .*seal-commands\.sh\nsealed by script/);
    assert.match(yes.output, /FINISHED/);
    const no = run('n');
    assert.equal(no.calls, '');
    assert.match(no.output, /Settings → Health/);
    const unattended = run('', 'no');
    assert.equal(unattended.calls, '');
    assert.match(unattended.output, /Skipped for now/);
  },
);
