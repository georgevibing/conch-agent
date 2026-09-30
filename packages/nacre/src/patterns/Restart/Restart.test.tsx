import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { RestartScreen } from './RestartScreen';

describe('RestartScreen', () => {
  it('says what’s happening, politely, with nothing to press', async () => {
    const { container } = renderNacre(
      <RestartScreen title="Updating Conch" detail="Your chats are safe." />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Updating ConchYour chats are safe.');
    expect(screen.queryByRole('button')).toBeNull();
    await expectAccessible(container);
  });
});
