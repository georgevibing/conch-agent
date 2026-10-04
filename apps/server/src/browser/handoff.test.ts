import { describe, expect, it } from 'vitest';

import { passed, type Gate } from './handoff';

const gate = (over: Partial<Gate> = {}): Gate => ({
  where: 'https://shop.example/login',
  secret: true,
  captcha: false,
  token: '',
  ...over,
});

describe('noticing you’re through a sign-in or a captcha', () => {
  it('is through once the page moved on and shows no password or code', () => {
    expect(
      passed(gate(), gate({ where: 'https://shop.example/account', secret: false }), false),
    ).toBe(true);
  });

  it('isn’t through while a code is still asked (two-step sign-in), or on the same page', () => {
    expect(passed(gate(), gate({ where: 'https://shop.example/2fa', secret: true }), false)).toBe(
      false,
    );
    // A wrong password: the same page again.
    expect(passed(gate(), gate({ secret: true }), false)).toBe(false);
    // Typed in, not sent yet: still the same page.
    expect(passed(gate(), gate({ secret: false }), false)).toBe(false);
  });

  it('is through when a captcha hands the page its token', () => {
    const start = gate({ secret: false, captcha: true });
    expect(passed(start, gate({ secret: false, captcha: true, token: 'abc' }), false)).toBe(true);
    expect(passed(start, gate({ secret: false, captcha: true }), false)).toBe(false);
  });

  it('is through when a sign-in window opened and closed again', () => {
    expect(passed(gate(), gate({ secret: false }), true)).toBe(true);
    // …unless the page still asks for the password.
    expect(passed(gate(), gate(), true)).toBe(false);
  });

  it('isn’t through on a page that still shows a captcha', () => {
    const start = gate({ secret: false, captcha: true });
    expect(
      passed(
        start,
        gate({ where: 'https://shop.example/next', secret: false, captcha: true }),
        false,
      ),
    ).toBe(false);
  });
});
