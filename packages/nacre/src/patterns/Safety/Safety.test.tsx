import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { GuardNote, TaintNotice } from './TaintNotice';

describe('TaintNotice and GuardNote', () => {
  it('say what was read and what changes, quietly', async () => {
    const { container, rerender } = renderNacre(<TaintNotice read="news.example" />);
    expect(container).toHaveTextContent(
      'Read news.example. From here on, I’ll check with you before running commands or sending anything.',
    );
    rerender(<TaintNotice read="things in Gmail" first={false} />);
    expect(container).toHaveTextContent('Read things in Gmail.');
    expect(container).not.toHaveTextContent('From here on');
    rerender(<GuardNote>This chat read news.example.</GuardNote>);
    expect(screen.getByText('This chat read news.example.')).toBeInTheDocument();
    await expectAccessible(container);
  });
});
