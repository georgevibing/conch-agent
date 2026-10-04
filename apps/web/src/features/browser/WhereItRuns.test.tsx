import { BrowserStatus } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { WhereItRuns } from './WhereItRuns';

afterEach(() => vi.unstubAllGlobals());

const status = (backend: Partial<NonNullable<BrowserStatus['backend']>> = {}) =>
  BrowserStatus.parse({
    phase: 'running',
    settings: {},
    candidates: [],
    backend: {
      chosen: 'local',
      using: 'local',
      saved: { browserbase: false, steel: false },
      ...backend,
    },
  });

const guard = (task: () => Promise<void>) => task().then(() => true);

describe('where the browser runs', () => {
  it('takes a cloud key once, and sends it only to Conch', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'PUT /api/browser/backend': () => status({ chosen: 'browserbase', using: 'browserbase' }),
    });
    renderApp(<WhereItRuns status={status()} name="Conch" guard={guard} />);
    await user.click(screen.getByRole('radio', { name: /Browserbase/ }));
    const use = screen.getByRole('button', { name: 'Use Browserbase' });
    expect(use).toBeDisabled();
    await user.type(screen.getByLabelText('API key'), 'bb_live_' + 'abcdef123');
    await user.type(screen.getByLabelText(/Project ID/), 'proj-1');
    await user.click(use);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/api/browser/backend',
        body: { kind: 'browserbase', key: 'bb_live_abcdef123', project: 'proj-1' },
      }),
    );
  });

  it('walks you through your Chrome, and says when it can’t be reached', async () => {
    const user = userEvent.setup();
    mockFetch({ 'GET /api/browser': () => status({ chosen: 'chrome', chrome: 'closed' }) });
    renderApp(
      <WhereItRuns
        status={status({
          chosen: 'chrome',
          chrome: 'closed',
          fellBack:
            'Your Chrome isn’t open with remote debugging allowed. Until then, Conch uses its own browser.',
        })}
        name="Conch"
        guard={guard}
      />,
    );
    expect(screen.getByRole('radio', { name: /Your Chrome/ })).toBeChecked();
    expect(screen.getByText('Not reached')).toBeInTheDocument();
    expect(screen.getByText('Conch is using its own browser for now')).toBeInTheDocument();
    expect(screen.getByText('chrome://inspect/#remote-debugging')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Chrome');
    expect(screen.getByRole('button', { name: 'Use my Chrome' })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: /Its own browser/ }));
    expect(screen.getByRole('button', { name: 'Use its own browser' })).toBeInTheDocument();
  });
});
