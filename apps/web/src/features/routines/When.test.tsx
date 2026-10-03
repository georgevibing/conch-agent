import type { Routine } from '@conch/protocol';
import { configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { RoutineEditor } from './RoutineEditor';
import { WhenStarters } from './WhenStarters';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

const routine = (extra: Partial<Routine>): Routine => ({
  id: 'r_1',
  title: 'Price watch',
  summary: '',
  prompt: 'Tell me what changed.',
  schedule: { type: 'once', at: '2000-01-01T00:00:00Z' },
  timezone: 'Europe/Berlin',
  status: 'active',
  trust: 'ask',
  catchUp: true,
  options: {},
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 1,
  scheduleText: 'When example.com/pricing changes',
  runCount: 0,
  ...extra,
});

/** The gateway's words, roughly, for what the editor sends. */
const preview = (body: unknown) => {
  const { when, onlyIf } = body as { when: { kind: string; url?: string }; onlyIf?: string };
  if (when.kind === 'page' && !when.url?.startsWith('https://'))
    return { valid: false, text: 'When a page changes', error: 'That isn’t a web address.' };
  const text =
    when.kind === 'page'
      ? `When ${when.url?.replace('https://', '')} changes`
      : when.kind === 'calendar'
        ? '15 minutes before each meeting with other people'
        : 'When an email arrives';
  return { valid: true, text: onlyIf ? `${text}, only if ${onlyIf}` : text };
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('a routine that starts when something happens', () => {
  it('is set up with Starts: When…, plain choices, and Conch’s own words', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/routines': () => [],
      'POST /api/routines/preview': () => ({ valid: true, text: 'Every day at 9:00 AM', next: [] }),
      'POST /api/routines/when/preview': preview,
      'GET /api/routines/people': () => ({ people: [] }),
      'POST /api/routines': (body) => routine({ ...(body as object), id: 'r_new' }),
    });
    renderApp(<RoutineEditor open draft={{}} onOpenChange={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Price watch');
    await user.type(
      screen.getByRole('textbox', { name: 'What should Conch do?' }),
      'Tell me what changed.',
    );
    await user.click(screen.getByRole('radio', { name: 'When…' }));
    await user.click(await screen.findByRole('radio', { name: /A page changes/ }));
    expect(await screen.findAllByText('That isn’t a web address.')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Page address' }),
      'https://example.com/pricing',
    );
    await user.type(screen.getByRole('textbox', { name: /Only if/ }), 'the price drops');
    expect(
      await screen.findAllByText('When example.com/pricing changes, only if the price drops'),
    ).not.toHaveLength(0);
    // No catching up: a When-routine starts from what happens.
    expect(screen.queryByRole('switch', { name: /Catch up/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/routines')).toBe(true),
    );
    const created = calls.find((c) => c.method === 'POST' && c.path === '/api/routines')?.body;
    expect(created).toMatchObject({
      title: 'Price watch',
      when: { kind: 'page', url: 'https://example.com/pricing', every: 60 },
      onlyIf: 'the price drops',
      status: 'active',
    });
    expect(created).not.toHaveProperty('schedule');
  });

  it('picks whose mail from people you write to', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/routines': () => [],
      'POST /api/routines/preview': () => ({ valid: true, text: '', next: [] }),
      'POST /api/routines/when/preview': preview,
      'GET /api/routines/people': () => ({
        people: [{ address: 'anna@example.com', name: 'Anna Smith' }],
      }),
    });
    renderApp(
      <RoutineEditor
        open
        draft={{ when: { kind: 'mail', from: [], words: [] } }}
        onOpenChange={() => {}}
      />,
    );
    const anna = await screen.findByRole('button', { name: 'Anna Smith' });
    await user.click(anna);
    expect(anna).toHaveAttribute('aria-pressed', 'true');
  });

  it('editing one that starts at a time into one that starts when, and back', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/routines': () => [],
      'POST /api/routines/preview': () => ({ valid: true, text: 'Every day at 9:00 AM', next: [] }),
      'POST /api/routines/when/preview': preview,
      'PATCH /api/routines/r_1': (body) => routine(body as Partial<Routine>),
    });
    renderApp(
      <RoutineEditor
        open
        routine={routine({ when: { kind: 'page', url: 'https://example.com/pricing', every: 60 } })}
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByRole('radio', { name: 'When…' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Every…' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      when: null,
      schedule: { type: 'daily', time: '09:00' },
    });
  });
});

describe('starters after connecting Google', () => {
  it('offers a meeting brief once after Calendar, created only when turned on', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'POST /api/routines/when/preview': preview,
      'POST /api/routines': (body) => routine({ ...(body as object), id: 'r_brief' }),
      'GET /api/routines': () => [],
    });
    const first = renderApp(<WhenStarters app="google-calendar" />);
    expect(await screen.findByText('Meeting brief')).toBeInTheDocument();
    expect(
      await screen.findByText('15 minutes before each meeting with other people'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/routines')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/api/routines')?.body,
      ).toMatchObject({
        title: 'Meeting brief',
        when: { kind: 'calendar', minutesBefore: 15, withOthers: true },
        status: 'active',
      }),
    );
    expect(await screen.findByText('Routine on')).toBeInTheDocument();
    first.unmount();
    // Once: connecting again doesn't offer it again.
    renderApp(<WhenStarters app="google-calendar" />);
    expect(screen.queryByText('Meeting brief')).toBeNull();
  });

  it('asks whose mail before turning on the Gmail one, and offers nothing for Drive', async () => {
    const user = userEvent.setup();
    mockFetch({
      'POST /api/routines/when/preview': preview,
      'POST /api/routines/preview': () => ({ valid: true, text: '', next: [] }),
      'GET /api/routines/people': () => ({ people: [] }),
      'GET /api/routines': () => [],
    });
    renderApp(<WhenStarters app="gmail" />);
    await user.click(await screen.findByRole('button', { name: 'Choose who' }));
    expect(await screen.findByRole('dialog', { name: 'New routine' })).toBeInTheDocument();
    const { container } = renderApp(<WhenStarters app="google-drive" />);
    expect(container.textContent).toBe('');
  });
});
