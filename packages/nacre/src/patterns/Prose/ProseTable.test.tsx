import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Prose } from './Prose';
import { ProseTable } from './ProseTable';

function sizes(scroll: number, client: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scroll);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(client);
}

function table(label?: string) {
  return (
    <Prose>
      <ProseTable label={label}>
        <thead>
          <tr>
            <th>Probe</th>
            <th>Result</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Read-only tools</td>
            <td>Passed</td>
            <td>Both calls reported success.</td>
          </tr>
        </tbody>
      </ProseTable>
    </Prose>
  );
}

describe('ProseTable', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sits still when it fits: no group, no tab stop, no fades', async () => {
    sizes(300, 300);
    const { container } = renderNacre(table());
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    const grid = screen.getByRole('table');
    expect(grid.parentElement).toHaveAttribute('data-fade-start', 'false');
    expect(grid.parentElement).toHaveAttribute('data-fade-end', 'false');
    expect(grid.style.getPropertyValue('--pt-cols')).toBe('3');
    await expectAccessible(container);
  });

  it('scrolls when wider than its space: a labelled, focusable group fading at the far edge', async () => {
    sizes(600, 300);
    const { container } = renderNacre(table('Probe results'));
    const region = screen.getByRole('group', { name: 'Probe results' });
    expect(region).toHaveAttribute('data-fade-start', 'false');
    expect(region).toHaveAttribute('data-fade-end', 'true');
    await userEvent.tab();
    expect(region).toHaveFocus();
    await expectAccessible(container);
  });

  it('fades both edges mid-scroll and only the near one at the end', () => {
    sizes(600, 300);
    renderNacre(table());
    const region = screen.getByRole('group', { name: 'Table' });
    region.scrollLeft = 150;
    region.dispatchEvent(new Event('scroll'));
    expect(region).toHaveAttribute('data-fade-start', 'true');
    expect(region).toHaveAttribute('data-fade-end', 'true');
    region.scrollLeft = 300;
    region.dispatchEvent(new Event('scroll'));
    expect(region).toHaveAttribute('data-fade-start', 'true');
    expect(region).toHaveAttribute('data-fade-end', 'false');
  });
});
