import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Callout } from './Callout';

describe('Callout', () => {
  it('renders title and description without a live role by default', async () => {
    const { container } = renderNacre(<Callout title="Heads up">Body copy</Callout>);
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Body copy')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await expectAccessible(container);
  });

  it('maps live regions to roles', () => {
    renderNacre(
      <>
        <Callout live="assertive">Error</Callout>
        <Callout live="polite">Saved</Callout>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Error');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('can hide the icon', () => {
    const { container } = renderNacre(<Callout icon={false}>No icon</Callout>);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('marks a callout with an action, so a narrow one can put it under the text', async () => {
    const { container } = renderNacre(
      <>
        <Callout title="Use the same app password?" action={<button type="button">Use it</button>}>
          Body
        </Callout>
        <Callout action={false}>No action</Callout>
      </>,
    );
    const [withAction, without] = container.querySelectorAll('[data-tone]');
    expect(withAction).toHaveAttribute('data-action');
    expect(without).not.toHaveAttribute('data-action');
    expect(screen.getByRole('button', { name: 'Use it' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
