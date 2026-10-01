import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Button } from './Button';

describe('Button', () => {
  it('renders an accessible button that defaults to type="button"', async () => {
    const { container } = renderNacre(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    await expectAccessible(container);
  });

  it('calls onClick on click and keyboard activation', async () => {
    const onClick = vi.fn();
    renderNacre(<Button onClick={onClick}>Go</Button>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('blocks activation and announces busy state while loading', async () => {
    const onClick = vi.fn();
    renderNacre(
      <Button loading onClick={onClick}>
        Send
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    renderNacre(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults tone by variant', () => {
    renderNacre(
      <>
        <Button>Solid</Button>
        <Button variant="surface">Surface</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Solid' })).toHaveAttribute('data-tone', 'accent');
    expect(screen.getByRole('button', { name: 'Surface' })).toHaveAttribute('data-tone', 'neutral');
  });

  it('renders the child element when asChild is set', () => {
    renderNacre(
      <Button asChild>
        <a href="/docs">Docs</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link).toHaveAttribute('data-lustre');
    expect(link).not.toHaveAttribute('type');
  });

  it('keeps its icons around the child’s own words when asChild is set', () => {
    renderNacre(
      <Button
        asChild
        leadingIcon={<svg data-testid="lead" />}
        trailingIcon={<svg data-testid="trail" />}
      >
        <a href="/docs">Docs</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link).toContainElement(screen.getByTestId('lead'));
    expect(link).toContainElement(screen.getByTestId('trail'));
    expect(link.textContent).toBe('Docs');
  });
});
