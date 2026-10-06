import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll, stoppedView, type ConversationView } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from '../chat/Transcript';

afterEach(() => vi.unstubAllGlobals());

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

const step = (stepId: string, status: 'running' | 'waiting' | 'done', label: string) =>
  ({
    type: 'browser.step',
    step: {
      stepId,
      status,
      action: 'click',
      label,
      url: 'https://www.booking.com/lisbon',
      title: 'Lisbon hotels',
      shot: status === 'done' ? `shot${stepId}0000` : undefined,
      by: 'agent',
    },
  }) as const;

describe('browser events in the transcript reducer', () => {
  it('shows a wait in place, and settles it on Stop and a restored interrupted turn', () => {
    const events = log(
      step('s1', 'running', 'Opening the browser'),
      step('s1', 'waiting', 'Waiting for you'),
    );
    const view = reduceAll(events);
    expect(view.items.filter((i) => i.kind === 'browser')).toHaveLength(1);
    expect(stoppedView(view, 2000).items.find((i) => i.kind === 'browser')).toMatchObject({
      step: { status: 'error', label: 'Stopped.' },
    });
    const ended = reduceAll(log(...events, { type: 'turn.completed', outcome: 'interrupted' }));
    expect(ended.items.find((i) => i.kind === 'browser')).toMatchObject({
      step: { status: 'error' },
    });
  });

  it('settles a step in place and groups a trail', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Find a hotel' },
        step('s1', 'running', 'Opening booking.com'),
        step('s1', 'done', 'Opened booking.com'),
        step('s2', 'running', 'Clicking “Search”'),
      ),
    );
    const steps = view.items.filter((i) => i.kind === 'browser');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ step: { status: 'done', label: 'Opened booking.com' } });
    expect(steps[1]).toMatchObject({ step: { status: 'running' } });
  });

  it('follows a handoff from waiting to done, and keeps browser detail on permissions', () => {
    const view = reduceAll(
      log(
        {
          type: 'browser.handoff',
          handoff: { handoffId: 'h1', state: 'waiting', reason: 'Sign in', url: 'https://x.test' },
        },
        {
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'browser_site',
          input: {},
          summary: 'use booking.com',
          browser: {
            kind: 'site',
            site: 'booking.com',
            url: 'https://booking.com',
            title: 'Booking',
            action: 'Click “Search”',
          },
        },
        {
          type: 'browser.handoff',
          handoff: { handoffId: 'h1', state: 'done', reason: 'Sign in', url: 'https://x.test' },
        },
      ),
    );
    expect(view.items.filter((i) => i.kind === 'handoff')).toEqual([
      expect.objectContaining({ handoff: expect.objectContaining({ state: 'done' }) }),
    ]);
    expect(view.items.find((i) => i.kind === 'permission')).toMatchObject({
      browser: { kind: 'site', site: 'booking.com' },
    });
  });
});

function show(view: ConversationView, onRespond = vi.fn()) {
  const calls = mockFetch({
    'GET /api/state': () => appState(),
    'POST /api/browser/c1/control': () => ({ ok: true }),
  });
  renderApp(
    <Transcript
      view={view}
      conversationId="c1"
      pending={[]}
      name="Conch"
      onRespond={onRespond}
      onRetry={() => {}}
    />,
  );
  return calls;
}

describe('browser cards in the transcript', () => {
  it('shows browsing as one trail with thumbnails from the gateway', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Find a hotel' },
        step('s1', 'done', 'Opened booking.com'),
        step('s2', 'done', 'Clicked “Search”'),
      ),
    );
    show(view);
    expect(
      screen.getByRole('button', { name: /Browsed booking\.com · 2 steps/ }),
    ).toBeInTheDocument();
    const frames = screen.getByRole('list', { name: 'What the assistant saw' });
    expect(frames.querySelector('img')?.getAttribute('src')).toBe(
      '/api/browser/shots/c1/shots10000',
    );
  });

  it('asks about a site with the browser card, and answers with “Always”', async () => {
    const onRespond = vi.fn();
    const view = reduceAll(
      log({
        type: 'permission.requested',
        permissionId: 'p1',
        toolName: 'browser_site',
        input: {},
        summary: 'use booking.com',
        browser: {
          kind: 'site',
          site: 'booking.com',
          url: 'https://booking.com',
          title: 'Booking',
          action: 'Click “Search”',
        },
      }),
    );
    show(view, onRespond);
    expect(screen.getByText('Let Conch use booking.com?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Always for booking.com' }));
    expect(onRespond).toHaveBeenCalledWith('p1', 'allow-always');
  });

  it('hands the browser back from the transcript with “I’m done”', async () => {
    const view = reduceAll(
      log({
        type: 'browser.handoff',
        handoff: {
          handoffId: 'h1',
          state: 'waiting',
          reason: 'Sign in to your Booking account',
          url: 'https://booking.com',
        },
      }),
    );
    const calls = show(view);
    expect(screen.getByText('Sign in to your Booking account')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I’m done' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/browser/c1/control',
          body: { to: 'agent' },
        }),
      ),
    );
  });
});

describe('browsing across an answered question', () => {
  it('keeps one trail, with the answer under it', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Search Wikipedia' },
        step('s1', 'done', 'Opened wikipedia.org'),
        {
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'browser_site',
          input: {},
          summary: 'use wikipedia.org',
          browser: {
            kind: 'site',
            site: 'wikipedia.org',
            url: 'https://wikipedia.org',
            title: 'Wikipedia',
            action: 'Click “Search”',
          },
        },
        { type: 'permission.resolved', permissionId: 'p1', decision: 'allow' },
        step('s2', 'done', 'Clicked “Search”'),
      ),
    );
    show(view);
    expect(screen.getAllByRole('button', { name: /^Browsed / })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: /Browsed booking\.com · 2 steps/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Allowed on wikipedia.org in this chat')).toBeInTheDocument();
  });

  it('keeps one trail past the note that it read a page (ADR 0028)', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Search Wikipedia' },
        step('s1', 'done', 'Opened wikipedia.org'),
        { type: 'taint', source: { kind: 'web', label: 'wikipedia.org' } },
        {
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'browser_site',
          input: {},
          summary: 'use wikipedia.org',
          browser: {
            kind: 'site',
            site: 'wikipedia.org',
            url: 'https://wikipedia.org',
            title: 'Wikipedia',
            action: 'Click “Search”',
          },
        },
        { type: 'permission.resolved', permissionId: 'p1', decision: 'allow' },
        step('s2', 'done', 'Clicked “Search”'),
        { type: 'taint', source: { kind: 'web', label: 'pages in the browser' } },
        step('s3', 'done', 'Read the results'),
      ),
    );
    show(view);
    expect(screen.getAllByRole('button', { name: /^Browsed / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /· 3 steps/ })).toBeInTheDocument();
    expect(screen.getByText(/Read wikipedia\.org\./)).toBeInTheDocument();
  });
});
