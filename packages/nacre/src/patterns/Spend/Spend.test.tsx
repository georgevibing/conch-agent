import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { costDetail, costSentence, costShort } from './format';
import { ChatSpendChip, SpendLimitCard, SpendNote, switchWords, TurnCostTag } from './Spend';

describe('TurnCostTag', () => {
  it('shows a reply’s cost quietly, and the detail a tap away', async () => {
    const { container } = renderNacre(
      <TurnCostTag
        cost={{ billing: 'metered', usd: 0.042, priced: 'list', savedUsd: 0.031 }}
        tokens={{ inputTokens: 18_200, cachedInputTokens: 12_000, outputTokens: 900 }}
      />,
    );
    const tag = screen.getByRole('button', {
      name: 'This reply cost about $0.04, at list prices.',
    });
    expect(tag).toHaveTextContent('$0.04');
    await userEvent.click(tag);
    expect(await screen.findByText('Reading from the cache saved about $0.03')).toBeVisible();
    expect(
      screen.getByText('18,200 tokens read (12,000 from the cache) · 900 written'),
    ).toBeVisible();
    await expectAccessible(container);
  });

  it('on a plan says the plan and its window, not money', async () => {
    renderNacre(
      <TurnCostTag
        cost={{
          billing: 'plan',
          usd: 0.38,
          plan: { source: 'Claude Max', window: { label: 'Current session', usedPercent: 42 } },
        }}
      />,
    );
    const tag = screen.getByRole('button', {
      name: 'This reply was on your Claude Max plan: nothing to pay.',
    });
    expect(tag).toHaveTextContent('Plan');
    await userEvent.click(tag);
    expect(await screen.findByText('Current session: 42% used')).toBeVisible();
    expect(screen.getByText('About $0.38 of work at list prices')).toBeVisible();
  });

  it('says nothing for a reply on this computer, or one it can’t price', () => {
    renderNacre(
      <>
        <TurnCostTag cost={{ billing: 'free' }} />
        <TurnCostTag cost={{ billing: 'metered' }} />
      </>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ChatSpendChip', () => {
  it('adds the chat up, and sets a limit of its own', async () => {
    const onSetLimit = vi.fn();
    const { container } = renderNacre(
      <ChatSpendChip
        spend={{ usd: 0.31, tasksUsd: 0.08, savedUsd: 0.12 }}
        onSetLimit={onSetLimit}
      />,
    );
    const chip = screen.getByRole('button', {
      name: 'This chat has spent $0.31. Details and limit',
    });
    await userEvent.click(chip);
    expect(await screen.findByText('This chat has spent $0.31')).toBeVisible();
    expect(screen.getByText('$0.08 of it by tasks started from here')).toBeVisible();
    expect(screen.getByText('Reading from the cache saved about $0.12')).toBeVisible();
    const set = screen.getByRole('button', { name: 'Set limit' });
    expect(set).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Limit for this chat'), '2');
    await userEvent.click(set);
    expect(onSetLimit).toHaveBeenCalledWith(2);
    await expectAccessible(container);
  });

  it('says when an amount isn’t one, and takes a limit off', async () => {
    const onSetLimit = vi.fn();
    renderNacre(<ChatSpendChip spend={{ usd: 1.7, capUsd: 2 }} onSetLimit={onSetLimit} />);
    await userEvent.click(
      screen.getByRole('button', {
        name: 'This chat has spent $1.70 of its $2 limit. Details and limit',
      }),
    );
    const field = await screen.findByLabelText('Limit for this chat');
    await userEvent.clear(field);
    await userEvent.type(field, 'lots');
    expect(screen.getByText('Enter an amount above zero, like 2.')).toBeVisible();
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Remove limit' }));
    expect(onSetLimit).toHaveBeenCalledWith(null);
  });
});

describe('SpendLimitCard', () => {
  it('says the limit in a sentence, with the three choices', async () => {
    const onRaise = vi.fn();
    const onSwitch = vi.fn();
    const onStop = vi.fn();
    const { container } = renderNacre(
      <SpendLimitCard
        limit="chat"
        spentUsd={2.04}
        limitUsd={2}
        raiseTo={5}
        switchTo={{ label: 'Gemma 3', why: 'local' }}
        onRaise={onRaise}
        onSwitch={onSwitch}
        onStop={onStop}
      />,
    );
    const card = screen.getByRole('group', { name: 'This chat has reached its $2 limit' });
    expect(card).toHaveTextContent('It has spent $2.04. Your message is waiting.');
    await userEvent.click(screen.getByRole('button', { name: 'Raise to $5' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use Gemma 3 on this computer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop here' }));
    expect(onRaise).toHaveBeenCalledOnce();
    expect(onSwitch).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('for the month, and a reply stopped part way', () => {
    renderNacre(
      <SpendLimitCard limit="month" spentUsd={50.12} limitUsd={50} raiseTo={100} during />,
    );
    expect(
      screen.getByRole('group', { name: 'You’ve reached this month’s $50 budget' }),
    ).toHaveTextContent(
      'Chats have spent $50.12 this month. The reply stopped part way, and carries on when you choose.',
    );
  });

  it('folds to a quiet line once chosen', async () => {
    const { container } = renderNacre(
      <SpendLimitCard
        limit="chat"
        spentUsd={2}
        limitUsd={2}
        raiseTo={5}
        switchTo={{ label: 'Haiku 4.5', why: 'cheaper', allowUsd: 0.5 }}
        state="switched"
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Carried on with Haiku 4.5');
    expect(screen.queryByRole('button')).toBeNull();
    await expectAccessible(container);
  });

  it('names the model to carry on with plainly', () => {
    expect(switchWords({ label: 'Haiku 4.5', why: 'cheaper', allowUsd: 0.5 })).toBe(
      'Use Haiku 4.5, up to $0.50 more',
    );
    expect(switchWords({ label: 'Opus', provider: 'Claude Code', why: 'plan' })).toBe(
      'Use Opus on Claude Code',
    );
  });
});

describe('SpendNote', () => {
  it('is a quiet note', async () => {
    const { container } = renderNacre(<SpendNote>Nearly at your budget.</SpendNote>);
    expect(screen.getByRole('note')).toHaveTextContent('Nearly at your budget.');
    await expectAccessible(container);
  });
});

describe('cost words', () => {
  it('says what a reply cost the way it was charged', () => {
    expect(costShort({ billing: 'metered', usd: 0.004 })).toBe('<$0.01');
    expect(costShort({ billing: 'free' })).toBeUndefined();
    expect(costSentence({ billing: 'metered', usd: 0.5, priced: 'provider' })).toBe(
      'This reply cost $0.50.',
    );
    expect(costSentence({ billing: 'metered' })).toBe('Conch doesn’t know this model’s price.');
    expect(costDetail({ billing: 'metered', usd: 1, savedUsd: 0.001 }, undefined)).toEqual([]);
  });
});
