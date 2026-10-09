import type { FallbackPlan } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { FallbackSection, inYourOrder } from './FallbackSection';

afterEach(() => vi.unstubAllGlobals());

const plan: FallbackPlan = {
  from: 'claude-code',
  fromName: 'Claude Code',
  choices: [
    {
      id: 'codex-agent',
      engines: ['codex-agent', 'codex-cli'],
      name: 'Codex',
      account: 'ChatGPT Plus · ada@example.com',
      billing: 'plan',
      room: 'room',
      leftPercent: 72,
      model: { id: 'gpt-5.5', label: 'GPT-5.5' },
    },
    {
      id: 'openrouter',
      engines: ['openrouter'],
      name: 'OpenRouter',
      account: 'Key …4f2c',
      billing: 'metered',
      room: 'room',
      perReplyUsd: 0.02,
      model: { id: 'openai/gpt-5-mini', label: 'GPT-5 mini' },
    },
  ],
  local: { id: 'ollama', name: 'Ollama' },
};

const saved = (calls: { method: string; path: string; body?: unknown }[], preferences: object) =>
  waitFor(() =>
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'PATCH', path: '/api/settings', body: { preferences } }),
    ),
  );

describe('Providers → When one can’t answer (ADR 0126)', () => {
  it('is Automatic by default, and shows each plan or key once, with its facts', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/fallback': () => plan });
    renderApp(<FallbackSection />);
    const group = await screen.findByRole('radiogroup', { name: 'At a usage limit' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(radios[0]).toHaveAccessibleDescription(
      'Codex, then OpenRouter. Right now, Codex would answer.',
    );
    // Codex and Codex CLI are one choice, never "Codex" twice.
    expect(within(group).getAllByRole('radio', { name: /^Codex/ })).toHaveLength(1);
    expect(radios[2]).toHaveAccessibleDescription(
      '72% left · Included in your plan · Answers with GPT-5.5',
    );
    expect(radios[3]).toHaveAccessibleDescription(
      'Pay per use · about $0.02 a reply · Answers with GPT-5 mini',
    );
    expect(
      screen.getByRole('switch', { name: 'And if none has room, the model on this computer' }),
    ).toBeChecked();
  });

  it('saves a pick, waiting, and Automatic again', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/fallback': () => plan,
      'PATCH /api/settings': (body) => ({ ...appState(), ...(body as object) }),
    });
    renderApp(<FallbackSection />);
    await userEvent.click(await screen.findByRole('radio', { name: /^OpenRouter/ }));
    await saved(calls, { limitFallback: 'openrouter' });
    await userEvent.click(screen.getByRole('radio', { name: 'Wait until it resets' }));
    await saved(calls, { limitFallback: 'wait' });
    await userEvent.click(screen.getByRole('radio', { name: /^Automatic/ }));
    await saved(calls, { limitFallback: null });
  });

  it('reorders Automatic, and the order shows at once', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/fallback': () => plan,
      'PATCH /api/settings': (body) => ({
        ...appState(),
        preferences: {
          ...appState().preferences,
          ...(body as { preferences: object }).preferences,
        },
      }),
    });
    renderApp(<FallbackSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move OpenRouter up' }));
    await saved(calls, { limitOrder: ['openrouter', 'codex-agent'] });
    const steps = within(screen.getByRole('list', { name: 'In this order' })).getAllByRole(
      'listitem',
    );
    expect(steps[0]).toHaveTextContent('OpenRouter');
  });

  it('a pick made with the other way into the same account still reads as chosen', async () => {
    mockFetch({
      'GET /api/state': () =>
        appState({ preferences: { ...appState().preferences, limitFallback: 'codex-cli' } }),
      'GET /api/fallback': () => plan,
    });
    renderApp(<FallbackSection />);
    expect(await screen.findByRole('radio', { name: /^Codex/ })).toBeChecked();
    // Not Automatic: the last resort says so.
    expect(
      screen.getByRole('switch', { name: 'If it has no room either, the model on this computer' }),
    ).toBeVisible();
  });

  it('keeps the offline switch, and coming back is a switch of its own', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/fallback': () => ({ ...plan, local: undefined }),
      'PATCH /api/settings': () => appState(),
    });
    renderApp(<FallbackSection />);
    expect(await screen.findByText(/No model here yet, so messages wait/)).toBeVisible();
    await userEvent.click(screen.getByRole('switch', { name: /the model on this computer/ }));
    await saved(calls, { offlineFallback: false });
    await userEvent.click(
      screen.getByRole('switch', { name: 'Back to Claude Code once it resets' }),
    );
    await saved(calls, { limitReturn: false });
  });

  it('applies your order before the gateway says it again', () => {
    expect(inYourOrder(plan.choices, ['codex-cli']).map((c) => c.id)).toEqual([
      'codex-agent',
      'openrouter',
    ]);
    expect(inYourOrder(plan.choices, ['openrouter']).map((c) => c.id)).toEqual([
      'openrouter',
      'codex-agent',
    ]);
  });
});
