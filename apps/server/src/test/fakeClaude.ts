import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A stand-in `claude` executable for tests. Its sign-in state lives in a file
 * so `auth login` can flip it, exactly like the real CLI would.
 */
export async function fakeClaude(options: { loggedIn?: boolean; banner?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-claude-'));
  const state = join(dir, 'state');
  const bin = join(dir, 'claude');
  await writeFile(state, options.loggedIn ? '1' : '0');
  await writeFile(
    bin,
    `#!/bin/sh
STATE="${state}"
${options.banner ? 'echo "claude: info: registering helpers..."' : ''}
case "$1 $2" in
  "--version ") echo "2.1.284 (Claude Code)" ;;
  "auth status")
    if [ "$(cat "$STATE")" = "1" ]; then
      echo '{"loggedIn": true, "authMethod": "claude.ai", "email": "ada@example.com", "subscriptionType": "max"}'
    else
      echo '{"loggedIn": false}'; exit 1
    fi ;;
  "auth login")
    echo "Opening browser to sign in: https://claude.ai/oauth/authorize?code=true&x=1"
    echo "Paste code here if prompted >"
    read code
    if [ "$code" = "good-code" ]; then echo 1 > "$STATE"; exit 0; else echo "Invalid code"; exit 1; fi ;;
esac
`,
  );
  await chmod(bin, 0o755);
  return { bin, dir };
}
