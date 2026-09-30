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
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fakeProgram } from './fakeProgram';

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

  const version = options.version ?? '0.52.0';
  const bin = await fakeProgram(
    dir,
    'codex',
    `const fs = require('node:fs');
const path = require('node:path');
const DIR = ${JSON.stringify(dir)};
const OPTIONS = ${JSON.stringify({ ...options, version })};
const args = process.argv.slice(2);
fs.appendFileSync(
  path.join(DIR, 'calls'),
  ${JSON.stringify(CALL_MARK)} + args.map((arg) => arg + '\\0').join(''),
);
const say = (text) => process.stderr.write(text + '\\n');
const print = (file) => process.stdout.write(fs.readFileSync(path.join(DIR, file)));
const fail = (text, code = 1) => {
  say(text);
  process.exitCode = code;
};
const afterHang = (then) =>
  OPTIONS.hangSeconds ? setTimeout(then, OPTIONS.hangSeconds * 1000) : then();
switch (args[0]) {
  case '--version':
    if (OPTIONS.versionFails) fail('codex: error: missing shared library');
    else console.log('codex ' + OPTIONS.version);
    break;
  case 'login':
    if (args[1] === 'status') {
      if (OPTIONS.signedIn) say('Logged in using ChatGPT');
      else fail('Not logged in');
      break;
    }
    say('Starting sign-in: ' + (OPTIONS.loginUrl ?? 'http://localhost:1455/auth/callback?state=abc'));
    if (OPTIONS.loginCode) say('Then enter the code ' + OPTIONS.loginCode + ' on that page.');
    afterHang(() => {
      if (OPTIONS.loginFails) fail('error: sign-in was not completed');
    });
    break;
  case 'exec':
    // Like the real CLI, \`exec resume\` has no --sandbox of its own.
    if (args[1] === 'resume' && args.some((arg) => arg === '--sandbox' || arg === '-s')) {
      fail("error: unexpected argument '--sandbox' found", 2);
      break;
    }
    fs.writeFileSync(
      path.join(DIR, 'env'),
      Object.entries(process.env).map(([key, value]) => key + '=' + value + '\\n').join(''),
    );
    say('codex: thinking…');
    if (OPTIONS.execStderr) say(OPTIONS.execStderr);
    print('transcript');
    afterHang(() => {
      process.exitCode = OPTIONS.execCode ?? 0;
    });
    break;
  case 'debug':
    print('models');
    break;
  case 'mcp':
    if (args[2] !== '--json') console.log('Name  Enabled');
    else if (OPTIONS.mcpJsonFails) fail('error: unexpected argument --json', 2);
    else print('mcp');
    break;
}
`,
  );

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
