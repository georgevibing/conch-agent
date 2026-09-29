import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Field } from '../Field';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('is labelled through Field and accepts multi-line input', async () => {
    const { container } = renderNacre(
      <Field>
        <Field.Label>Prompt</Field.Label>
        <Textarea />
        <Field.Description>Markdown supported</Field.Description>
      </Field>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Prompt' });
    expect(textarea).toHaveAccessibleDescription('Markdown supported');
    await userEvent.type(textarea, 'one{Enter}two');
    expect(textarea).toHaveValue('one\ntwo');
    await expectAccessible(container);
  });

  it('uses rows when autosize is off', () => {
    renderNacre(<Textarea aria-label="Notes" autosize={false} minRows={5} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '5');
  });

  it('renders a footer', () => {
    renderNacre(<Textarea aria-label="Notes" footer="12/280" />);
    expect(screen.getByText('12/280')).toBeInTheDocument();
  });
});
