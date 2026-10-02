import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectAccessible, renderNacre } from '../../test/render';
import { DraftReview } from './DraftReview';

describe('DraftReview', () => {
  it('shows the exact account and message, including untrusted markup as inert text', async () => {
    const { container } = renderNacre(
      <DraftReview
        account="ada@work.example"
        to={['maya@example.com']}
        subject="Launch"
        body={'<script>bad()</script>\n[link](https://example.com)'}
      />,
    );
    expect(screen.getByText('ada@work.example')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Draft message' })).toHaveValue(
      '<script>bad()</script>\n[link](https://example.com)',
    );
    expect(container.querySelector('script,a,img')).toBeNull();
    await expectAccessible(container);
    await userEvent.tab();
    expect(screen.getByRole('textbox', { name: 'Draft message' })).toHaveFocus();
  });
});
