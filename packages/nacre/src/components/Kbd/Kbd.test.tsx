import { describe, expect, it } from 'vitest';

import { renderNacre } from '../../test/render';
import { formatKey, Kbd } from './Kbd';

describe('Kbd', () => {
  it('formats named keys as symbols', () => {
    expect(formatKey('shift')).toBe('⇧');
    expect(formatKey('k')).toBe('K');
    expect(formatKey('F5')).toBe('F5');
  });

  it('renders nested kbd per key', () => {
    const { container } = renderNacre(<Kbd keys="shift+enter" />);
    expect(container.querySelectorAll('kbd kbd')).toHaveLength(2);
  });
});
