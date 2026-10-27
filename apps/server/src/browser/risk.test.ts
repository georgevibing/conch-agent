import { describe, expect, it } from 'vitest';

import { asksHighStakes, isHighStakes } from './risk';
import { displayHost, siteOf } from './site';

describe('asksHighStakes (a page’s own question, ADR 0131)', () => {
  it('finds the act anywhere in the sentence', () => {
    for (const sentence of [
      'Are you sure you want to delete 3 items?',
      'Möchten Sie das wirklich löschen?',
      'Place your order now?',
      'Do you want to send this message?',
    ])
      expect(asksHighStakes(sentence), sentence).toBe(true);
  });

  it('only as a word, and not everyday questions', () => {
    for (const sentence of [
      'Leave without saving?',
      'Visit Facebook?',
      'Remove this from your list?',
      'Show the postcode field?',
      undefined,
    ])
      expect(asksHighStakes(sentence), String(sentence)).toBe(false);
  });
});

describe('isHighStakes', () => {
  it('flags controls that spend, send, publish or delete', () => {
    for (const name of [
      'Buy now',
      'Place order',
      'Place your order · $42.10',
      'Pay £12.00',
      'Checkout',
      'Send',
      'Send message',
      'Post',
      'Publish',
      'Delete account',
      'Transfer',
      'Book now',
      'Confirm booking',
      'Subscribe',
      '🛒 Buy',
      'Renew now',
      'Renew domain',
      'Upgrade plan',
      'Confirm and pay',
      'Add funds',
      'Start plan',
    ]) {
      expect(isHighStakes(name), name).toBe(true);
    }
  });

  it('leaves everyday controls alone', () => {
    for (const name of [
      'Search',
      'Submit',
      'Next',
      'Sign in',
      'Accept all cookies',
      'Add to cart',
      // Only goes to the checkout page; paying there is what asks.
      'Proceed to checkout',
      'Show more',
      'Postcode',
      'Sender details',
      'Bookmarks',
      undefined,
      '',
    ]) {
      expect(isHighStakes(name), String(name)).toBe(false);
    }
  });
});

describe('siteOf', () => {
  it('groups a domain’s subdomains into one site', () => {
    expect(siteOf('https://www.booking.com/hotel/x')).toBe('booking.com');
    expect(siteOf('https://secure.booking.com/pay')).toBe('booking.com');
    expect(siteOf('https://news.bbc.co.uk/')).toBe('bbc.co.uk');
  });

  it('keeps people’s own sites on shared hosts apart', () => {
    expect(siteOf('https://alice.github.io/')).toBe('alice.github.io');
    expect(siteOf('https://bob.github.io/')).toBe('bob.github.io');
  });

  it('uses the host for addresses without a domain', () => {
    expect(siteOf('http://localhost:3000/')).toBe('localhost');
    expect(siteOf('http://192.168.1.1/')).toBe('192.168.1.1');
    expect(siteOf('http://[::1]:8080/')).toBe('::1');
  });

  it('has no site for non-web addresses', () => {
    expect(siteOf('about:blank')).toBeUndefined();
    expect(siteOf('file:///etc/hosts')).toBeUndefined();
    expect(siteOf('nonsense')).toBeUndefined();
  });

  it('shows hosts without www', () => {
    expect(displayHost('https://www.example.com/a')).toBe('example.com');
  });
});
