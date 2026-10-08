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

  it('shows who an email goes from, its copies and its files, and says it sends', async () => {
    const { container } = renderNacre(
      <DraftReview
        kind="send"
        account="pro@example.com"
        to={['sam@example.org']}
        cc={['ana@example.org']}
        subject="Invoice"
        body="Attached."
        files={['invoice.pdf']}
      />,
    );
    expect(screen.getByRole('region', { name: 'Email to review' })).toBeInTheDocument();
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('pro@example.com')).toBeInTheDocument();
    expect(screen.getByText('ana@example.org')).toBeInTheDocument();
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email message' })).toHaveValue('Attached.');
    expect(screen.getByText('Sends this email as it is from pro@example.com.')).toBeInTheDocument();
    await expectAccessible(container);
  });
});
