import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ApprovalSheet } from './ApprovalSheet';

const base = {
  open: true,
  onOpenChange: () => undefined,
  name: 'Pearl',
  where: 'Fix the build',
  title: 'Run the tests in conch-agent',
  until: 'No answer by 14:32 is a no.',
};

describe('ApprovalSheet', () => {
  it('shows exactly what will happen, and answers with one big press', async () => {
    const onDecide = vi.fn();
    renderNacre(
      <ApprovalSheet {...base} onDecide={onDecide}>
        <pre>npm test</pre>
      </ApprovalSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Run the tests in conch-agent' });
    expect(dialog).toHaveTextContent('Pearl asks first');
    expect(dialog).toHaveTextContent('Fix the build');
    expect(dialog).toHaveTextContent('npm test');
    expect(dialog).toHaveTextContent('No answer by 14:32 is a no.');
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onDecide).toHaveBeenCalledWith('allow');
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDecide).toHaveBeenCalledWith('deny');
    await expectAccessible(document.body);
  });

  it('says why a step that matters asks for a passkey first', async () => {
    const onDecide = vi.fn();
    renderNacre(
      <ApprovalSheet {...base} confirm="It sends something to other people." onDecide={onDecide} />,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'It sends something to other people. So it asks for your passkey or password first.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and allow' }));
    expect(onDecide).toHaveBeenCalledWith('allow');
  });

  it('waits while the answer goes, then says how it ended', async () => {
    const { rerender } = renderNacre(<ApprovalSheet {...base} sent="allow" onDecide={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Allow/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    rerender(<ApprovalSheet {...base} outcome="allow" onDecide={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Allowed');
    expect(screen.getByRole('button', { name: 'Back to the chat' })).toBeInTheDocument();
    await expectAccessible(document.body);
  });
});
