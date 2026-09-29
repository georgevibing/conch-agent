import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Tabs } from './Tabs';

function Example(props: { onValueChange?: (v: string) => void; value?: string }) {
  return (
    <Tabs defaultValue="a" {...props}>
      <Tabs.List aria-label="Views">
        <Tabs.Trigger value="a">Alpha</Tabs.Trigger>
        <Tabs.Trigger value="b" meta={3}>
          Beta
        </Tabs.Trigger>
        <Tabs.Trigger value="c" disabled>
          Gamma
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="a">Panel A</Tabs.Content>
      <Tabs.Content value="b">Panel B</Tabs.Content>
      <Tabs.Content value="c">Panel C</Tabs.Content>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('is accessible and shows the default panel', async () => {
    const { container } = renderNacre(<Example />);
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel A');
    await expectAccessible(container);
  });

  it('moves with arrow keys, skipping disabled tabs', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Example onValueChange={onValueChange} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Beta/ })).toHaveFocus();
    expect(onValueChange).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel B');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
  });

  it('renders exactly one indicator on the active tab', async () => {
    const { container } = renderNacre(<Example />);
    await userEvent.click(screen.getByRole('tab', { name: /Beta/ }));
    const indicators = container.querySelectorAll('[data-variant="line"][aria-hidden="true"]');
    expect(indicators).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /Beta/ })).toContainElement(
      indicators[0] as HTMLElement,
    );
  });

  it('supports controlled usage', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Example value="a" onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('tab', { name: /Beta/ }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
  });
});
