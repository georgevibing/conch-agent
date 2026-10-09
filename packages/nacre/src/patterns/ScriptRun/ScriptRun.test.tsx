import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { asked, callsFor, invoiceResult, invoiceScript, tallyFor } from './fixtures';
import { ScriptRun, type ScriptRunProps } from './ScriptRun';

const done: ScriptRunProps = {
  title: 'Tag the invoices among my last 300 emails',
  headline: 'Tagged 47 invoices among 300 emails',
  state: 'done',
  script: invoiceScript,
  tally: tallyFor(300, 47),
  calls: callsFor(60, 10),
  callCount: 348,
  result: invoiceResult,
  durationMs: 12_400,
};

describe('ScriptRun', () => {
  it('is one line for the whole run, opening from the keyboard to the script, its calls and what it gave back', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<ScriptRun {...done} />);
    const row = screen.getByRole('button', { name: /^Tagged 47 invoices among 300 emails/ });
    expect(row).toHaveTextContent('348 tool calls');
    expect(row).toHaveAccessibleName(
      expect.stringContaining('a script, 348 tool calls, done') as unknown as string,
    );
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await expectAccessible(container);

    await user.tab();
    expect(row).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'The script' })).toHaveTextContent(
      'google_mail_search',
    );
    expect(screen.getByText(/"tagged": 47/)).toBeInTheDocument();

    // The calls, by kind: each kind opens to its own calls, the latest few in reach.
    const kinds = screen.getByRole('region', { name: 'What it called' });
    const read = within(kinds).getByRole('button', { name: /Read an email/ });
    expect(read).toHaveTextContent('×300');
    await user.click(read);
    expect(within(kinds).getByText(/The last 25 of 60\./)).toBeInTheDocument();
    await expectAccessible(container);
    await user.click(within(kinds).getByRole('button', { name: 'Show all' }));
    expect(within(kinds).queryByText(/The last 25 of 60/)).not.toBeInTheDocument();
    expect(within(kinds).getAllByText(/^#\d+$/).length).toBeGreaterThanOrEqual(60);
  });

  it('says how far it is while it runs, with a counter per kind of call, and Stops', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { container } = renderNacre(
      <ScriptRun
        {...done}
        state="running"
        headline={undefined}
        live="Tagged 12 invoices so far"
        progress={{ done: 120, total: 300, label: 'emails' }}
        tally={tallyFor(120, 12, true)}
        calls={callsFor(120, 12, true)}
        startedAt={Date.now() - 4_000}
        onStop={onStop}
      />,
    );
    // While it runs the line says what it's for; the outcome is how far.
    expect(screen.getByRole('button', { name: /^Tag the invoices/ })).toHaveTextContent(
      '120 of 300 emails',
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '120');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '300');
    const counters = screen.getByRole('list', { name: 'Calls so far' });
    expect(within(counters).getByText('Read an email')).toBeInTheDocument();
    expect(within(counters).getByLabelText('120 times')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('holds a question under its line, and lists what it asked', async () => {
    const { container } = renderNacre(
      <ScriptRun
        {...done}
        state="running"
        asks={asked}
        approval={<p>Step 48 of the script: send an email to noreply@shop.example</p>}
        defaultOpen
      />,
    );
    expect(screen.getByText(/Step 48 of the script/)).toBeInTheDocument();
    expect(screen.getByText('Waiting for your answer')).toBeInTheDocument();
    const asks = screen.getByRole('region', { name: 'What it asked you' });
    expect(within(asks).getByText('You said no')).toBeInTheDocument();
    expect(within(asks).getByText('Waiting for you')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('puts back everything it changed with one press, and again', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { rerender } = renderNacre(<ScriptRun {...done} changes={{ count: 47, onUndo }} />);
    await user.click(screen.getByRole('button', { name: 'Undo all 47 changes' }));
    expect(onUndo).toHaveBeenCalledOnce();
    rerender(<ScriptRun {...done} changes={{ count: 47, undone: true, onRedo }} />);
    await user.click(screen.getByRole('button', { name: 'Put all 47 back again' }));
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it('is calm when it fails or is stopped: a warm note, never a red flood', async () => {
    const { container, rerender } = renderNacre(
      <ScriptRun
        {...done}
        state="failed"
        headline={undefined}
        error="Line 4: TypeError: x is undefined"
        defaultOpen
      />,
    );
    expect(screen.getByRole('button', { name: /^Tag the invoices/ })).toHaveTextContent(
      'Didn’t finish',
    );
    expect(screen.getByText('Line 4: TypeError: x is undefined')).toBeInTheDocument();
    await expectAccessible(container);
    rerender(<ScriptRun {...done} state="stopped" headline={undefined} />);
    expect(screen.getByRole('button', { name: /^Tag the invoices/ })).toHaveTextContent(
      'Stopped after 348 tool calls',
    );
  });

  it('announces its start and end once, not each call', () => {
    const { rerender, container } = renderNacre(
      <ScriptRun {...done} state="running" headline={undefined} arriving />,
    );
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('Started a script: Tag the invoices among my last 300 emails');
    rerender(
      <ScriptRun
        {...done}
        state="running"
        headline={undefined}
        arriving
        tally={tallyFor(200, 20)}
      />,
    );
    expect(live).toHaveTextContent('Started a script');
    rerender(<ScriptRun {...done} arriving />);
    expect(live).toHaveTextContent(
      'Script done: Tagged 47 invoices among 300 emails, 348 tool calls',
    );
  });
});
