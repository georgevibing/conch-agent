import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A stand-in `op` (the 1Password command line tool) for tests. It answers one
 * reference with one value; anything else fails the way the real thing does,
 * with `[ERROR] <date> <message>` on stderr and a non-zero exit.
 */
export async function fakeOp(
  options: { reference?: string; value?: string; locked?: boolean } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-op-'));
  const bin = join(dir, 'op');
  const reference = options.reference ?? 'op://Private/OpenRouter/credential';
  const value = options.value ?? 'sk-or-v1-from-1password';
  await writeFile(
    bin,
    `#!/bin/sh
case "$1" in
  "--version") echo "2.39.0" ;;
  "read")
    ${
      options.locked
        ? `echo "[ERROR] 2026/09/29 12:00:00 you are not currently signed in. Please run 'op signin'" >&2; exit 1 ;;`
        : `if [ "$2" = "${reference}" ]; then printf '%s' "${value}"; else
      echo "[ERROR] 2026/09/29 12:00:00 \\"$2\\" isn't an item in any vault" >&2; exit 1; fi ;;`
    }
  *) echo "[ERROR] unknown command" >&2; exit 1 ;;
esac
`,
  );
  await chmod(bin, 0o755);
  return { bin, dir, reference, value };
}
