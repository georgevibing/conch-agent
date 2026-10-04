import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { unwrapRef } from './tools';

const Ref = z.preprocess(unwrapRef, z.string().regex(/^[a-z0-9]{1,16}$/i));

describe('a ref the way a model copied it (ADR 0072)', () => {
  it.each(['e12', '[ref=e12]', 'ref=e12', 'e12]', '[e12]', '"e12"', ' ref: e12 ', '`e12`'])(
    'reads %s as e12',
    (written) => {
      expect(Ref.parse(written)).toBe('e12');
    },
  );

  it('advertises the plain ref schema to the model', () => {
    expect(z.toJSONSchema(z.object({ ref: Ref }), { io: 'input' })).toMatchObject({
      properties: { ref: { type: 'string', pattern: '^[a-z0-9]{1,16}$' } },
      required: ['ref'],
    });
  });

  it.each([
    'e12] >> css=body',
    'aria-ref=e12',
    'e12 e13',
    '[ref=e12][ref=e13]',
    'e1234567890123456789',
    'ref=',
    '',
  ])('never lets anything but a bare ref through: %s', (written) => {
    expect(Ref.safeParse(written).success).toBe(false);
  });

  it('leaves what isn’t text to the check', () => {
    expect(unwrapRef(12)).toBe(12);
    expect(Ref.safeParse(12).success).toBe(false);
  });
});
