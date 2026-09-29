import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { QRCode } from './QRCode';

describe('QRCode', () => {
  it('renders an SVG image with a label', async () => {
    const { container } = renderNacre(
      <QRCode value="https://mac.tail1234.ts.net/#pair=abc" label="Scan to sign in" size={160} />,
    );
    const img = screen.getByRole('img', { name: 'Scan to sign in' });
    expect(img).toHaveAttribute('width', '160');
    expect(img.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(100);
    await expectAccessible(container);
  });
});
