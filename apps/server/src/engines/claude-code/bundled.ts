import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const PACKAGE = '@anthropic-ai/claude-agent-sdk';

/** Linux builds link against glibc or musl; a musl system can't start the glibc one. */
function isMusl(): boolean {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } };
  return report.header?.glibcVersionRuntime === undefined;
}

/** The platform packages to look in, best first — the order the Agent SDK itself uses. */
export function bundledCandidates(
  os: NodeJS.Platform = platform(),
  cpu: string = arch(),
  musl = os === 'linux' && isMusl(),
): string[] {
  const exe = os === 'win32' ? '.exe' : '';
  const packages =
    os === 'linux'
      ? musl
        ? [`${PACKAGE}-linux-${cpu}-musl`, `${PACKAGE}-linux-${cpu}`]
        : [`${PACKAGE}-linux-${cpu}`, `${PACKAGE}-linux-${cpu}-musl`]
      : [`${PACKAGE}-${os}-${cpu}`];
  return packages.map((name) => `${name}/claude${exe}`);
}

/**
 * The Claude Code that comes with the Agent SDK Conch runs on: the SDK ships
 * the native CLI as a per-platform optional dependency. With it, Claude Code
 * needs no separate install — only a sign-in.
 */
export function bundledClaude(): string | undefined {
  let sdk: string;
  try {
    sdk = fileURLToPath(import.meta.resolve(PACKAGE));
  } catch {
    return undefined;
  }
  const fromSdk = createRequire(sdk);
  for (const candidate of bundledCandidates()) {
    try {
      const path = fromSdk.resolve(candidate);
      if (existsSync(path)) return path;
    } catch {
      // Not installed for this platform (npm skips other platforms' packages).
    }
  }
  return undefined;
}
