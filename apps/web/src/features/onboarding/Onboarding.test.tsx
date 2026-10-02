import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';

import { appState, baseEngine, baseProviders, mockFetch, renderApp } from '../../test/harness';
import { Onboarding } from './Onboarding';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());
const models = {
  default: 'claude-code',
  providers: [
    {
      engine: 'claude-code',
      label: 'Claude Code',
      models: [{ id: 'default', label: 'Recommended', tools: true }],
      commands: [],
      permissionModes: ['default'],
      tools: { host: true, files: true, shell: true, approvals: true },
    },
  ],
};
const done = {
  id: 'task_first',
  kind: 'background',
  title: 'Make a useful brief',
  prompt: 'Make a brief',
  status: 'done',
  workflow: 'document',
  options: {},
  createdAt: 1,
  verification: 'verified',
  modelCompleted: true,
  operations: [],
  steps: [],
  rev: 2,
  summary: 'A useful brief was saved.',
  conversationId: 'c_first',
};
function routes(extra: Record<string, (body: unknown) => unknown> = {}) {
  return mockFetch({
    'GET /api/state': () => appState({ onboarded: false }),
    'GET /api/engine': () => baseEngine,
    'GET /api/providers': () => baseProviders,
    'GET /api/models': () => models,
    'GET /api/first-job': () => ({ task: null }),
    'GET /api/import': () => ({ sources: [] }),
    'PATCH /api/settings': () => appState(),
    ...extra,
  });
}
async function toDocument(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Get started' }));
  expect(
    await screen.findByRole('heading', { name: 'What would you like help with?' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('textbox', { name: 'Your notes or document' }, { timeout: 5000 });
}

describe('outcome-first onboarding', () => {
  it('asks for an outcome before setup and does not onboard merely because a provider is ready', async () => {
    const calls = routes({ 'POST /api/first-job': () => done });
    const user = userEvent.setup();
    const { container } = renderApp(<Onboarding />);
    expect(
      await screen.findByText(/Cloud providers receive the content needed/),
    ).toBeInTheDocument();
    await toDocument(user);
    expect(screen.queryByText('Give me a personality')).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
    expect(screen.getByRole('button', { name: 'Make a useful brief' })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Your notes or document' }),
      'Maya owns the launch checklist. Deadline Friday.',
    );
    expect(
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
    ).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Make a useful brief' }));
    expect(await screen.findByText('Ready to review')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Keep this result and open Conch' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'PATCH', body: { onboarded: true } }),
      ),
    );
  });

  it('allows an explicit escape without pretending a first job was completed', async () => {
    const calls = routes();
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await user.click(screen.getByRole('button', { name: 'Explore on my own' }));
    await waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ body: { onboarded: true } })),
    );
    expect(calls.some((call) => call.path === '/api/first-job' && call.method === 'POST')).toBe(
      false,
    );
  });

  it('resumes the durable result after reload and never restarts it automatically', async () => {
    const calls = routes({
      'GET /api/first-job': () => ({
        task: {
          ...done,
          status: 'interrupted',
          verification: 'unverified',
          error: 'Connection interrupted.',
        },
      }),
    });
    renderApp(<Onboarding />);
    expect(await screen.findByText('Your work is kept')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Continue from saved progress' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ready to review')).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('does not offer a tool-free model as capable or silently switch providers', async () => {
    const calls = routes({
      'GET /api/models': () => ({
        ...models,
        providers: models.providers.map((provider) => ({
          ...provider,
          models: [{ id: 'default', label: 'Chat only', tools: false }],
        })),
      }),
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await toDocument(user);
    await user.type(screen.getByRole('textbox', { name: 'Your notes or document' }), 'Some notes.');
    expect(screen.getByRole('button', { name: 'Make a useful brief' })).toBeDisabled();
    expect(await screen.findByText('Choose a model that can do the job')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/api/first-job' && call.method === 'POST')).toBe(
      false,
    );
  });

  it('retries an uncertain HTTP start with the same request id, not another task', async () => {
    let attempt = 0;
    const calls = routes({
      'POST /api/first-job': () =>
        ++attempt === 1
          ? new Response(JSON.stringify({ error: 'offline', message: 'Response lost.' }), {
              status: 503,
            })
          : done,
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await toDocument(user);
    await user.type(
      screen.getByRole('textbox', { name: 'Your notes or document' }),
      'A useful source.',
    );
    await user.click(screen.getByRole('button', { name: 'Make a useful brief' }));
    expect(await screen.findByText('Couldn’t confirm the start')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make a useful brief' }));
    await screen.findByText('Ready to review');
    const sent = calls.filter((call) => call.path === '/api/first-job' && call.method === 'POST');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.body).toEqual(sent[1]?.body);
  });

  it('offers personalization only after the useful result', async () => {
    const calls = routes({ 'GET /api/first-job': () => ({ task: done }) });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Make Conch yours' }));
    expect(
      await screen.findByRole('heading', { name: 'Give me a personality' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('button', { name: 'Open Conch' })).toBeInTheDocument();
    expect(calls.some((call) => call.body && JSON.stringify(call.body).includes('onboarded'))).toBe(
      false,
    );
  });
});
