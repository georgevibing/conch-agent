import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RunResult } from '../lib/proc';
import { launchdPlist } from './files';
import {
  HOST_SOURCE,
  hostApp,
  hostPlist,
  hostProgram,
  hostStartLine,
  MacHost,
  type HostExec,
} from './host';
import { iconIn } from './shortcut';

const run = promisify(execFile);
const checkout = resolve(import.meta.dirname, '../../../..');
const mac = process.platform === 'darwin';
const tools = mac && spawnSync('xcode-select', ['-p']).status === 0;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conch-host-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ok = (stdout = ''): RunResult => ({ stdout, stderr: '', code: 0 });

/** A pretend Mac: clang leaves a file where it was told to, the rest succeeds. */
function pretend(answers: Partial<Record<string, RunResult>> = {}) {
  const execs: string[] = [];
  const exec: HostExec = async (file, args) => {
    execs.push([file, ...args].join(' '));
    const answer = answers[file];
    if (answer) return answer;
    if (file === 'xcrun') writeFileSync(args[args.indexOf('-o') + 1] ?? '', '#!/bin/sh\n');
    return ok('/Library/Developer/CommandLineTools\n');
  };
  return { exec, execs, builds: () => execs.filter((e) => e.startsWith('xcrun clang')).length };
}

describe('the host', () => {
  it('names itself Conch, with no path or version that would change its signature', () => {
    const plist = hostPlist();
    expect(plist).toContain('<string>Conch</string>');
    expect(plist).toContain('<key>LSBackgroundOnly</key>');
    expect(plist + HOST_SOURCE).not.toMatch(/\/Users\/|\d+\.\d+\.\d+/);
  });

  it('builds once, and again only when what it is changes', async () => {
    const home = join(root, 'home');
    const first = pretend();
    expect(await new MacHost({ home, icon: iconIn(checkout), exec: first.exec }).ensure()).toBe(
      hostProgram(hostApp(home)),
    );
    expect(first.builds()).toBe(1);
    expect(first.execs).toContainEqual(expect.stringMatching(/^codesign --force --sign - /));

    // A later start finds it built.
    const again = pretend();
    const healed: string[] = [];
    const host = new MacHost({
      home,
      icon: iconIn(checkout),
      exec: again.exec,
      heal: (m) => healed.push(m),
    });
    await host.ensure();
    await host.ensure();
    expect(again.builds()).toBe(0);
    expect(healed).toEqual([]);

    // A host that changed is built again, and the person hears macOS may ask once more.
    writeFileSync(join(home, 'host', 'built'), 'older');
    const changed = pretend();
    await new MacHost({
      home,
      icon: iconIn(checkout),
      exec: changed.exec,
      heal: (m) => healed.push(m),
    }).ensure();
    expect(changed.builds()).toBe(1);
    expect(healed).toHaveLength(1);
  });

  it('starts Conch as before without the Command Line Tools, or when signing fails', async () => {
    const home = join(root, 'home');
    const noTools = pretend({ 'xcode-select': { stdout: '', stderr: 'no', code: 2 } });
    expect(await new MacHost({ home, icon: '', exec: noTools.exec }).ensure()).toBeUndefined();
    expect(noTools.builds()).toBe(0);

    const unsigned = pretend({ codesign: { stdout: '', stderr: 'no', code: 1 } });
    expect(await new MacHost({ home, icon: '', exec: unsigned.exec }).ensure()).toBeUndefined();
    expect(existsSync(hostProgram(hostApp(home)))).toBe(false);
  });

  it('opens the host to start Conch, and starts it plainly without one', async () => {
    expect(hostStartLine(undefined, '"$START"')).toBe('nohup /bin/sh "$START" >/dev/null 2>&1 &');
    const line = hostStartLine("/Users/o'k/.conch/host/Conch.app", '"$START"');
    expect(line).toContain(
      `/usr/bin/open -n -g -a '/Users/o'\\''k/.conch/host/Conch.app' --args /bin/sh "$START"`,
    );
    expect(line).toContain('else nohup /bin/sh "$START" >/dev/null 2>&1 & fi');
    if (process.platform !== 'win32') await run('/bin/sh', ['-n', '-c', line]);
  });

  it('is what launchd runs, with the launcher as its child', async () => {
    const plist = launchdPlist('app.conch.gateway', '/h/Conch', '/tmp/l', '/h/host/Conch');
    expect(plist).toContain(
      '<string>/h/host/Conch</string>\n    <string>/bin/sh</string>\n    <string>/h/Conch</string>',
    );
    if (!mac) return;
    const file = join(root, 'a.plist');
    writeFileSync(file, plist);
    await run('plutil', ['-lint', file]);
  });

  it.skipIf(!tools)(
    'builds for real, and ends the way what it started ended',
    async () => {
      const home = join(root, 'home');
      const program = await new MacHost({ home, icon: iconIn(checkout) }).ensure();
      if (!program) throw new Error('The host didn’t build.');
      const sign = await run('codesign', ['-dv', hostApp(home)]).catch(
        (e: { stderr: string }) => e,
      );
      expect(sign.stderr).toContain('Identifier=app.conch.host');
      expect(existsSync(join(hostApp(home), 'Contents', 'Resources', 'Conch.icns'))).toBe(true);
      expect(spawnSync(program, ['/bin/sh', '-c', 'exit 7']).status).toBe(7);
      expect(spawnSync(program, ['/bin/sh', '-c', 'kill -TERM $$']).signal).toBe('SIGTERM');
      expect(spawnSync(program, []).status).toBe(64);
      // What it starts knows it was hosted, so Settings names Conch for the switches.
      expect(spawnSync(program, ['/bin/sh', '-c', 'echo $CONCH_HOSTED']).stdout.toString()).toBe(
        '1\n',
      );
      expect(readFileSync(join(home, 'host', 'host.c'), 'utf8')).toBe(HOST_SOURCE);
    },
    60_000,
  );
});
