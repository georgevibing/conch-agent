import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  autostartEntry,
  carriedEnv,
  desktopQuote,
  launchdPlist,
  serviceLabel,
  shellLauncher,
  shQuote,
  systemdQuote,
  systemdUnit,
  windowsHidden,
  windowsLauncher,
  type LaunchSpec,
} from './files';

const run = promisify(execFile);
const posix = process.platform !== 'win32';
/** A Node where the launcher always looks: "no Node at all" can't be pretended here. */
const systemNode = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].some((p) =>
  existsSync(p),
);

/** The paths people really have. */
const AWKWARD = `it's a "test" $HOME %PATH% \`x\` ü`;

describe('quoting', () => {
  it('keeps every character literal in sh', async () => {
    if (!posix) return;
    const { stdout } = await run('/bin/sh', ['-c', `printf %s ${shQuote(AWKWARD)}`]);
    expect(stdout).toBe(AWKWARD);
  });

  it('escapes systemd specifiers and variables', () => {
    expect(systemdQuote('/a b/$HOME/100%/"q"\\')).toBe('"/a b/$$HOME/100%%/\\"q\\"\\\\"');
  });

  it('escapes desktop-entry Exec arguments', () => {
    expect(desktopQuote('/a "b"/$x/`y`/50%')).toBe('"/a \\"b\\"/\\$x/\\`y\\`/50%%"');
  });

  it('XML-escapes the plist', () => {
    const plist = launchdPlist('app.conch.gateway', '/Users/a&b/<x>/Conch', '/tmp/log');
    expect(plist).toContain('<string>/Users/a&amp;b/&lt;x&gt;/Conch</string>');
    expect(plist).not.toContain('a&b');
  });

  it('doubles % in batch files and quotes in VBScript', () => {
    const cmd = windowsLauncher({
      checkout: 'C:\\Users\\100% me\\Conch',
      home: 'C:\\Users\\me\\.conch',
      node: 'C:\\node.exe',
      log: 'C:\\log.txt',
      env: {},
      path: 'C:\\bin',
    });
    expect(cmd).toContain('set "CHECKOUT=C:\\Users\\100%% me\\Conch"');
    // A release swapped in (ADR 0051) is read from its pointer file: no symlink needed.
    expect(cmd).toContain(
      'if exist "%CONCH_HOME%\\versions\\current" set /p CURRENT=<"%CONCH_HOME%\\versions\\current"',
    );
    expect(cmd).toContain('cd /d "%CHECKOUT%\\apps\\server"');
    expect(cmd).toContain('\r\n');
    expect(windowsHidden('C:\\a "b"\\conch.cmd')).toBe(
      'CreateObject("WScript.Shell").Run """C:\\a ""b""\\conch.cmd""", 0, False\r\n',
    );
  });
});

describe('the launchd agent', () => {
  it('is a plist macOS accepts', async () => {
    if (process.platform !== 'darwin') return;
    const dir = mkdtempSync(join(tmpdir(), 'conch-plist-'));
    const file = join(dir, 'a.plist');
    writeFileSync(file, launchdPlist('app.conch.gateway', `/Users/x/${AWKWARD}/Conch`, '/tmp/l'));
    await expect(run('plutil', ['-lint', file])).resolves.toBeTruthy();
    const { stdout } = await run('plutil', ['-extract', 'ProgramArguments.0', 'raw', file]);
    expect(stdout.trim()).toBe(`/Users/x/${AWKWARD}/Conch`);
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts at login and after a crash, never after you quit', () => {
    const plist = launchdPlist('app.conch.gateway', '/x/Conch', '/x/log');
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/);
  });
});

describe('the systemd unit and autostart entry', () => {
  it('restarts on failure, but not when Node is missing', () => {
    const unit = systemdUnit('/home/me/.conch/background/Conch');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('RestartPreventExitStatus=78');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('has no window', () => {
    expect(autostartEntry('/x/Conch')).toContain('Terminal=false');
  });
});

describe('carriedEnv', () => {
  it('keeps network settings and proxies, never a proxy with a password', () => {
    expect(
      carriedEnv({
        CONCH_HOST: '0.0.0.0',
        CONCH_ALLOW_REMOTE: '1',
        HTTPS_PROXY: 'http://proxy:8080',
        HTTP_PROXY: 'http://me:secret@proxy:8080',
        ANTHROPIC_API_KEY: 'not-a-real-key',
        CONCH_TOKEN: 'nope-nope-nope-nope',
      }),
    ).toEqual({ CONCH_HOST: '0.0.0.0', CONCH_ALLOW_REMOTE: '1', HTTPS_PROXY: 'http://proxy:8080' });
  });
});

describe('serviceLabel', () => {
  it('is the plain label for the usual home, and its own for another', () => {
    expect(serviceLabel('/h/.conch', '/h/.conch')).toBe('app.conch.gateway');
    expect(serviceLabel('/tmp/test', '/h/.conch')).toMatch(/^app\.conch\.gateway\.[0-9a-f]{8}$/);
    expect(serviceLabel('/tmp/test', '/h/.conch')).toBe(serviceLabel('/tmp/test', '/h/.conch'));
  });
});

/** The launcher, run for real against a pretend Node. */
describe.skipIf(!posix)('the shell launcher', () => {
  let root: string;
  let spec: LaunchSpec;
  const fakeNode = (path: string, major: number) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(
      path,
      `#!/bin/sh
if [ "$1" = "-e" ]; then [ ${major} -ge 24 ]; exit $?; fi
{ echo "node=$0"; echo "args=$*"; echo "cwd=$(pwd)"; echo "home=$CONCH_HOME"; echo "bg=$CONCH_BACKGROUND"; echo "host=$CONCH_HOST"; } > "$CONCH_HOME/ran"
`,
    );
    chmodSync(path, 0o755);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conch-launch-'));
    const checkout = join(root, `Conch ${AWKWARD}`);
    mkdirSync(join(checkout, 'apps', 'server'), { recursive: true });
    const home = join(root, 'home');
    mkdirSync(home);
    spec = {
      checkout,
      home,
      node: join(root, 'node-24', 'node'),
      log: join(home, 'logs', 'conch.log'),
      env: { CONCH_HOST: '0.0.0.0' },
      // Nothing else to find a Node on.
      path: '/usr/bin:/bin',
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const launch = async () => {
    const file = join(root, 'Conch');
    writeFileSync(file, shellLauncher(spec), { mode: 0o700 });
    try {
      await run('/bin/sh', [file], { env: { HOME: join(root, 'nohome'), PATH: '/usr/bin:/bin' } });
      return 0;
    } catch (error) {
      return (error as { code: number }).code;
    }
  };

  it('starts Conch with the Node it was given, from the server folder', async () => {
    fakeNode(spec.node, 24);
    expect(await launch()).toBe(0);
    const ran = readFileSync(join(spec.home, 'ran'), 'utf8');
    expect(ran).toContain(`node=${spec.node}`);
    expect(ran).toContain('args=--import tsx src/start.ts');
    expect(ran).toContain(`cwd=${join(spec.checkout, 'apps', 'server')}`);
    expect(ran).toContain('bg=1');
    expect(ran).toContain('host=0.0.0.0');
    expect(readFileSync(spec.log, 'utf8')).toContain('Conch is starting in the background');
  });

  it('starts the release swapped in, and the checkout when the pointer names no Conch', async () => {
    fakeNode(spec.node, 24);
    const release = join(spec.home, 'versions', '0.3.0');
    mkdirSync(join(release, 'apps', 'server', 'src'), { recursive: true });
    writeFileSync(join(release, 'apps', 'server', 'src', 'start.ts'), '');
    writeFileSync(join(spec.home, 'versions', 'current'), `${release}\n`);
    expect(await launch()).toBe(0);
    expect(readFileSync(join(spec.home, 'ran'), 'utf8')).toContain(
      `cwd=${join(release, 'apps', 'server')}`,
    );
    writeFileSync(join(spec.home, 'versions', 'current'), `${join(spec.home, 'gone')}\n`);
    expect(await launch()).toBe(0);
    expect(readFileSync(join(spec.home, 'ran'), 'utf8')).toContain(
      `cwd=${join(spec.checkout, 'apps', 'server')}`,
    );
  });

  it('finds a Node on its PATH when the one it was given is gone', async () => {
    const elsewhere = join(root, 'bin', 'node');
    fakeNode(elsewhere, 25);
    spec.path = `${join(root, 'bin')}:/usr/bin:/bin`;
    expect(await launch()).toBe(0);
    expect(readFileSync(join(spec.home, 'ran'), 'utf8')).toContain(`node=${elsewhere}`);
  });

  it('passes over a Node that is too old', async () => {
    fakeNode(spec.node, 22);
    const newer = join(root, 'bin', 'node');
    fakeNode(newer, 24);
    spec.path = `${join(root, 'bin')}:/usr/bin:/bin`;
    expect(await launch()).toBe(0);
    expect(readFileSync(join(spec.home, 'ran'), 'utf8')).toContain(`node=${newer}`);
  });

  it.skipIf(systemNode)('says what is missing when there is no Node at all', async () => {
    expect(await launch()).toBe(78);
    expect(readFileSync(spec.log, 'utf8')).toMatch(/needs Node\.js 24 or newer/);
  });

  it('says so when Conch’s folder moved', async () => {
    fakeNode(spec.node, 24);
    rmSync(spec.checkout, { recursive: true });
    expect(await launch()).toBe(78);
    expect(readFileSync(spec.log, 'utf8')).toMatch(/folder isn't at/);
  });

  it('keeps its log to a few megabytes', async () => {
    fakeNode(spec.node, 24);
    mkdirSync(join(spec.home, 'logs'));
    writeFileSync(spec.log, 'x'.repeat(5_000_001));
    expect(await launch()).toBe(0);
    expect(readFileSync(spec.log, 'utf8').length).toBeLessThan(1000);
    expect(readFileSync(`${spec.log}.1`, 'utf8').length).toBe(5_000_001);
  });
});

describe.skipIf(!posix)('the launcher’s log', () => {
  it('is readable by its owner only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'conch-umask-'));
    const spec: LaunchSpec = {
      checkout: join(root, 'missing'),
      home: root,
      node: '/nowhere/node',
      log: join(root, 'logs', 'conch.log'),
      env: {},
      path: '/usr/bin:/bin',
    };
    writeFileSync(join(root, 'Conch'), shellLauncher(spec));
    await run('/bin/sh', [join(root, 'Conch')]).catch(() => undefined);
    const { statSync } = await import('node:fs');
    expect(statSync(spec.log).mode & 0o077).toBe(0);
    expect(statSync(join(root, 'logs')).mode & 0o077).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
});
