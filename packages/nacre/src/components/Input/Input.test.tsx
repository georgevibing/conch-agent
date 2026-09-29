import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Input } from './Input';

describe('Input', () => {
  it('is accessible and forwards native props', async () => {
    const { container } = renderNacre(
      <Input aria-label="Search" placeholder="Find" type="search" />,
    );
    const input = screen.getByRole('searchbox', { name: 'Search' });
    expect(input).toHaveAttribute('placeholder', 'Find');
    await expectAccessible(container);
  });

  it('types and fires onChange', async () => {
    const onChange = vi.fn();
    renderNacre(<Input aria-label="Name" onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'abc');
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('textbox')).toHaveValue('abc');
  });

  it('clears an uncontrolled value, fires onChange and refocuses', async () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    renderNacre(
      <Input aria-label="Q" clearable defaultValue="hello" onChange={onChange} onClear={onClear} />,
    );
    const input = screen.getByRole('textbox');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(onChange).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Clear', hidden: true })).toBeDisabled();
  });

  it('keeps the clear button out of the tab order', async () => {
    renderNacre(<Input aria-label="Q" clearable defaultValue="x" />);
    await userEvent.tab();
    expect(screen.getByRole('textbox')).toHaveFocus();
    await userEvent.tab();
    expect(document.body).toHaveFocus();
  });

  it('marks invalid state', () => {
    renderNacre(<Input aria-label="Q" invalid />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });
});
