import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Popover } from '../../components/Popover';
import { expectAccessible, renderNacre } from '../../test/render';
import {
  meteredBudget,
  meteredCritical,
  meteredNoBudget,
  meteredOverBudget,
  planExhausted,
  planHealthy,
  planNoWindows,
  planWarning,
  planWithExtra,
  usageNow,
  usageUnknown,
} from './fixtures';
import type { UsageValue } from './types';
import { ProviderMeter } from './ProviderMeter';
import { UsageMeter } from './UsageMeter';
import { UsageNotice } from './UsageNotice';
import { UsagePanel } from './UsagePanel';

const tz = { locale: 'en-US', timeZone: 'UTC' };

describe('ProviderMeter', () => {
  it('names the provider and what is left of its tightest limit', async () => {
    const { container } = renderNacre(
      <ProviderMeter
        provider={{ label: 'Codex', logo: 'openai' }}
        usage={planHealthy}
        now={usageNow}
      />,
    );
    const meter = screen.getByRole('button', {
      name: 'Codex. Usage: 39% left of weekly limit, resets in 3 days',
    });
    expect(meter).toHaveTextContent('Codex39% left');
    await expectAccessible(container);
  });

  it('shows only the name when there is nothing to run out of', () => {
    renderNacre(
      <ProviderMeter
        provider={{ label: 'Ollama', logo: 'local' }}
        usage={meteredNoBudget}
        now={usageNow}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ollama' })).toHaveTextContent(/^Ollama$/);
  });

  it('asks for the person only when the provider needs them', async () => {
    const { container } = renderNacre(
      <ProviderMeter provider={{ label: 'Codex', logo: 'openai' }} attention="Sign in" />,
    );
    const meter = screen.getByRole('button', { name: 'Codex: Sign in' });
    expect(meter).toHaveAttribute('data-severity', 'warning');
    await expectAccessible(container);
  });

  it('offers to connect one when there is none, and opens with Enter', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = renderNacre(<ProviderMeter onClick={onClick} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Connect a provider' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('UsageMeter', () => {
  it('shows what is left of the tightest window and says so', async () => {
    const { container } = renderNacre(<UsageMeter value={planHealthy} now={usageNow} />);
    const meter = screen.getByRole('button', {
      name: 'Usage: 39% left of weekly limit, resets in 3 days',
    });
    expect(meter).toHaveTextContent('39% left');
    expect(meter).toHaveAttribute('data-severity', 'normal');
    await expectAccessible(container);
  });

  it.each<[string, UsageValue, string]>([
    ['warning', planWarning, 'warning'],
    ['exhausted', planExhausted, 'exhausted'],
    ['metered', meteredNoBudget, 'normal'],
    ['budget', meteredBudget, 'warning'],
    ['unknown', usageUnknown, 'normal'],
  ])('renders the %s state accessibly', async (_, value, severity) => {
    const { container } = renderNacre(<UsageMeter value={value} now={usageNow} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-severity', severity);
    await expectAccessible(container);
  });

  it('is focusable and opens its popover with Enter', async () => {
    const user = userEvent.setup();
    renderNacre(
      <Popover.Root>
        <Popover.Trigger asChild>
          <UsageMeter value={planHealthy} now={usageNow} />
        </Popover.Trigger>
        <Popover.Content aria-label="Usage details" padding="none">
          <UsagePanel value={planHealthy} now={usageNow} {...tz} />
        </Popover.Content>
      </Popover.Root>,
    );
    await user.tab();
    const meter = screen.getByRole('button', { name: /^Usage:/ });
    expect(meter).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Usage details' })).toBeInTheDocument();
    expect(meter).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('UsagePanel', () => {
  it.each<[string, UsageValue]>([
    ['plan', planHealthy],
    ['plan with extra', planWithExtra],
    ['exhausted plan', planExhausted],
    ['plan without windows', planNoWindows],
    ['metered', meteredNoBudget],
    ['metered with budget', meteredBudget],
    ['over budget', meteredOverBudget],
    ['unknown', usageUnknown],
  ])('renders %s accessibly', async (_, value) => {
    const { container } = renderNacre(
      <UsagePanel
        value={value}
        now={usageNow}
        onRefresh={() => {}}
        onSetBudget={() => {}}
        {...tz}
      />,
    );
    await expectAccessible(container);
  });

  it('gives each window a progressbar that speaks what is left', () => {
    renderNacre(<UsagePanel value={planHealthy} now={usageNow} {...tz} />);
    const session = screen.getByRole('progressbar', { name: 'Current session' });
    expect(session).toHaveAttribute('aria-valuenow', '62');
    expect(session).toHaveAttribute('aria-valuetext', '62% left, resets in 2 h 14 min');
    expect(screen.getByText(/Resets in 2 h 14 min · 3:44\sPM/)).toBeInTheDocument();
    const opus = screen.getByRole('progressbar', { name: /This week\s*· Opus/ });
    expect(opus).toHaveAttribute('aria-valuetext', '78% left, resets in 3 days');
  });

  it('emphasises the headline window, not the first one', () => {
    renderNacre(<UsagePanel value={planHealthy} now={usageNow} {...tz} />);
    const weekly = screen.getByRole('progressbar', { name: /This week\s*· all models/ });
    expect(weekly.closest('[data-emphasis]')).not.toBeNull();
    const session = screen.getByRole('progressbar', { name: 'Current session' });
    expect(session.closest('[data-emphasis]')).toBeNull();
  });

  it('explains a block and marks the window used up', () => {
    renderNacre(<UsagePanel value={planExhausted} now={usageNow} {...tz} />);
    expect(
      screen.getByText(/You’ve reached your limit\. Sending works again in 38 min \(2:08\sPM\)\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Current session' })).toHaveAttribute(
      'aria-valuetext',
      'Used up, resets in 38 min',
    );
  });

  it('shows spend and the budget for metered', async () => {
    const onSetBudget = vi.fn();
    const user = userEvent.setup();
    renderNacre(<UsagePanel value={meteredBudget} now={usageNow} onSetBudget={onSetBudget} />);
    expect(screen.getByText('$4.20')).toBeInTheDocument();
    expect(screen.getByText('$38.10 this month')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Monthly budget' })).toHaveAttribute(
      'aria-valuetext',
      '$11.90 left of $50',
    );
    await user.click(screen.getByRole('button', { name: 'Change budget' }));
    expect(onSetBudget).toHaveBeenCalledOnce();
  });

  it('invites a budget when there is none', () => {
    renderNacre(<UsagePanel value={meteredNoBudget} now={usageNow} onSetBudget={() => {}} />);
    expect(screen.getByText('Pay as you go')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a monthly budget' })).toBeInTheDocument();
  });

  it('refreshes on demand', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderNacre(
      <UsagePanel value={planHealthy} now={usageNow} onRefresh={onRefresh} />,
    );
    expect(screen.getByText('Updated 2 min ago')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh usage' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(<UsagePanel value={planHealthy} now={usageNow} onRefresh={onRefresh} refreshing />);
    const button = screen.getByRole('button', { name: 'Refresh usage' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

describe('UsageNotice', () => {
  it('stays hidden while things are healthy', () => {
    const { container } = renderNacre(
      <>
        <UsageNotice value={planHealthy} now={usageNow} />
        <UsageNotice value={meteredNoBudget} now={usageNow} />
        <UsageNotice value={usageUnknown} now={usageNow} />
      </>,
    );
    expect(container.firstElementChild).toBeEmptyDOMElement();
  });

  it('warns politely when a window runs low', async () => {
    const { container } = renderNacre(<UsageNotice value={planWarning} now={usageNow} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      '12% of your current session left · resets in 1 h 4 min',
    );
    await expectAccessible(container);
  });

  it('says who carries on once a limit is reached, and only then', () => {
    const { rerender } = renderNacre(
      <UsageNotice value={planExhausted} now={usageNow} carryOn="OpenRouter" {...tz} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('OpenRouter answers until then');
    rerender(<UsageNotice value={planWarning} now={usageNow} carryOn="OpenRouter" />);
    expect(screen.getByRole('status')).not.toHaveTextContent('OpenRouter');
  });

  it('opens details and dismisses', async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    const { container } = renderNacre(
      <UsageNotice
        value={planExhausted}
        now={usageNow}
        onOpen={onOpen}
        onDismiss={onDismiss}
        {...tz}
      />,
    );
    const open = screen.getByRole('button', { name: /reached your current session limit/ });
    await user.click(open);
    expect(onOpen).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('talks money for metered budgets', async () => {
    const { container } = renderNacre(
      <>
        <UsageNotice value={meteredCritical} now={usageNow} />
        <UsageNotice value={meteredOverBudget} now={usageNow} />
      </>,
    );
    const [critical, over] = screen.getAllByRole('status');
    expect(critical).toHaveTextContent('$3.10 left of your $50 monthly budget');
    expect(over).toHaveTextContent("You're $2.40 over your $50 monthly budget");
    await expectAccessible(container);
  });
});
