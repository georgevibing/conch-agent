import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { childEnv, QUIET, settingsEnv } from './env';

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

  it('turns off the background calls Conch never shows', () => {
    process.env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !(key in QUIET)),
    );
    const env = childEnv();
    expect(env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE).toBe('1');
    expect(env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION).toBe('false');
    expect(env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY).toBe('0');
    expect(env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES).toBe('0');
  });

  it('lets a value the person set themselves win over those defaults', () => {
    process.env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY = '1';
    process.env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES = '15';
    const env = childEnv();
    expect(env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY).toBe('1');
    expect(env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES).toBe('15');
    expect(env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE).toBe('1');
  });

  it('quiets only those four, nothing that changes the answer', () => {
    expect(Object.keys(QUIET).sort()).toEqual([
      'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
      'CLAUDE_CODE_ENABLE_AWAY_SUMMARY',
      'CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION',
      'CLAUDE_CODE_GOAL_CHECKIN_MINUTES',
    ]);
  });
});

describe('settingsEnv', () => {
  it('reads only the string values of Claude Code’s own settings env, never Conch’s', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-claude-settings-'));
    try {
      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
          env: { HTTPS_PROXY: 'http://proxy:8080', CONCH_TOKEN: 'x', COUNT: 3 },
          hooks: { SessionStart: [] },
        }),
      );
      expect(await settingsEnv({ CLAUDE_CONFIG_DIR: dir })).toEqual({
        HTTPS_PROXY: 'http://proxy:8080',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is empty when there are no settings, or they are not JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-claude-settings-'));
    try {
      expect(await settingsEnv({ CLAUDE_CONFIG_DIR: dir })).toEqual({});
      await writeFile(join(dir, 'settings.json'), '{ not json');
      expect(await settingsEnv({ CLAUDE_CONFIG_DIR: dir })).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
