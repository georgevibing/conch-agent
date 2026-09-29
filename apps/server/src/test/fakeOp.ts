import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fakeProgram } from './fakeProgram';

/**
 * A stand-in `op` (the 1Password command line tool) for tests. It answers one
 * reference with one value; anything else fails the way the real thing does,
 * with `[ERROR] <date> <message>` on stderr and a non-zero exit.
 */
export async function fakeOp(
  options: { reference?: string; value?: string; locked?: boolean } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-op-'));
  const reference = options.reference ?? 'op://Private/OpenRouter/credential';
  const value = options.value ?? 'sk-or-v1-from-1password';
  const bin = await fakeProgram(
    dir,
    'op',
    `const OPTIONS = ${JSON.stringify({ reference, value, locked: Boolean(options.locked) })};
const [command, target] = process.argv.slice(2);
const fail = (message) => {
  process.stderr.write(\`[ERROR] \${message}\\n\`);
  process.exitCode = 1;
};
if (command === '--version') console.log('2.39.0');
else if (command !== 'read') fail('unknown command');
else if (OPTIONS.locked) {
  fail("2026/09/29 12:00:00 you are not currently signed in. Please run 'op signin'");
} else if (target === OPTIONS.reference) process.stdout.write(OPTIONS.value);
else fail(\`2026/09/29 12:00:00 "\${target}" isn't an item in any vault\`);
`,
  );
  return { bin, dir, reference, value };
}
