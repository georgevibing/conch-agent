/**
 * Version numbers, as programs print them and package managers list them.
 *
 * Programs say their version in many ways — `2.1.284 (Claude Code)`,
 * `codex-cli 0.46.0`, `uv 0.8.3 (7e2a3c9 2025-07-24)`, `Docker version 27.3.1,
 * build ce12230` — so the first dotted number is the version. Comparison is
 * semver's: numbers part by part (missing parts are zero), and a pre-release
 * (`1.0.0-beta.2`) comes before its release.
 */

const VERSION = /(?<![\w.])v?(\d+(?:\.\d+)+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)(?:\+[0-9A-Za-z.-]+)?/;

/** The first version number in a program's output, without a leading `v` or build metadata. */
export function parseVersion(text: string): string | undefined {
  return VERSION.exec(text)?.[1];
}

interface Parts {
  numbers: number[];
  pre: string[];
}

function parts(version: string): Parts {
  const bare = version.trim().replace(/^v/i, '').split('+')[0] ?? '';
  const [core = '', ...rest] = bare.split('-');
  return {
    numbers: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
    pre: rest.length ? rest.join('-').split('.') : [],
  };
}

/** Semver's order for pre-release identifiers: numbers below words, then shorter first. */
function comparePre(a: string[], b: string[]): number {
  if (!a.length || !b.length) return a.length ? -1 : b.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : undefined;
    const ny = /^\d+$/.test(y) ? Number(y) : undefined;
    if (nx !== undefined && ny !== undefined) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (nx !== undefined) return -1;
    else if (ny !== undefined) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Negative when `a` is older than `b`, positive when newer, 0 when the same. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.numbers.length, y.numbers.length); i++) {
    const d = (x.numbers[i] ?? 0) - (y.numbers[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return comparePre(x.pre, y.pre);
}

/** A newer version than the one installed is out. */
export function isNewer(latest: string | undefined, installed: string | undefined): boolean {
  return Boolean(latest && installed && compareVersions(latest, installed) > 0);
}

/** For sentences: `0.160.0` reads as `0.160`; `2.1.284` stays as it is. */
export function shortVersion(version: string): string {
  return version.replace(/^(\d+\.\d+)\.0$/, '$1');
}
