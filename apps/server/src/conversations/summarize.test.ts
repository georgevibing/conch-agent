import { describe, expect, it } from 'vitest';

import { commandTitle, titleOfToolUse } from './summarize';

describe('a command’s heading (ADR 0028, ADR 0108)', () => {
  it('says what the command does in a few words, never the command itself', () => {
    const command = [
      "cd /home/george/pworkspace/conch-agent && git checkout AGENTS.md && python3 - <<'EOF'",
      "p='AGENTS.md'",
      's=open(p).read()',
      'a="""- A step in an app the person made here is their own work"""',
      'EOF',
    ].join('\n');
    const title = commandTitle(command);
    expect(title).toBe('Run git and Python in conch-agent');
    expect(title).not.toMatch(/[`&<]|AGENTS|open\(/);
  });

  it('names the everyday steps as people say them', () => {
    expect(commandTitle('pnpm install && pnpm test')).toBe('Install packages and run the tests');
    expect(commandTitle('npm run build')).toBe('Build the project');
    expect(commandTitle('vitest run src/a.test.ts', '/Users/me/site')).toBe(
      'Run the tests in site',
    );
  });

  it('says where it runs: where it goes first, or the chat’s work folder', () => {
    expect(commandTitle('ls -la', '/Users/me/Projects/notes')).toBe('Run ls in notes');
    expect(commandTitle('cd ~ && ls', '/Users/me/notes')).toBe('Run ls in notes');
    expect(commandTitle('cd "$HOME" && ls')).toBe('Run ls');
  });

  it('falls back to a plain phrase when nothing in it has a name', () => {
    expect(commandTitle('cd src && echo hi')).toBe('Run a command in src');
    expect(commandTitle('a; b; c; d')).toBe('Run 4 commands');
  });

  it('is the title of shell steps only', () => {
    expect(titleOfToolUse('Bash', { command: 'git status' })).toBe('Run git');
    expect(titleOfToolUse('mcp__conch__process_start', { command: 'npm test' })).toBe(
      'Run the tests',
    );
    expect(titleOfToolUse('Read', { file_path: '/x' })).toBeUndefined();
  });
});
