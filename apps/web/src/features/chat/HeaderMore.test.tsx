import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import { HeaderMore } from './HeaderMore';

afterEach(() => useUi.setState({ browserFor: null, find: null }));

describe('the phone header’s More', () => {
  it('holds find, the browser and the terminal in one button', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/terminal': () => ({ settings: { enabled: true }, sessions: [] }),
    });
    renderApp(<HeaderMore conversationId="c1" />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Find in chat' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Show the terminal' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Show the browser' }));
    expect(useUi.getState().browserFor).toBe('c1');
  });
});
