import { describe, expect, it } from 'vitest';

import { classify, fillHost, identityRoleOf, type FieldFacts } from './fill';

let n = 0;
function box(over: Partial<FieldFacts>): FieldFacts {
  n += 1;
  return {
    mark: `f${n}`,
    type: 'text',
    autocomplete: '',
    words: '',
    secret: null,
    empty: true,
    target: false,
    ...over,
  };
}
const pw = (over: Partial<FieldFacts> = {}) =>
  box({ type: 'password', secret: 'password', words: 'password', ...over });
const roles = (fields: FieldFacts[], submit = '') => {
  const map = classify(fields, submit);
  return fields.map((f) => map.get(f.mark));
};

describe('which box is which (ADR 0130)', () => {
  it('reads a sign-in form: the username and the current password', () => {
    expect(roles([box({ type: 'email', words: 'email' }), pw()], 'sign in')).toEqual([
      'username',
      'password',
    ]);
    expect(roles([box({ autocomplete: 'username', words: 'identifier' }), pw()], 'next')).toEqual([
      'username',
      'password',
    ]);
  });

  it('reads a sign-up: one new password, or a password and its confirmation', () => {
    expect(roles([box({ type: 'email' }), pw({ autocomplete: 'new-password' })])).toEqual([
      'username',
      'new-password',
    ]);
    expect(roles([pw(), pw({ words: 'confirm password' })])).toEqual([
      'new-password',
      'new-password',
    ]);
    // One plain box, but the button says what the form is for.
    expect(roles([box({ type: 'email' }), pw()], 'create account')).toEqual([
      'username',
      'new-password',
    ]);
    expect(roles([pw()], 'sign up · already have an account? sign in')).toEqual(['password']);
  });

  it('reads a change: the current password beside the new one', () => {
    expect(
      roles([
        pw({ autocomplete: 'current-password' }),
        pw({ autocomplete: 'new-password' }),
        pw({ words: 'confirm new password' }),
      ]),
    ).toEqual(['password', 'new-password', 'new-password']);
    expect(roles([pw({ words: 'old password' }), pw()])).toEqual(['password', 'new-password']);
    // Three boxes and only the last two say "new": the first is the current one.
    expect(
      roles([pw(), pw({ words: 'new password' }), pw({ words: 'repeat new password' })]),
    ).toEqual(['password', 'new-password', 'new-password']);
  });

  it('reads one-time code boxes, and a password box is never a code', () => {
    expect(roles([box({ autocomplete: 'one-time-code' })])).toEqual(['totp']);
    expect(roles([pw({ words: 'verification code' })])).toEqual(['totp']);
    expect(roles([pw({ words: '2fa code', type: 'text' })])).toEqual(['totp']);
    expect(roles([pw({ words: 'password (not the code)' })])).toEqual(['password']);
  });

  it('reads a card form, every box by its own role', () => {
    expect(
      roles([
        box({ autocomplete: 'cc-name', words: 'name on card' }),
        box({ autocomplete: 'cc-number', secret: 'payment' }),
        box({ autocomplete: 'cc-exp', secret: 'payment' }),
        box({ autocomplete: 'cc-csc', secret: 'payment' }),
      ]),
    ).toEqual(['cardholder', 'cardNumber', 'expiry', 'cvv']);
    expect(roles([box({ secret: 'payment', words: 'security code' })])).toEqual(['cvv']);
  });

  it('leaves everything else alone', () => {
    expect(
      roles([
        box({ type: 'search', words: 'search' }),
        box({ words: 'first name' }),
        box({ words: 'promo code' }),
        box({ secret: 'identity', words: 'passport number' }),
      ]),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('which of your details a box asks for (ADR 0131, 2026-10-27)', () => {
  const role = (over: Partial<FieldFacts>) => identityRoleOf(box(over));

  it('reads autocomplete first, then the box’s words', () => {
    expect(role({ autocomplete: 'given-name' })).toBe('firstName');
    expect(role({ autocomplete: 'family-name' })).toBe('lastName');
    expect(role({ autocomplete: 'bday' })).toBe('birthday');
    expect(role({ autocomplete: 'address-line2' })).toBe('address2');
    expect(role({ words: 'first name' })).toBe('firstName');
    expect(role({ words: 'surname' })).toBe('lastName');
    expect(role({ words: 'date of birth' })).toBe('birthday');
    expect(role({ secret: 'identity', words: 'passport number' })).toBe('documentNumber');
    expect(role({ words: 'phone' })).toBe('phone');
  });

  it('tells a passport’s dates from its number', () => {
    expect(role({ words: 'passport expiry date' })).toBe('expiresOn');
    expect(role({ words: 'passport issue date' })).toBe('issuedOn');
  });

  it('never a password box, or a box that asks for something else', () => {
    expect(role({ type: 'password', words: 'first name' })).toBeUndefined();
    expect(role({ words: 'promo code' })).toBeUndefined();
    expect(role({ type: 'search', words: 'search' })).toBeUndefined();
  });
});

describe('where a fill may happen (ADR 0130 § Guards)', () => {
  it('fills on https, and on this computer', () => {
    expect(fillHost('https://www.example.com/login', undefined)).toEqual({
      host: 'www.example.com',
    });
    expect(fillHost('http://localhost:3000/', undefined)).toEqual({ host: 'localhost' });
    expect(fillHost('http://127.0.0.1:8080/', undefined)).toEqual({ host: '127.0.0.1' });
  });

  it('never fills a page without https', () => {
    expect(fillHost('http://example.com/login', undefined)).toEqual({ blocked: 'insecure' });
    expect(fillHost('http://192.168.1.1/', undefined)).toEqual({ blocked: 'insecure' });
    expect(fillHost('about:blank', undefined)).toEqual({ blocked: 'insecure' });
    expect(fillHost('data:text/html,<input type=password>', undefined)).toEqual({
      blocked: 'insecure',
    });
  });

  it('never fills a box from another origin inside the page, same site or not', () => {
    const page = 'https://shop.example.com/checkout';
    expect(fillHost(page, 'https://shop.example.com/frame')).toEqual({ host: 'shop.example.com' });
    expect(fillHost(page, 'https://evil.example/login')).toEqual({ blocked: 'frame' });
    expect(fillHost(page, 'https://login.example.com/')).toEqual({ blocked: 'frame' });
    expect(fillHost(page, 'https://shop.example.com:8443/')).toEqual({ blocked: 'frame' });
    expect(fillHost(page, 'http://shop.example.com/')).toEqual({ blocked: 'frame' });
    expect(fillHost(page, 'about:srcdoc')).toEqual({ blocked: 'frame' });
  });
});
