/**
 * Nothing Conch writes is forgotten by backups. A whole Conch is used for a
 * while in a temp home, through its real services, and every file it left
 * must be classified by `manifest.ts`. A new store that writes under
 * CONCH_HOME fails here until it's added there (AGENTS.md).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gateway, useConch, type Gateway } from '../test/session';
import { classify, RULES, walk } from './manifest';

vi.setConfig({ testTimeout: 60_000 });

let open: Gateway | undefined;
afterEach(async () => {
  await open?.app.close();
  open = undefined;
});

describe('what’s in a backup', () => {
  it('classifies every file a Conch in use writes', async () => {
    open = await gateway();
    await useConch(open);
    const files = await walk(open.home, { all: true });
    const unclassified = files.filter((f) => !f.rule).map((f) => f.path);
    expect(unclassified, 'Add these to backup/manifest.ts (kept, secret or derived)').toEqual([]);

    // The session really did touch every kind of store.
    const groups = new Set(files.map((f) => f.rule?.group).filter(Boolean));
    expect([...groups].sort()).toEqual(
      [
        'chats',
        'commands',
        'integrations',
        'memory',
        'routines',
        'secrets',
        'settings',
        'skills',
      ].sort(),
    );
    const paths = files.map((f) => f.path);
    for (const expected of [
      'settings.json',
      'secrets.json',
      'access.json',
      'integrations.json',
      'integrations.secrets.json',
      'channels.json',
      'channels.secrets.json',
      'browser.json',
      'terminal.json',
      'usage.json',
      'skills.json',
      'backups.json',
      'conversations/index.json',
      'healed.json',
      'gateway.json',
      'search.db',
    ])
      expect(paths).toContain(expected);
    for (const prefix of [
      'memory/',
      'commands/',
      'routines/',
      'skills/',
      'attachments/',
      'api-sessions/',
      'browser/shots/',
      'browser/profile/',
      'workspace/',
      'backups/',
    ])
      expect(
        paths.some((p) => p.startsWith(prefix)),
        prefix,
      ).toBe(true);
    expect(paths.some((p) => p.endsWith('.runs.jsonl'))).toBe(true);
  });

  it('puts each kind of file where it belongs', () => {
    const cls = (path: string) => classify(path)?.class;
    expect(cls('settings.json')).toBe('kept');
    expect(cls('memory/m_1.md')).toBe('kept');
    expect(cls('conversations/c_1.jsonl')).toBe('kept');
    expect(classify('conversations/c_1.jsonl')?.group).toBe('chats');
    expect(cls('api-sessions/api_1.json')).toBe('kept');
    expect(cls('secrets.json')).toBe('secret');
    expect(cls('access.json')).toBe('secret');
    expect(cls('integrations.secrets.json')).toBe('secret');
    expect(cls('skills.trust.json')).toBe('kept');
    expect(classify('skills.trust.json')?.group).toBe('skills');
    expect(cls('skills.signing.json')).toBe('secret');
    expect(cls('search.db')).toBe('derived');
    expect(cls('search.db-wal')).toBe('derived');
    expect(cls('healed.json')).toBe('derived');
    expect(cls('gateway.json')).toBe('derived');
    expect(cls('browser/profile/Default/Cookies')).toBe('derived');
    expect(cls('settings.broken-2026-09-30T10-00-00-000Z.json')).toBe('derived');
    expect(cls('routines/r_1.broken-2026-09-30T10-00-00-000Z.json')).toBe('derived');
    expect(cls('settings.json.1a2b3c4d.tmp')).toBe('derived');
    expect(cls('backups/auto-20260930-031200.conchbackup')).toBe('outside');
    expect(cls('workspace/site/index.html')).toBe('outside');
    // Nothing Conch doesn't know about sneaks in.
    expect(classify('memory/nested/m.md')).toBeUndefined();
    expect(classify('something-new.json')).toBeUndefined();
  });

  it('says why for every rule, and only kept and secret files belong to a group', () => {
    for (const rule of RULES) {
      expect(rule.why.length).toBeGreaterThan(10);
      expect(rule.group !== undefined).toBe(rule.class === 'kept' || rule.class === 'secret');
    }
  });
});
