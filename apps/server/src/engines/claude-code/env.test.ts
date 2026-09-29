import { afterEach, describe, expect, it } from 'vitest';

import { childEnv } from './env';

describe('childEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('strips parent Claude Code session variables but keeps provider config', () => {
    process.env.CLAUDECODE = '1';
    process.env.CLAUDE_CODE_SESSION_ID = 'abc';
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    const env = childEnv({ ANTHROPIC_API_KEY: 'k', UNSET: undefined });
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(env.ANTHROPIC_API_KEY).toBe('k');
    expect('UNSET' in env).toBe(false);
  });

  it('never hands Conch’s own settings (like CONCH_TOKEN) to the agent', () => {
    process.env.CONCH_TOKEN = 'secret-secret-secret-secret-secret';
    process.env.CONCH_HOME = '/tmp/x';
    const env = childEnv();
    expect(env.CONCH_TOKEN).toBeUndefined();
    expect(env.CONCH_HOME).toBeUndefined();
  });
});
