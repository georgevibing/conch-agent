import { describe, expect, it } from 'vitest';

import {
  CheckupFixBody,
  CheckupItem,
  PASSWORD_MIN,
  SignInBody,
  checkPassword,
  estimateBits,
  looksLikeAccessKey,
  suggestPassword,
} from './access';
import { Id } from './common';
import { ClientCommand, LoginCodeBody } from './index';

describe('password policy', () => {
  it('requires 15 characters and counts code points, not UTF-16 units', () => {
    expect(checkPassword('short one').ok).toBe(false);
    expect(checkPassword('🐚'.repeat(PASSWORD_MIN - 1)).ok).toBe(false);
    expect(checkPassword('a'.repeat(PASSWORD_MIN - 1)).label).toBe('Too short');
  });

  it('has no composition rules — a lowercase sentence is fine', () => {
    const check = checkPassword('purple otters juggle at dawn');
    expect(check.ok).toBe(true);
    expect(check.score).toBeGreaterThanOrEqual(3);
  });

  it('rejects common, repeated and sequential passwords with a reason', () => {
    for (const bad of [
      'passwordpassword',
      'PasswordPassword',
      'qwertyuiopasdfgh',
      'abcabcabcabcabcabc',
      'aaaaaaaaaaaaaaaaaaaa',
      'abcdefghijklmnopq',
      '123456789012345',
    ]) {
      const check = checkPassword(bad);
      expect(check.ok, bad).toBe(false);
      expect(check.message.length, bad).toBeGreaterThan(10);
    }
  });

  it('rejects passwords built around the username or the app name', () => {
    expect(checkPassword('georgegeorge2024', { username: 'george' }).ok).toBe(false);
    expect(checkPassword('conchconch12345').ok).toBe(false);
  });

  it('scores passphrases by words, not characters', () => {
    expect(estimateBits('lemon lemon lemon lemon')).toBeLessThan(50);
    expect(estimateBits('Tr0ub4dor&3xylophone!')).toBeGreaterThan(70);
  });
});

describe('generators', () => {
  it('suggests unique three-part passwords that pass the policy', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = suggestPassword();
      expect(password).toMatch(/^[a-z2-9]{6}-[a-z2-9]{6}-[a-z2-9]{6}$/);
      expect(password).not.toMatch(/[lo01]/);
      expect(checkPassword(password).ok).toBe(true);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });

  it('recognises access keys', () => {
    expect(looksLikeAccessKey(`conch_${'A'.repeat(43)}`)).toBe(true);
    expect(looksLikeAccessKey('hunter2')).toBe(false);
  });
});

describe('wire hygiene', () => {
  it('ids can never name a path', () => {
    expect(Id.safeParse('c_1a2b3c4d5e6f').success).toBe(true);
    for (const bad of ['../etc', 'a/b', '..', 'x.jsonl', '', 'a\\b'])
      expect(Id.safeParse(bad).success, bad).toBe(false);
    expect(
      ClientCommand.safeParse({ type: 'conversation.subscribe', conversationId: '../../x' })
        .success,
    ).toBe(false);
  });

  it('login codes are a single line', () => {
    expect(LoginCodeBody.safeParse({ code: 'abc\nrm -rf' }).success).toBe(false);
    expect(LoginCodeBody.safeParse({ code: ' abc#def ' }).data?.code).toBe('abc#def');
  });

  it('sign-in bodies are discriminated', () => {
    expect(SignInBody.safeParse({ with: 'key', key: 'conch_x' }).success).toBe(true);
    expect(SignInBody.safeParse({ with: 'password', password: 'x' }).success).toBe(false);
  });
});

describe('checkup fixes', () => {
  it('run only actions the gateway knows, and nothing else in the body', () => {
    expect(CheckupFixBody.safeParse({ action: 'ask-first' }).success).toBe(true);
    for (const bad of [
      { action: 'grant-full-trust' },
      { action: 'ASK-FIRST' },
      { action: '__proto__' },
      { action: 'ask-first', value: 'bypassPermissions' },
      { action: ['ask-first'] },
      {},
    ])
      expect(CheckupFixBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('offer a place to go or an action to run, never a free-form link', () => {
    const item = { id: 'x', level: 'warn', title: 'T', detail: 'D' };
    expect(
      CheckupItem.safeParse({ ...item, fix: { kind: 'open', label: 'Review', place: 'keys' } })
        .success,
    ).toBe(true);
    expect(
      CheckupItem.safeParse({
        ...item,
        fix: { kind: 'act', label: 'Turn off', action: 'secure-files' },
      }).success,
    ).toBe(true);
    for (const fix of [
      { kind: 'open', label: 'Go', place: 'https://evil.example' },
      { kind: 'open', label: 'Go', place: '/integrations' },
      { kind: 'link', label: 'Go', href: 'https://evil.example' },
      { kind: 'act', label: '', action: 'secure-files' },
    ])
      expect(CheckupItem.safeParse({ ...item, fix }).success, JSON.stringify(fix)).toBe(false);
  });
});
