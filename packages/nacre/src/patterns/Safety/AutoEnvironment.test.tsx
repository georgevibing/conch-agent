import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AUTO_ENVIRONMENT_MAX, AutoEnvironment } from './AutoEnvironment';

function Controlled({
  onChange,
  initial = '',
}: {
  onChange: (v: string) => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AutoEnvironment
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('AutoEnvironment', () => {
  it('is one labelled field the person types their note into', async () => {
    const onChange = vi.fn();
    const { container } = renderNacre(<Controlled onChange={onChange} />);
    const field = screen.getByRole('textbox', {
      name: 'What Auto should know about where you work',
    });
    expect(field).toHaveAccessibleDescription(/what production means here/);
    await userEvent.type(field, 'staging is ours');
    expect(onChange).toHaveBeenLastCalledWith('staging is ours');
    // Quiet until it's nearly full: no count yet.
    expect(screen.queryByText(/of 2,000/)).toBeNull();
    await expectAccessible(container);
  });

  it('counts only when nearly full, and stops at the limit', async () => {
    const { container } = renderNacre(
      <Controlled onChange={() => undefined} initial={'x'.repeat(AUTO_ENVIRONMENT_MAX - 10)} />,
    );
    expect(screen.getByText('1,990 of 2,000')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', String(AUTO_ENVIRONMENT_MAX));
    await expectAccessible(container);
  });
});
