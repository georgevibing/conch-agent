import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TranscriptItem } from '../../live/reducer';
import { renderApp } from '../../test/harness';
import { PermissionCard } from './TranscriptItems';

describe('review a draft before saving', () => {
  it('shows the concrete message and offers a one-time save, not a standing approval', async () => {
    const respond = vi.fn();
    const item: Extract<TranscriptItem, { kind: 'permission' }> = {
      kind: 'permission',
      id: 'permission_draft',
      toolName: 'google_mail_create_draft',
      summary: 'Save a draft, not send it',
      input: {
        accountEmail: 'ada@work.example',
        to: ['maya@example.com'],
        subject: 'Friday',
        body: 'Please review the launch checklist.',
      },
    };
    renderApp(<PermissionCard item={item} name="Conch" onRespond={respond} />);
    expect(screen.getByText('ada@work.example')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Draft message' })).toHaveValue(
      'Please review the launch checklist.',
    );
    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Don’t save' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(respond).toHaveBeenCalledExactlyOnceWith('allow');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
});
