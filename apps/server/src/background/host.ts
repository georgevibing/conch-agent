/**
 * Conch by name in a Mac's Privacy & Security (ADR 0026, "Conch's own name").
 *
 * macOS lists a permission (Screen Recording, Accessibility, Automation, Local
 * Network) under the program *responsible* for the one asking: the process
 * launchd or the Finder started, whose children it answers for. Started as
 * Node, Conch shows up there as "node", with no picture. So on a Mac every
 * background Conch starts through this host: a small app bundle named Conch,
 * with Conch's icon, whose one program starts the launcher as its child and
 * waits for it. Everything below it — the gateway, its `osascript`, the
 * programs it runs — is then Conch's.
 *
 * The program is built here from fixed C source with Apple's Command Line
 * Tools and signed for this computer only (`codesign -s -`): nothing is
 * downloaded, so Gatekeeper has nothing to check. Its source and Info.plist
 * never carry a path or a version, because macOS remembers a permission by the
 * signature, and a rebuilt host would have to be allowed again. It is rebuilt
 * only when one of them changes. Without the tools, Conch starts as before.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeFileAtomic } from '../lib/fs';
import { run, type RunResult } from '../lib/proc';
import { shQuote } from './files';

export type HostExec = (file: string, args: string[], timeout?: number) => Promise<RunResult>;

const exec: HostExec = (file, args, timeout = 30_000) => run(file, args, { timeout });

/** Build `Conch.icns` from the 1024 px PNG with the Mac's own tools (sips, iconutil). */
export async function macIcns(png: string, out: string, runner: HostExec): Promise<boolean> {
  if (!existsSync(png)) return false;
  const set = join(await mkdtemp(join(tmpdir(), 'conch-icon-')), 'Conch.iconset');
  await mkdir(set);
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const [scale, suffix] of [
        [1, ''],
        [2, '@2x'],
      ] as const) {
        const px = String(size * scale);
        const result = await runner('sips', [
          '-z',
          px,
          px,
          png,
          '--out',
          join(set, `icon_${size}x${size}${suffix}.png`),
        ]);
        if (result.code !== 0) return false;
      }
    }
    return (await runner('iconutil', ['-c', 'icns', set, '-o', out])).code === 0;
  } finally {
    await rm(join(set, '..'), { recursive: true, force: true });
  }
}

/** Where the host lives: beside Always on's launcher, but kept when that's off. */
export const hostDir = (home: string) => join(home, 'host');
export const hostApp = (home: string) => join(hostDir(home), 'Conch.app');
export const hostProgram = (app: string) => join(app, 'Contents', 'MacOS', 'Conch');

/**
 * `Conch <program> [args…]`: starts the program as its child, passes on the
 * signals launchd and Quit send, and ends the way the child ended, so
 * launchd's "start it again unless it exited cleanly" still sees the truth.
 * `CONCH_HOSTED=1` tells Conch whose name its switches are under.
 * A child, not `exec`: macOS keeps the responsible program by process, and
 * after an `exec` that would be Node again.
 */
export const HOST_SOURCE = String.raw`/* Conch's host on a Mac. Written by Conch; changes here don't last. */
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
static pid_t child = 0;

static void pass(int sig) {
  if (child > 0) kill(child, sig);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "Conch: nothing to start\n");
    return 64;
  }
  int sigs[] = {SIGTERM, SIGINT, SIGHUP, SIGQUIT, SIGUSR1, SIGUSR2};
  for (unsigned i = 0; i < sizeof sigs / sizeof *sigs; i++) signal(sigs[i], pass);
  setenv("CONCH_HOSTED", "1", 1);
  int err = posix_spawn(&child, argv[1], NULL, NULL, argv + 1, environ);
  if (err != 0) {
    errno = err;
    perror("Conch");
    return 78;
  }
  int status;
  while (waitpid(child, &status, 0) < 0)
    if (errno != EINTR) return 1;
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) {
    signal(WTERMSIG(status), SIG_DFL);
    raise(WTERMSIG(status));
  }
  return 1;
}
`;

/** No Dock icon and no menu: a host is never seen except by name. */
export function hostPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Conch</string>
  <key>CFBundleDisplayName</key>
  <string>Conch</string>
  <key>CFBundleIdentifier</key>
  <string>app.conch.host</string>
  <key>CFBundleExecutable</key>
  <string>Conch</string>
  <key>CFBundleIconFile</key>
  <string>Conch</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSBackgroundOnly</key>
  <true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>Conch uses your apps for you when you ask it to.</string>
</dict>
</plist>
`;
}

/**
 * The line a start script uses to run `launch` (a shell word, already quoted)
 * in the background: through the
 * host when it's there (LaunchServices starts it, so it answers for itself),
 * as before when it isn't.
 */
export function hostStartLine(app: string | undefined, launch: string): string {
  const plain = `nohup /bin/sh ${launch} >/dev/null 2>&1 &`;
  if (!app) return plain;
  const host = shQuote(app);
  return `if [ -x ${shQuote(hostProgram(app))} ] && /usr/bin/open -n -g -a ${host} --args /bin/sh ${launch}; then :; else ${plain} fi`;
}

export class MacHost {
  #ready?: Promise<string | undefined>;

  constructor(
    private readonly options: {
      home: string;
      /** Conch's icon (1024 px PNG). */
      icon: string;
      exec?: HostExec;
      heal?: (message: string) => void;
    },
  ) {}

  /** The bundle start scripts open. */
  get app(): string {
    return hostApp(this.options.home);
  }

  /**
   * The host's program, built if it isn't yet (once per run of Conch), or
   * undefined when it can't be: then Conch starts as Node, as it always did.
   * Never throws.
   */
  ensure(): Promise<string | undefined> {
    this.#ready ??= this.#build().catch(() => undefined);
    return this.#ready;
  }

  async #build(): Promise<string | undefined> {
    const runner = this.options.exec ?? exec;
    const dir = hostDir(this.options.home);
    const contents = join(this.app, 'Contents');
    const program = hostProgram(this.app);
    const plist = hostPlist();
    const stamp = join(dir, 'built');
    const want = `${HOST_SOURCE}\n${plist}`;
    if (existsSync(program) && (await readFile(stamp, 'utf8').catch(() => '')) === want)
      return program;
    if ((await runner('xcode-select', ['-p'])).code !== 0) return undefined;
    await mkdir(join(contents, 'MacOS'), { recursive: true, mode: 0o700 });
    await mkdir(join(contents, 'Resources'), { recursive: true });
    const source = join(dir, 'host.c');
    await writeFile(source, HOST_SOURCE);
    await writeFileAtomic(join(contents, 'Info.plist'), plist, 0o644);
    const icns = join(contents, 'Resources', 'Conch.icns');
    if (!existsSync(icns)) await macIcns(this.options.icon, icns, runner);
    const built = await runner('xcrun', ['clang', '-O2', '-o', program, source], 120_000);
    const signed =
      built.code === 0 &&
      (
        await runner('codesign', [
          '--force',
          '--sign',
          '-',
          '--identifier',
          'app.conch.host',
          this.app,
        ])
      ).code === 0;
    if (!signed) {
      await rm(program, { force: true });
      return undefined;
    }
    const first = !existsSync(stamp);
    await writeFile(stamp, want);
    if (!first)
      this.options.heal?.(
        'Conch’s host on this Mac changed, so macOS may ask once more before Conch can see or use your screen.',
      );
    return program;
  }
}
