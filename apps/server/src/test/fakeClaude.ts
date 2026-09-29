import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fakeProgram } from './fakeProgram';

/**
 * A stand-in `claude` executable for tests. Its sign-in state lives in a file
 * so `auth login` can flip it, exactly like the real CLI would.
 */
export async function fakeClaude(options: { loggedIn?: boolean; banner?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-claude-'));
  const state = join(dir, 'state');
  await writeFile(state, options.loggedIn ? '1' : '0');
  const bin = await fakeProgram(
    dir,
    'claude',
    `const fs = require('node:fs');
const STATE = ${JSON.stringify(state)};
const [first = '', second = ''] = process.argv.slice(2);
${options.banner ? `console.log('claude: info: registering helpers...');` : ''}
switch (\`\${first} \${second}\`) {
  case '--version ':
    console.log('2.1.284 (Claude Code)');
    break;
  case 'auth status':
    if (fs.readFileSync(STATE, 'utf8').trim() === '1') {
      console.log('{"loggedIn": true, "authMethod": "claude.ai", "email": "ada@example.com", "subscriptionType": "max"}');
    } else {
      console.log('{"loggedIn": false}');
      process.exitCode = 1;
    }
    break;
  case 'auth login': {
    console.log('Opening browser to sign in: https://claude.ai/oauth/authorize?code=true&x=1');
    console.log('Paste code here if prompted >');
    let input = '';
    let answered = false;
    const answer = () => {
      if (answered) return;
      answered = true;
      process.stdin.destroy();
      if (input.split('\\n')[0].trim() === 'good-code') {
        fs.writeFileSync(STATE, '1');
      } else {
        console.log('Invalid code');
        process.exitCode = 1;
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
      if (input.includes('\\n')) answer();
    });
    process.stdin.on('end', answer);
    break;
  }
}
`,
  );
  return { bin, dir };
}
