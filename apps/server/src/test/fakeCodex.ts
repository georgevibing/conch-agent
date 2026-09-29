/**
 * A stand-in `codex` executable for tests, so they pass on a machine that has
 * never installed Codex.
 *
 * It answers the four things Conch asks of the real program — `--version`,
 * `login status`, `exec --json`, `debug models` / `mcp list` — and records every
 * invocation's arguments and environment, which is how the tests prove that a
 * token reaches the child's environment and never its command line.
 *
 * It lives beside the engine (rather than in `src/test/`) because all three
 * test files here share it.
 */
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeCodexOptions {
  /** What follows `codex ` in `--version`. A git revision stands in for a dev build. */
  version?: string;
  versionFails?: boolean;
  signedIn?: boolean;
  /** Written to `auth.json` in the fake `CODEX_HOME`; omitted models the keyring case. */
  authMode?: string;
  /** JSONL printed by `codex exec --json`. */
  transcript?: string;
  execCode?: number;
  execStderr?: string;
  /** Keep `exec` (or `login`) alive after printing, so it can be interrupted. */
  hangSeconds?: number;
  models?: string;
  mcpList?: string;
  mcpJsonFails?: boolean;
  loginUrl?: string;
  loginCode?: string;
  loginFails?: boolean;
}

export interface FakeCodex {
  bin: string;
  dir: string;
  /** Point `CODEX_HOME` at this to make the fake's credentials the real ones. */
  home: string;
  /** Every invocation's arguments, in order. */
  calls(): Promise<string[][]>;
  /** The environment of the last `exec`, as `printenv` wrote it. */
  env(): Promise<string>;
}

const CALL_MARK = '<<CALL>>';

const DEFAULT_MODELS = JSON.stringify({
  models: [
    {
      id: 'gpt-5.3-codex',
      display_name: 'GPT-5.3 Codex',
      description: 'Best for hard problems.',
      supported_reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'ultra'],
    },
    { id: 'gpt-5.3-codex-mini', display_name: 'Codex Mini', reasoning_efforts: ['low', 'medium'] },
  ],
});

export async function fakeCodex(options: FakeCodexOptions = {}): Promise<FakeCodex> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-codex-'));
  const home = join(dir, 'codex-home');
  await mkdir(home, { recursive: true });
  if (options.authMode) {
    await writeFile(join(home, 'auth.json'), JSON.stringify({ auth_mode: options.authMode }));
  }
  await writeFile(join(dir, 'transcript'), options.transcript ?? '');
  await writeFile(join(dir, 'models'), options.models ?? DEFAULT_MODELS);
  await writeFile(join(dir, 'mcp'), options.mcpList ?? '[]');

  const bin = join(dir, 'codex');
  const version = options.version ?? '0.52.0';
  const script = `#!/bin/sh
DIR='${dir}'
{ printf '%s' '${CALL_MARK}'; printf '%s\\0' "$@"; } >> "$DIR/calls"
case "$1" in
  --version)
${options.versionFails ? '    echo "codex: error: missing shared library" >&2; exit 1' : `    echo "codex ${version}"; exit 0`}
    ;;
  login)
    if [ "$2" = "status" ]; then
${
  options.signedIn
    ? '      echo "Logged in using ChatGPT" >&2; exit 0'
    : '      echo "Not logged in" >&2; exit 1'
}
    fi
    echo "Starting sign-in: ${options.loginUrl ?? 'http://localhost:1455/auth/callback?state=abc'}" >&2
${options.loginCode ? `    echo "Then enter the code ${options.loginCode} on that page." >&2` : ''}
${options.hangSeconds ? `    sleep ${options.hangSeconds}` : ''}
${options.loginFails ? '    echo "error: sign-in was not completed" >&2; exit 1' : '    exit 0'}
    ;;
  exec)
    printenv > "$DIR/env"
    echo "codex: thinking…" >&2
${options.execStderr ? `    echo "${options.execStderr}" >&2` : ''}
    cat "$DIR/transcript"
${options.hangSeconds ? `    sleep ${options.hangSeconds}` : ''}
    exit ${options.execCode ?? 0}
    ;;
  debug)
    cat "$DIR/models"; exit 0
    ;;
  mcp)
    if [ "$3" = "--json" ]; then
${options.mcpJsonFails ? '      echo "error: unexpected argument --json" >&2; exit 2' : '      cat "$DIR/mcp"; exit 0'}
    fi
    echo "Name  Enabled"; exit 0
    ;;
esac
exit 0
`;
  await writeFile(bin, script);
  await chmod(bin, 0o755);

  return {
    bin,
    dir,
    home,
    async calls() {
      const raw = await readFile(join(dir, 'calls'), 'utf8').catch(() => '');
      return raw
        .split(CALL_MARK)
        .filter(Boolean)
        .map((record) => record.split('\0').filter((arg) => arg !== ''));
    },
    env() {
      return readFile(join(dir, 'env'), 'utf8').catch(() => '');
    },
  };
}
