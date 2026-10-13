import type { VaultSignIn } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { PasswordFiller } from './service';
import {
  accountEntry,
  buttonFor,
  buttonKind,
  chainFits,
  CHAIN_MS,
  keptIn,
  passkeyHandoffReason,
  providerChoices,
  providerLogin,
  providerOfHost,
  redirectHosts,
  signInButtons,
  signInItemOf,
  signInSteps,
  type Chain,
} from './signin';

describe('the page’s sign-in buttons, by name (ADR 0133)', () => {
  it('knows a provider’s button in the ways sites write it', () => {
    for (const [label, provider] of [
      ['Continue with Google', 'google'],
      ['Sign in with Google', 'google'],
      ['Log in with Google', 'google'],
      ['Sign up with Google', 'google'],
      ['Mit Google anmelden', 'google'],
      ['Continuer avec Google', 'google'],
      ['Sign in with Apple', 'apple'],
      ['Continue with Microsoft account', 'microsoft'],
      ['Log in with Facebook', 'facebook'],
      ['Sign in with GitHub', 'github'],
      ['Continue with X', 'x'],
      ['Sign in with Twitter', 'x'],
      ['Continue with LinkedIn', 'linkedin'],
      ['Login with Okta', 'okta'],
    ] as const)
      expect(buttonKind(label), label).toEqual({ kind: 'provider', provider });
  });

  it('takes a button named only for the provider (an icon), but not a link or “X”', () => {
    expect(buttonKind('Google', 'button')).toEqual({ kind: 'provider', provider: 'google' });
    expect(buttonKind('Apple ID', 'button')).toEqual({ kind: 'provider', provider: 'apple' });
    // A footer's "Facebook" link, a dialog's close button.
    expect(buttonKind('Facebook', 'link')).toBeUndefined();
    expect(buttonKind('X', 'button')).toBeUndefined();
  });

  it('leaves out what only names the company', () => {
    for (const label of [
      'Get it on Google Play',
      'Pay with Google Pay',
      'Download on the Apple App Store',
      'Share on Facebook',
      'Follow us on X',
      'Apple Music',
      'Google Maps',
      'Sign in',
      'Continue',
      'Continue with phone',
      'Continue with password',
    ])
      expect(buttonKind(label), label).toBeUndefined();
  });

  it('knows single sign-on, a passkey and an emailed link', () => {
    expect(buttonKind('Sign in with SSO')).toEqual({ kind: 'sso' });
    expect(buttonKind('Use single sign-on (SSO)')).toEqual({ kind: 'sso' });
    expect(buttonKind('Sign in with a passkey')).toEqual({ kind: 'passkey' });
    expect(buttonKind('Passkey')).toEqual({ kind: 'passkey' });
    expect(buttonKind('Continue with email')).toEqual({ kind: 'email' });
    expect(buttonKind('Email me a sign-in link')).toEqual({ kind: 'email' });
    expect(buttonKind('Send magic link')).toEqual({ kind: 'email' });
  });

  it('knows a provider it has no name for, written as a name', () => {
    expect(buttonKind('Continue with Yahoo')).toEqual({ kind: 'provider' });
    expect(buttonKind('Continue with your phone')).toBeUndefined();
  });

  it('reads them from the page the agent reads, frames and flags included', () => {
    const snapshot = [
      '- heading "Welcome to Product Hunt" [level=2] [ref=e3]',
      '- button "Continue with Google" [ref=e12] [cursor=pointer]:',
      '  - img',
      '- button "Continue with X" [ref=e13]',
      '- link "Continue with \\"email\\"" [ref=e14]',
      '- button "Close" [ref=e15]',
      '- iframe [ref=e20]:',
      '  - button "Sign in with Google. Opens in new tab" [ref=f1e2]',
      '- link "Facebook" [ref=e30]',
    ].join('\n');
    expect(signInButtons(snapshot)).toEqual([
      {
        kind: 'provider',
        provider: 'google',
        label: 'Continue with Google',
        ref: 'e12',
        role: 'button',
      },
      { kind: 'provider', provider: 'x', label: 'Continue with X', ref: 'e13', role: 'button' },
      { kind: 'email', label: 'Continue with "email"', ref: 'e14', role: 'link' },
      {
        kind: 'provider',
        provider: 'google',
        label: 'Sign in with Google. Opens in new tab',
        ref: 'f1e2',
        role: 'button',
      },
    ]);
  });

  it('picks the button for how an item signs in: signing in before signing up', () => {
    const buttons = signInButtons(
      [
        '- link "Sign up with Google" [ref=e1]',
        '- button "Sign in with Google" [ref=e2]',
        '- button "Sign in with Apple" [ref=e3]',
        '- button "Sign in with SSO" [ref=e4]',
        '- button "Continue with Yahoo" [ref=e5]',
      ].join('\n'),
    );
    const via = (signIn: VaultSignIn) => buttonFor(buttons, signIn)?.ref;
    expect(via({ via: 'provider', provider: 'google' })).toBe('e2');
    expect(via({ via: 'provider', provider: 'apple' })).toBe('e3');
    expect(via({ via: 'provider', provider: 'github' })).toBeUndefined();
    expect(via({ via: 'sso', name: 'Acme SSO' })).toBe('e4');
    expect(via({ via: 'provider', provider: 'other', name: 'Yahoo' })).toBe('e5');
    expect(via({ via: 'provider', provider: 'other', name: 'Steam' })).toBeUndefined();
    expect(via({ via: 'passkey' })).toBeUndefined();
  });
});

describe('the provider’s own sites, never a look-alike', () => {
  it('knows its sign-in sites', () => {
    expect(providerOfHost('accounts.google.com')).toBe('google');
    expect(providerOfHost('google.com')).toBe('google');
    expect(providerOfHost('appleid.apple.com')).toBe('apple');
    expect(providerOfHost('login.microsoftonline.com')).toBe('microsoft');
    expect(providerOfHost('github.com')).toBe('github');
  });

  it('refuses look-alikes', () => {
    for (const host of [
      'accounts.google.com.evil.io',
      'google.com.account-check.io',
      'evilgoogle.com',
      'accounts-google.com',
      'xn--ggle-0nda.com',
      'producthunt.com',
    ])
      expect(providerOfHost(host), host).toBeUndefined();
  });
});

describe('the chain: a provider’s sign-in for one of your sites', () => {
  const chain: Chain = {
    fromItem: 'ph',
    fromTitle: 'Product Hunt',
    fromSite: 'producthunt.com',
    provider: 'google',
    name: 'Google',
    account: 'ada@gmail.com',
    until: Date.now() + CHAIN_MS,
  };
  const oauth = (redirect: string) =>
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=${encodeURIComponent(redirect)}&response_type=code`;

  it('follows where the provider says it sends you back, through its own pages', () => {
    const inner = oauth('https://www.producthunt.com/auth/google/callback');
    const outer = `https://accounts.google.com/v3/signin/identifier?continue=${encodeURIComponent(inner)}&flowName=GlifWebSignIn`;
    expect(redirectHosts(outer)).toEqual(['accounts.google.com', 'producthunt.com']);
  });

  it('holds on the provider’s pages for that site', () => {
    expect(chainFits(chain, oauth('https://www.producthunt.com/auth/google/callback'))).toBe(true);
    expect(chainFits(chain, 'https://accounts.google.com/v3/signin/challenge/pwd')).toBe(true);
  });

  it('doesn’t hold for a sign-in that goes to another site, or anywhere but the provider', () => {
    expect(chainFits(chain, oauth('https://evil.io/steal'))).toBe(false);
    expect(chainFits(chain, 'https://accounts.google.com.evil.io/signin')).toBe(false);
    expect(chainFits(chain, 'https://www.producthunt.com/')).toBe(false);
    expect(chainFits(chain, 'https://example.com/')).toBe(false);
  });

  it('for a provider Conch doesn’t know, holds where its saved login is (the caller checks)', () => {
    const other: Chain = {
      ...chain,
      provider: undefined,
      name: 'Yahoo',
      with: { id: 'y', title: 'Yahoo' },
    };
    expect(chainFits(other, 'https://login.yahoo.com/')).toBe(true);
    expect(chainFits(other, 'https://www.producthunt.com/')).toBe(false);
  });
});

describe('what the agent hears (names only, never a value)', () => {
  const item = {
    id: 'ph',
    title: 'Product Hunt',
    subtitle: 'ada@gmail.com',
    signIn: { via: 'provider', provider: 'google', account: 'ada@gmail.com' } as VaultSignIn,
  };

  it('says which button to press and which login fills Google’s pages', () => {
    const text = signInSteps(item, {
      button: {
        kind: 'provider',
        provider: 'google',
        label: 'Continue with Google',
        ref: 'e12',
        role: 'button',
      },
      with: { id: 'g1', title: 'Google', account: 'ada@gmail.com' },
    });
    expect(text).toContain('“Product Hunt” signs in with Google (ada@gmail.com)');
    expect(text).toContain('“Continue with Google” [ref=e12]');
    expect(text).toContain('Conch fills them from “Google” (ada@gmail.com)');
    expect(text).toContain('just click it');
  });

  it('without a saved Google login, hands Google’s sign-in to the person', () => {
    expect(signInSteps(item)).toMatch(/call browser_handoff so they sign in to Google themselves/);
  });

  it('a passkey Conch can’t use: says where it is and hands over', () => {
    const kept = {
      id: 'pk',
      title: 'Shop',
      source: '1password',
      signIn: { via: 'passkey', usable: false } as VaultSignIn,
    };
    expect(signInSteps(kept)).toMatch(/kept in 1Password, which Conch’s browser can’t use/);
    expect(signInSteps(kept)).toMatch(/browser_handoff/);
    expect(signInSteps(kept)).toMatch(/browser_passkey with save/);
    expect(passkeyHandoffReason(kept)).toBe(
      'Your passkey for Shop is kept in 1Password, which Conch’s browser can’t use. Sign in yourself, then hand the browser back.',
    );
    expect(keptIn(undefined)).toBe('another app');
  });

  it('a passkey Conch holds: browser_passkey first', () => {
    const held = {
      id: 'pk',
      title: 'Shop',
      signIn: { via: 'passkey', usable: true } as VaultSignIn,
    };
    expect(signInSteps(held)).toMatch(/Call browser_passkey with sign_in/);
  });

  it('single sign-on and an emailed link', () => {
    expect(
      signInSteps({ id: 's', title: 'Linear', signIn: { via: 'sso', name: 'Acme SSO' } }),
    ).toMatch(/signs in through Acme SSO.*company’s sign-in page/);
    const link = signInSteps(
      { id: 'l', title: 'Substack', signIn: { via: 'link', account: 'ada@example.com' } },
      { filledUsername: true },
    );
    expect(link).toMatch(/link or code sent by email \(ada@example\.com\)/);
    expect(link).toMatch(/If you can read the user’s email/);
    expect(link).toMatch(/ask the user to check their email/);
  });

  it('finds the account in a provider’s chooser', () => {
    const snapshot = [
      '- heading "Choose an account" [ref=e1]',
      '- link "Bob Builder bob@gmail.com" [ref=e4]',
      '- link "Ada Lovelace ada@gmail.com Signed out" [ref=e5]',
    ].join('\n');
    expect(accountEntry(snapshot, 'ada@gmail.com')?.ref).toBe('e5');
    expect(accountEntry(snapshot, 'eve@gmail.com')).toBeUndefined();
    expect(accountEntry(snapshot, undefined)).toBeUndefined();
  });

  it('only counts a site’s item when the closest ones all sign in that way', () => {
    const google = {
      id: 'a',
      match: 'exact',
      signIn: { via: 'provider', provider: 'google' } as VaultSignIn,
    };
    expect(signInItemOf([google])?.id).toBe('a');
    expect(signInItemOf([google, { id: 'b', match: 'exact' }])).toBeUndefined();
    expect(
      signInItemOf([
        { id: 'b', match: 'exact' },
        { ...google, match: 'related' },
      ]),
    ).toBeUndefined();
    expect(signInItemOf([])).toBeUndefined();
  });
});

describe('the provider’s saved login', () => {
  const ph = {
    id: 'ph',
    title: 'Product Hunt',
    subtitle: 'ada@gmail.com',
    signIn: { via: 'provider', provider: 'google', account: 'ada@gmail.com' } as VaultSignIn,
  };
  const fake = (over: Partial<PasswordFiller>): PasswordFiller =>
    ({
      matching: (host: string) =>
        Promise.resolve(
          host === 'accounts.google.com'
            ? [
                {
                  id: 'g2',
                  title: 'Google (work)',
                  subtitle: 'bob@gmail.com',
                  match: 'within' as const,
                },
                { id: 'g1', title: 'Google', subtitle: 'ada@gmail.com', match: 'within' as const },
              ]
            : [],
        ),
      ...over,
    }) as PasswordFiller;

  it('is the vault’s answer when it has one', async () => {
    const passwords = fake({
      signInItemFor: (item) =>
        item.id === 'ph' ? { id: 'g1', title: 'Google', subtitle: 'ada@gmail.com' } : undefined,
    });
    expect(await providerLogin(passwords, ph)).toEqual({
      id: 'g1',
      title: 'Google',
      account: 'ada@gmail.com',
    });
  });

  it('is nothing when the vault says there’s none (no guessing then)', async () => {
    expect(await providerLogin(fake({ signInItemFor: () => undefined }), ph)).toBeUndefined();
  });

  it('before the vault knows, is the login saved for Google’s own site with that account', async () => {
    expect(await providerLogin(fake({}), ph)).toEqual({
      id: 'g1',
      title: 'Google',
      account: 'ada@gmail.com',
    });
    expect(
      await providerLogin(fake({}), {
        ...ph,
        signIn: { via: 'provider', provider: 'google', account: 'eve@gmail.com' },
      }),
    ).toBeUndefined();
    expect(await providerLogin(fake({}), { ...ph, signIn: { via: 'passkey' } })).toBeUndefined();
  });
});

describe('saved as “another account”, without saying whose (1Password’s “Sign in with”)', () => {
  const item = {
    id: 'ph',
    title: 'Product Hunt',
    subtitle: 'ada@gmail.com',
    signIn: { via: 'provider', provider: 'other' } as VaultSignIn,
  };
  const buttons = signInButtons(
    [
      '- button "Continue with Google" [ref=e1]',
      '- link "Sign up with Google" [ref=e2]',
      '- button "Continue with Apple" [ref=e3]',
      '- button "Continue with email" [ref=e4]',
    ].join('\n'),
  );

  it('offers each provider the page has once, never guessing one', () => {
    expect(providerChoices(buttons).map((b) => b.ref)).toEqual(['e1', 'e3']);
    expect(buttonFor(buttons, item.signIn)).toBeUndefined();
  });

  it('tells the agent to ask the person which, or to say which it used when there’s one', () => {
    const many = signInSteps(item, { choices: providerChoices(buttons) });
    expect(many).toContain('Passwords doesn’t say whose');
    expect(many).toContain('“Continue with Google” [ref=e1], “Continue with Apple” [ref=e3]');
    expect(many).toMatch(/Don’t guess: ask the user which one they use/);
    const one = signInSteps(item, { choices: providerChoices(buttons).slice(0, 1) });
    expect(one).toMatch(
      /only one is “Continue with Google” \[ref=e1\]: press it, and tell the user/,
    );
    expect(signInSteps(item)).toMatch(/Don’t guess: ask the user which one they use/);
  });

  it('finds the provider’s login once a button says whose', async () => {
    const passwords = {
      matching: () => Promise.resolve([]),
      signInItemFor: (i: { signIn?: VaultSignIn }) =>
        i.signIn?.provider === 'google'
          ? { id: 'g1', title: 'Google', subtitle: 'ada@gmail.com' }
          : undefined,
    } as unknown as PasswordFiller;
    expect(await providerLogin(passwords, item)).toBeUndefined();
    expect(await providerLogin(passwords, item, 'google')).toEqual({
      id: 'g1',
      title: 'Google',
      account: 'ada@gmail.com',
    });
    // An item that names its provider is never re-pointed by a button.
    const named = { ...item, signIn: { via: 'provider', provider: 'apple' } as VaultSignIn };
    expect(await providerLogin(passwords, named, 'google')).toBeUndefined();
  });
});
