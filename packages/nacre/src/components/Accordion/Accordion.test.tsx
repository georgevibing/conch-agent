import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Accordion } from './Accordion';

function Example() {
  return (
    <Accordion type="single" collapsible>
      <Accordion.Item value="a">
        <Accordion.Trigger>First</Accordion.Trigger>
        <Accordion.Content>First body</Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="b">
        <Accordion.Trigger meta="2">Second</Accordion.Trigger>
        <Accordion.Content>Second body</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
}

describe('Accordion', () => {
  it('renders headings with buttons and is accessible', async () => {
    const { container } = renderNacre(<Example />);
    expect(screen.getAllByRole('heading')).toHaveLength(2);
    await expectAccessible(container);
  });

  it('supports arrow-key navigation and toggling', async () => {
    renderNacre(<Example />);
    const user = userEvent.setup();
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: /Second/ });
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Second body')).toBeVisible();
    await user.keyboard('{Enter}');
    expect(second).toHaveAttribute('aria-expanded', 'false');
  });
});
