import { describe, expect, it } from 'vitest';

import {
  asksSignIn,
  capFrom,
  PaymentYes,
  PAYMENT_WINDOW_MS,
  reviewableClick,
  showsTotal,
  spendsMoney,
  totalOnPage,
  withinCap,
} from './consent';

describe('what Auto’s review may weigh on a site', () => {
  it('takes communication, bookings, subscriptions and invites', () => {
    for (const label of [
      'Send',
      'Reply all',
      'Post',
      'Book a table',
      'Reserve now',
      'Confirm booking',
      'Subscribe',
      'Unsubscribe',
      'Cancel membership',
      'RSVP',
      'Accept invitation',
      'Join meeting',
    ])
      expect(reviewableClick(label), label).toBe(true);
  });

  it('leaves money, and anything that isn’t one of those, to its card', () => {
    for (const label of [
      'Place order',
      'Pay now',
      'Buy now',
      'Checkout',
      'Donate',
      'Send payment',
      'Book · £40.00',
      'Transfer',
      'Delete account',
      'Merge',
    ])
      expect(reviewableClick(label), label).toBe(false);
    expect(spendsMoney('Place order')).toBe(true);
    expect(spendsMoney('Book a table')).toBe(false);
  });
});

describe('a limit the person named', () => {
  it('reads the latest one, with its currency', () => {
    expect(capFrom(['buy it if under $50'])).toEqual({ amount: 50, currency: 'USD', strict: true });
    expect(capFrom(['order ink, up to €30'])).toEqual({
      amount: 30,
      currency: 'EUR',
      strict: false,
    });
    expect(capFrom(['no more than 40 euros'])).toEqual({
      amount: 40,
      currency: 'EUR',
      strict: false,
    });
    expect(capFrom(['under £20', 'actually up to £25'])).toMatchObject({ amount: 25 });
    expect(capFrom(['buy it if under 50'])).toBeUndefined();
    expect(capFrom(['buy it'])).toBeUndefined();
  });

  it('compares it with the total the page shows, never another currency', () => {
    const total = totalOnPage('Subtotal £10.00\nShipping £2.00\nOrder total: £12.00');
    expect(total).toEqual({ amount: 12, currency: 'GBP' });
    if (!total) return;
    expect(withinCap({ amount: 12, currency: 'GBP', strict: true }, total)).toBe(false);
    expect(withinCap({ amount: 12, currency: 'GBP', strict: false }, total)).toBe(true);
    expect(withinCap({ amount: 50, currency: 'USD', strict: true }, total)).toBe(false);
    expect(totalOnPage('Total: 1.234,50 €')).toEqual({ amount: 1234.5, currency: 'EUR' });
    expect(totalOnPage('Total $10.00 · Total €9.00')).toBeUndefined();
    expect(totalOnPage('Subtotal $10.00')).toBeUndefined();
    expect(totalOnPage('Casa do Rio · €384 total')).toEqual({ amount: 384, currency: 'EUR' });
  });

  it('knows a page that shows a total to pay, in any currency', () => {
    expect(showsTotal('Casa do Rio · €384 total')).toBe(true);
    expect(showsTotal('Total $10.00 · Total €9.00')).toBe(true);
    expect(showsTotal('Pasta 12 € · Wine 6 €')).toBe(false);
  });
});

describe('a sign-in the person asked for', () => {
  it('names the site’s brand and a sign-in', () => {
    expect(asksSignIn('sign in to the Hetzner console', 'hetzner.cloud')).toBe(true);
    expect(asksSignIn('log into my github account', 'github.com')).toBe(true);
    expect(asksSignIn('what does hetzner charge?', 'hetzner.cloud')).toBe(false);
    expect(asksSignIn('sign in to github', 'github-login.example')).toBe(false);
  });
});

describe('one card for a payment', () => {
  it('carries a yes to the other half of the checkout once, for a few minutes', () => {
    let now = 0;
    const yes = new PaymentYes(() => now);
    yes.agreed('shop.example');
    expect(yes.take('other.example')).toBe(false);
    expect(yes.take('shop.example')).toBe(true);
    expect(yes.take('shop.example')).toBe(false);
    yes.agreed('shop.example');
    now = PAYMENT_WINDOW_MS + 1;
    expect(yes.take('shop.example')).toBe(false);
  });
});
