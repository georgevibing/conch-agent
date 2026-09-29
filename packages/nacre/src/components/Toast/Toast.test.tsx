import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { toast, Toaster } from './Toast';

afterEach(() => {
  act(() => toast.dismiss());
});

describe('Toast', () => {
  it('renders toasts inside a labelled, accessible region', async () => {
    renderNacre(<Toaster />);
    act(() => {
      toast.success('Changes applied', { description: '3 files edited' });
    });
    expect(await screen.findByText('Changes applied')).toBeInTheDocument();
    expect(screen.getByText('3 files edited')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: /Notifications/ });
    expect(region).toBeInTheDocument();
    await expectAccessible(region);
  });

  it('marks the toast type for styling', async () => {
    renderNacre(<Toaster />);
    act(() => {
      toast.error('Connection lost');
    });
    const title = await screen.findByText('Connection lost');
    expect(title.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
  });

  it('runs actions', async () => {
    const onUndo = vi.fn();
    renderNacre(<Toaster />);
    act(() => {
      toast('Session deleted', { action: { label: 'Undo', onClick: onUndo } });
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
  });
});
