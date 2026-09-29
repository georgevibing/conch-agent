import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { Sidebar } from './Sidebar';

afterEach(() => vi.unstubAllGlobals());

const base = {
  id: 'c1',
  title: 'Hi conch how are you',
  preview: 'Hi conch how are you',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: 'running' as const,
  options: {},
};

describe('Sidebar titles', () => {
  it('shimmers the first line while a title is written, then shows it', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [{ ...base, titling: true }],
    });
    renderApp(<Sidebar />);
    const pending = await screen.findByText('Hi conch how are you');
    expect(pending).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(FakeSocket.last).toBeDefined());

    act(() => {
      FakeSocket.last?.push({
        type: 'conversation.updated',
        conversation: { ...base, title: 'Friendly check-in', status: 'idle' },
      });
    });
    const titled = await screen.findByText('Friendly check-in');
    expect(titled).not.toHaveAttribute('aria-busy');
    expect(titled).toHaveAttribute('data-revealed');
    expect(screen.getByRole('link', { name: 'Friendly check-in' })).toBeInTheDocument();
    expect(screen.queryByText('Hi conch how are you')).not.toBeInTheDocument();
  });
});
