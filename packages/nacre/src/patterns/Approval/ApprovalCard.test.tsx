import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ApprovalCard, ApprovalLine } from './ApprovalCard';

describe('ApprovalCard', () => {
  it('says what will happen, the facts in a line, the caution quietly, and decides by keyboard', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    const { container } = renderNacre(
      <ApprovalCard
        title="Edit your picture with Gemini on OpenRouter"
        cost="Paid"
        detail="Your picture goes to OpenRouter"
        caution="This chat read GitHub and Yazio content. Check this is what you asked for."
        onDecide={onDecide}
      />,
    );
    const card = screen.getByRole('group', {
      name: 'Asks first: Edit your picture with Gemini on OpenRouter',
    });
    expect(card).toHaveTextContent('Paid·Your picture goes to OpenRouter');
    expect(card).toHaveTextContent('This chat read GitHub and Yazio content.');
    await expectAccessible(container);
    // Allow leads in the reading order's end, the one obvious button; Deny is there too.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Deny', 'Always allow', 'Allow']);
    screen.getByRole('button', { name: 'Allow' }).focus();
    await user.keyboard('{Enter}');
    expect(onDecide).toHaveBeenCalledWith('allow');
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDecide).toHaveBeenLastCalledWith('deny');
  });

  it('asks this once when “always” would be untrue, and waits while the answer is sent', () => {
    renderNacre(<ApprovalCard title="Send an email to Grace" allowAlways={false} sent="allow" />);
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull();
    expect(screen.getByRole('button', { name: /Deny/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Allow/ })).toBeDisabled();
  });

  it('shows what exactly it would do', () => {
    renderNacre(
      <ApprovalCard title="Run a command">
        <pre>npm test</pre>
      </ApprovalCard>,
    );
    expect(screen.getByText('npm test')).toBeInTheDocument();
  });
});

describe('ApprovalLine', () => {
  it('says the answer in one quiet line, no as neutral', async () => {
    const { container } = renderNacre(
      <>
        <ApprovalLine decision="deny">Send an email to Grace</ApprovalLine>
        <ApprovalLine decision="allow-always">Create a page in Notion</ApprovalLine>
      </>,
    );
    expect(screen.getByText('You said no')).toBeInTheDocument();
    expect(screen.getByText('Always allowed')).toBeInTheDocument();
    expect(container.querySelector('[data-decision="deny"]')).toHaveTextContent(
      'You said no · Send an email to Grace',
    );
    await expectAccessible(container);
  });
});
