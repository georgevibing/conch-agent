import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { FALLBACK_AUTO, FALLBACK_WAIT, FallbackPicker, fallbackFacts } from './FallbackPicker';
import { fallbackNow, fallbackOptions, fallbackTwoAccounts } from './fixtures';

const base = {
  from: 'Claude Code',
  options: fallbackOptions,
  now: fallbackNow,
  'aria-label': 'At a usage limit',
};

describe('FallbackPicker', () => {
  it('offers Automatic first, then waiting, then each account with its facts', async () => {
    const { container } = renderNacre(
      <FallbackPicker {...base} value={FALLBACK_AUTO} onValueChange={() => {}} />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios[0]).toHaveAccessibleName(/Automatic: the next one with room/);
    expect(radios[0]).toBeChecked();
    expect(radios[0]).toHaveAccessibleDescription(
      'Codex, then OpenRouter, then Anthropic API. Right now, Codex would answer.',
    );
    expect(radios[1]).toHaveAccessibleName('Wait until it resets');
    expect(radios[2]).toHaveAccessibleName(/Codex/);
    expect(radios[2]).toHaveAccessibleDescription(
      /72% left · resets 6:00\sPM · Included in your plan · Answers with GPT-5\.5/,
    );
    expect(radios[3]).toHaveAccessibleDescription(
      'Pay per use · about $0.01 a reply · Answers with GPT-5 mini',
    );
    await expectAccessible(container);
  });

  it('chooses with the keyboard, like any radio list', async () => {
    const onValueChange = vi.fn();
    renderNacre(<FallbackPicker {...base} value={FALLBACK_AUTO} onValueChange={onValueChange} />);
    screen.getAllByRole('radio')[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Wait until it resets' })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(onValueChange).toHaveBeenLastCalledWith(FALLBACK_WAIT);
    await userEvent.keyboard('{ArrowDown} ');
    expect(onValueChange).toHaveBeenLastCalledWith('codex-agent');
  });

  it('shows Automatic’s order, and moves one up or down', async () => {
    const onReorder = vi.fn();
    renderNacre(
      <FallbackPicker
        {...base}
        value={FALLBACK_AUTO}
        onValueChange={() => {}}
        onReorder={onReorder}
      />,
    );
    const list = screen.getByRole('list', { name: 'In this order' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1Codex', '2OpenRouter', '3Anthropic API']);
    expect(screen.getByRole('button', { name: 'Move Codex up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Anthropic API up' }));
    expect(onReorder).toHaveBeenCalledWith(['codex-agent', 'anthropic-api', 'openrouter']);
    await userEvent.click(screen.getByRole('button', { name: 'Move Codex down' }));
    expect(onReorder).toHaveBeenLastCalledWith(['openrouter', 'codex-agent', 'anthropic-api']);
  });

  it('says which it passes over now, and why', () => {
    renderNacre(
      <FallbackPicker
        {...base}
        options={fallbackTwoAccounts}
        value={FALLBACK_AUTO}
        onValueChange={() => {}}
      />,
    );
    const steps = within(screen.getByRole('list', { name: 'In this order' })).getAllByRole(
      'listitem',
    );
    expect(steps[0]).toHaveTextContent('Codex · ada@work.exampleSkipped for now: at its limit');
    expect(steps[2]).toHaveTextContent('Skipped for now: this month’s budget is used up');
    expect(screen.getAllByRole('radio')[0]).toHaveAccessibleDescription(
      /Right now, Codex · ada@home\.example would answer\./,
    );
  });

  it('keeps the model on this computer last, and coming back as a switch of its own', async () => {
    const onLocal = vi.fn();
    const onBack = vi.fn();
    const { rerender, container } = renderNacre(
      <FallbackPicker
        {...base}
        value={FALLBACK_AUTO}
        onValueChange={() => {}}
        local={{ name: 'Ollama', checked: true, onCheckedChange: onLocal }}
        back={{ checked: true, onCheckedChange: onBack }}
      />,
    );
    const local = screen.getByRole('switch', {
      name: 'And if none has room, the model on this computer',
    });
    expect(local).toBeChecked();
    await userEvent.click(local);
    expect(onLocal).toHaveBeenCalledWith(false);
    await userEvent.click(
      screen.getByRole('switch', { name: 'Back to Claude Code once it resets' }),
    );
    expect(onBack).toHaveBeenCalledWith(false);
    await expectAccessible(container);

    // Waiting: nothing to come back from, and the switch is only about being offline.
    rerender(
      <FallbackPicker
        {...base}
        value={FALLBACK_WAIT}
        onValueChange={() => {}}
        local={{ name: 'Ollama', checked: true, onCheckedChange: onLocal }}
        back={{ checked: true, onCheckedChange: onBack }}
      />,
    );
    expect(
      screen.getByRole('switch', { name: 'Answer offline with the model on this computer' }),
    ).toBeVisible();
    expect(screen.queryByRole('switch', { name: /Back to/ })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('with nothing else connected, says how to get one', () => {
    renderNacre(
      <FallbackPicker {...base} options={[]} value={FALLBACK_AUTO} onValueChange={() => {}} />,
    );
    expect(screen.getAllByRole('radio')[0]).toHaveAccessibleDescription(
      'Connect another provider, and it carries on here.',
    );
  });

  it('words the facts the way people weigh them', () => {
    const [codex, router] = fallbackOptions;
    if (!codex || !router) throw new Error('fixtures');
    expect(fallbackFacts({ ...codex, room: 'none', skip: 'At its limit' }, fallbackNow)[0]).toMatch(
      /^At its limit until 6:00\sPM$/,
    );
    expect(fallbackFacts({ ...router, perReplyUsd: undefined }, fallbackNow)).toEqual([
      'Pay per use',
      'Answers with GPT-5 mini',
    ]);
  });
});
