import { describe, expect, it } from 'vitest';

import { bestMatch, byMatch, lookalikeOf, matchSite, registrable } from './match';

describe('which saved site belongs on a page (ADR 0130)', () => {
  it('ranks the same host, a page under the saved site, and another part of the same site', () => {
    expect(matchSite('https://netflix.com/login', 'www.netflix.com')).toBe('exact');
    expect(matchSite('example.com', 'login.example.com')).toBe('within');
    expect(matchSite('accounts.google.com', 'google.com')).toBe('related');
    expect(matchSite('login.example.com', 'app.example.com')).toBe('related');
    expect(matchSite('example.co.uk', 'shop.example.co.uk')).toBe('within');
  });

  it('never matches another site, however it is spelled', () => {
    expect(matchSite('netflix.com', 'netflix.com.evil.io')).toBeUndefined();
    expect(matchSite('netflix.com', 'evilnetflix.com')).toBeUndefined();
    expect(matchSite('netflix.com', 'netflix.co')).toBeUndefined();
    expect(matchSite('amazon.com', 'amazon.de')).toBeUndefined();
  });

  it('keeps sites on shared hosting apart (the private part of the Public Suffix List)', () => {
    expect(matchSite('alice.github.io', 'bob.github.io')).toBeUndefined();
    expect(matchSite('alice.github.io', 'alice.github.io')).toBe('exact');
    expect(matchSite('myshop.myshopify.com', 'evil.myshopify.com')).toBeUndefined();
  });

  it('never lets a saved public suffix match every site under it', () => {
    expect(matchSite('co.uk', 'bank.co.uk')).toBeUndefined();
    expect(matchSite('github.io', 'alice.github.io')).toBeUndefined();
    expect(matchSite('com', 'example.com')).toBeUndefined();
  });

  it('matches this computer and addresses only exactly', () => {
    expect(matchSite('http://localhost:3000', 'localhost')).toBe('exact');
    expect(matchSite('192.168.1.1', '192.168.1.10')).toBeUndefined();
    expect(matchSite('10.0.0.1', '10.0.0.1')).toBe('exact');
    expect(registrable('localhost')).toBeUndefined();
  });

  it('takes the best of an item’s sites, and offers the closest, most recently used first', () => {
    expect(bestMatch(['google.com', 'accounts.google.com'], 'accounts.google.com')).toBe('exact');
    expect(bestMatch(['example.org'], 'example.com')).toBeUndefined();
    const sorted = byMatch([
      { title: 'B', match: 'related' as const, usedAt: 9 },
      { title: 'A', match: 'exact' as const },
      { title: 'C', match: 'exact' as const, usedAt: 5 },
    ]);
    expect(sorted.map((i) => i.title)).toEqual(['C', 'A', 'B']);
  });
});

describe('pages dressed up as one of your sites (ADR 0130 § Look-alikes)', () => {
  const saved = ['https://www.paypal.com', 'netflix.com', 'accounts.google.com', 'x.com'];

  it.each([
    ['paypal.com.account-check.io', 'paypal.com', 'its address in front of another'],
    ['paypal.com-help.net', 'paypal.com', 'its address and a word'],
    ['login.paypal.com.evil.io', 'paypal.com', 'its address in the middle'],
    ['paypa1.com', 'paypal.com', 'a digit for a letter'],
    ['xn--pypal-4ve.com', 'paypal.com', 'a Cyrillic letter (punycode)'],
    ['netfllix.com', 'netflix.com', 'a letter doubled'],
    ['netlfix.com', 'netflix.com', 'two letters swapped'],
    ['netflx.com', 'netflix.com', 'a letter left out'],
    ['netflix-login.com', 'netflix.com', 'wrapped in words'],
    ['secure-paypal.co', 'paypal.com', 'wrapped in words, another ending'],
    ['g00gle.com', 'google.com', 'zeros for o'],
  ])('%s looks like %s (%s)', (host, site) => {
    expect(lookalikeOf(host, saved)).toBe(site);
  });

  it.each([
    ['paypal.com', 'the site itself'],
    ['www.paypal.com', 'the site itself, with www'],
    ['accounts.google.com', 'the saved host'],
    ['mail.google.com', 'another part of the same site'],
    ['paypal.de', 'the same name in another country'],
    ['motion.com', 'a different word one letter away (notion/motion)'],
    ['github.com', 'an unrelated site'],
    ['y.com', 'a name too short to judge'],
    ['localhost', 'this computer'],
    ['192.168.0.1', 'an address'],
  ])('%s is not a look-alike (%s)', (host) => {
    expect(lookalikeOf(host, [...saved, 'notion.so'])).toBeUndefined();
  });
});
