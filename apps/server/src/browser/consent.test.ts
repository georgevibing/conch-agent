import { describe, expect, it } from 'vitest';

import {
  asksDownload,
  asksSignIn,
  capFrom,
  namesDocument,
  namesSite,
  PaymentYes,
  PAYMENT_WINDOW_MS,
  reviewableClick,
  showsCharge,
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

describe('a price that isn’t called a total (2026-10-27)', () => {
  it('counts a plan per month, a deposit, a bill after a trial as paying', () => {
    for (const page of [
      'Pro plan\n$9.99/month\nSubscribe',
      'Premium · €120 per year',
      'Pay a €20 deposit to hold the table',
      'Deposit of £50 required',
      'Free for 7 days, then $12.99',
      'Billed annually at $99',
      '9,99 € pro Monat',
    ])
      expect(showsCharge(page), page).toBe(true);
  });

  it('leaves a free newsletter or a page without a price alone', () => {
    for (const page of [
      'Get our weekly newsletter. Subscribe',
      'Book a table for 2 at 20:00',
      'Rated 4.8 by 1,200 diners',
    ])
      expect(showsCharge(page), page).toBe(false);
  });

  it('keeps renewing, upgrading and adding funds on their card', () => {
    for (const label of ['Renew now', 'Upgrade plan', 'Add funds', 'Start plan', 'Renew domain'])
      expect(spendsMoney(label), label).toBe(true);
    expect(reviewableClick('Renew now')).toBe(false);
  });
});

describe('the person naming a site (2026-10-27)', () => {
  it('takes its brand as a word, without sign-in words', () => {
    expect(namesSite('order the same ink on Amazon', 'amazon.co.uk')).toBe(true);
    expect(namesSite('post this on LinkedIn', 'linkedin.com')).toBe(true);
    expect(namesSite('cancel my Netflix', 'netflix.com')).toBe(true);
    expect(namesSite('look at hetzner.cloud', 'hetzner.cloud')).toBe(true);
  });

  it('never a lookalike, part of a word, or a plain label', () => {
    expect(namesSite('order the same ink on Amazon', 'amazon-deals.shop')).toBe(false);
    expect(namesSite('order the same ink on Amazon', 'amaz0n.com')).toBe(false);
    expect(namesSite('open the netflixparty page', 'netflix.com')).toBe(false);
    expect(namesSite('check my account', 'account.com')).toBe(false);
  });

  it('needs a sign-in word beside a brand that is an everyday word, or a bank', () => {
    expect(namesSite('chase down the invoice', 'chase.com')).toBe(false);
    expect(namesSite('hit the target this week', 'target.com')).toBe(false);
    expect(namesSite('discover what changed', 'discover.com')).toBe(false);
    expect(namesSite('sign in to Chase and download the statement', 'chase.com')).toBe(true);
    expect(namesSite('log into my Target account', 'target.com')).toBe(true);
    expect(namesSite('get my statement from chase.com', 'chase.com')).toBe(true);
  });
});

describe('round 5: your own bank, your own document, a download you asked for (2026-10-27)', () => {
  it('takes a bank named as yours, never an everyday verb', () => {
    expect(namesSite('pay my Chase card bill', 'chase.com')).toBe(true);
    expect(namesSite('check the balance at chase', 'chase.com')).toBe(true);
    expect(namesSite('chase down the invoice', 'chase.com')).toBe(false);
  });

  it('names a saved document by what it is', () => {
    expect(namesDocument('fill the visa form with my passport details', 'Passport')).toBe(true);
    expect(namesDocument('use my driver’s license', 'Driver’s licence')).toBe(true);
    expect(namesDocument('fill the form', 'Passport')).toBe(false);
  });

  it('reads a download the person asked for', () => {
    expect(asksDownload('check me in and download the boarding pass')).toBe(true);
    expect(asksDownload('save the invoice PDF')).toBe(true);
    expect(asksDownload('look at the flight times')).toBe(false);
  });
});
