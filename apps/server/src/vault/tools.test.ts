import { describe, expect, it } from 'vitest';

import type { ToolContext } from '../conversations/manager';
import { hostToolText, type HostTool } from '../engines/types';
import type { VaultService } from './service';
import { signInWords, vaultTools } from './tools';

describe('passwords_find says how a login signs in (ADR 0133)', () => {
  it('in words, never a value', () => {
    expect(signInWords({ via: 'provider', provider: 'google', account: 'ada@gmail.com' })).toBe(
      'signs in with Google as ada@gmail.com, no password',
    );
    expect(signInWords({ via: 'provider', provider: 'other', name: 'Yahoo' })).toBe(
      'signs in with Yahoo, no password',
    );
    expect(signInWords({ via: 'sso', name: 'Acme SSO' })).toBe(
      'signs in through Acme SSO, no password',
    );
    expect(signInWords({ via: 'link' })).toBe(
      'signs in with a link or code sent by email, no password',
    );
    expect(signInWords({ via: 'passkey', usable: false })).toMatch(/can’t use/);
    expect(signInWords({ via: 'passkey', usable: true })).toBe(
      'signs in with a passkey Conch holds',
    );
    expect(signInWords(undefined)).toBeUndefined();
    expect(signInWords({ via: 'telepathy' })).toBeUndefined();
  });

  it('lists it beside the item, with what to do', async () => {
    const vault = {
      ensureOpen: () => Promise.resolve(true),
      forAgent: () =>
        Promise.resolve([
          {
            id: 'ph',
            title: 'Product Hunt',
            type: 'login',
            sites: ['producthunt.com'],
            source: '1password',
            passkey: false,
            signIn: { via: 'provider', provider: 'google', account: 'ada@gmail.com' },
          },
          {
            id: 'g1',
            title: 'Google',
            type: 'login',
            sites: ['accounts.google.com'],
            source: 'conch',
            passkey: false,
          },
        ]),
    } as unknown as VaultService;
    const ctx = {
      append: () => undefined,
      signal: new AbortController().signal,
    } as unknown as ToolContext;
    const find = vaultTools(vault, ctx).find((t) => t.name === 'passwords_find') as HostTool;
    const text = hostToolText(await find.run({} as never));
    expect(text).toContain(
      '- Product Hunt (login, producthunt.com, from 1password; signs in with Google as ada@gmail.com, no password) id=ph',
    );
    expect(text).toContain('- Google (login, accounts.google.com) id=g1');
    expect(text).toMatch(/press the site’s own button for it \(“Continue with Google”\)/);
  });
});
