import type { VaultItemSummary } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { pickSignInItem, signInFrom, signInFromText, signInWords, withSignIn } from './signin';

describe('how an account signs in, from its own words (ADR 0133)', () => {
  it('reads what people write: "Sign in with Google", "Continue with Apple", "GitHub login"', () => {
    expect(signInFromText(['Sign in with Google'])).toEqual({
      via: 'provider',
      provider: 'google',
    });
    expect(signInFromText(['Continue with Apple ID'])).toEqual({
      via: 'provider',
      provider: 'apple',
    });
    expect(signInFromText(['logged in via my Microsoft account'])).toEqual({
      via: 'provider',
      provider: 'microsoft',
    });
    expect(signInFromText(['GitHub login'])).toEqual({ via: 'provider', provider: 'github' });
    expect(signInFromText(['Sign in with X'])).toEqual({ via: 'provider', provider: 'x' });
    expect(signInFromText(['Log in with Steam'])).toEqual({
      via: 'provider',
      provider: 'other',
      name: 'Steam',
    });
  });

  it('keeps the account it names', () => {
    expect(signInFromText(['Sign in with Google (ada@gmail.com)'])).toEqual({
      via: 'provider',
      provider: 'google',
      account: 'ada@gmail.com',
    });
  });

  it('knows single sign-on, a link by email and a passkey', () => {
    expect(signInFromText(['Okta SSO'])).toEqual({ via: 'provider', provider: 'okta' });
    expect(signInFromText(['Use the Acme SSO'])).toEqual({ via: 'sso', name: 'Acme SSO' });
    expect(signInFromText(['Sign in with SSO'])).toEqual({ via: 'sso' });
    expect(signInFromText(['They email a magic link'])).toEqual({ via: 'link' });
    expect(signInFromText(['Passkey only'])).toEqual({ via: 'passkey' });
  });

  it('never guesses from a word alone', () => {
    for (const text of [
      'google',
      'Found it on Google',
      'My Google account recovery codes are in the safe',
      'Sign in with your email',
      'Log in with my username',
      'Apple',
      'Signed up in 2019',
      'Login for the admin panel',
    ])
      expect(signInFromText([text]), text).toBeUndefined();
  });

  it('says nothing while the login has a password, or might', () => {
    const texts = ['Sign in with Google'];
    expect(signInFrom({ password: true, texts })).toBeUndefined();
    expect(signInFrom({ password: undefined, texts })).toBeUndefined();
    expect(signInFrom({ password: false, texts })).toEqual({ via: 'provider', provider: 'google' });
    expect(signInFrom({ password: false, passkeys: 1, texts })).toEqual({ via: 'passkey' });
  });

  it('writes a line Conch reads back, and isn’t found twice', () => {
    const signIn = { via: 'provider', provider: 'google', account: 'ada@gmail.com' } as const;
    const notes = withSignIn('Old handle: ada99', signIn);
    expect(notes).toBe('Sign in with Google (ada@gmail.com).\nOld handle: ada99');
    expect(withSignIn(notes, signIn)).toBe(notes);
    expect(signInFromText([notes])).toEqual(signIn);
    expect(signInWords(signIn)).toContain('google');
  });
});

const item = (over: Partial<VaultItemSummary>): VaultItemSummary => ({
  id: 'x',
  source: 'conch',
  type: 'login',
  title: 'Item',
  subtitle: '',
  domains: [],
  tags: [],
  favorite: false,
  totp: false,
  passkey: false,
  problems: [],
  readOnly: false,
  ...over,
});

describe('the provider’s own login', () => {
  const hunt = item({
    id: 'hunt',
    title: 'Product Hunt',
    domains: ['producthunt.com'],
    signIn: { via: 'provider', provider: 'google', account: 'ada@gmail.com' },
  });
  const work = item({
    id: 'work',
    title: 'Google (work)',
    subtitle: 'ada@acme.com',
    domains: ['accounts.google.com'],
  });
  const own = item({
    id: 'own',
    title: 'Google',
    subtitle: 'ada@gmail.com',
    domains: ['google.com'],
    usedAt: 1,
  });

  it('is the one for the account it signs in as', () => {
    expect(pickSignInItem(hunt, [hunt, work, own])?.id).toBe('own');
    expect(pickSignInItem(hunt, [hunt, work])).toBeUndefined();
    // Gmail ignores dots.
    expect(pickSignInItem(hunt, [item({ ...own, subtitle: 'a.da@googlemail.com' })])?.id).toBe(
      'own',
    );
    // Written short, when only one fits.
    expect(pickSignInItem(hunt, [item({ ...own, subtitle: 'ada' })])?.id).toBe('own');
  });

  it('is the only one, when the account isn’t known', () => {
    const anyone = { ...hunt, signIn: { via: 'provider' as const, provider: 'google' as const } };
    expect(pickSignInItem(anyone, [anyone, own])?.id).toBe('own');
    expect(pickSignInItem(anyone, [anyone, own, work])).toBeUndefined();
  });

  it('is never a look-alike, another tenant, or a login that itself signs in elsewhere', () => {
    const fakes = [
      item({ id: 'f1', subtitle: 'ada@gmail.com', domains: ['google.com.account-check.io'] }),
      item({ id: 'f2', subtitle: 'ada@gmail.com', domains: ['g00gle.com'] }),
      item({ id: 'f3', subtitle: 'ada@gmail.com', domains: ['google.evil.example'] }),
      item({
        id: 'f4',
        subtitle: 'ada@gmail.com',
        domains: ['mail.google.com'],
        signIn: { via: 'provider', provider: 'apple' },
      }),
      item({ id: 'f5', subtitle: 'ada@gmail.com', domains: ['google.com'], type: 'note' }),
      item({ id: 'f6', subtitle: 'ada@gmail.com', domains: ['google.com'], deletedAt: 1 }),
    ];
    expect(pickSignInItem(hunt, [hunt, ...fakes])).toBeUndefined();
    const github = item({
      id: 'gh',
      signIn: { via: 'provider', provider: 'github' },
    });
    expect(
      pickSignInItem(github, [item({ id: 'io', subtitle: 'ada', domains: ['ada.github.io'] })]),
    ).toBeUndefined();
  });
});
