import { act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeSocket, mockFetch, renderApp } from '../test/harness';
import { useLive } from './LiveProvider';
import { useLiveStore } from './store';

type Live = ReturnType<typeof useLive>;

function Grab({ into }: { into: (live: Live) => void }) {
  const live = useLive();
  useEffect(() => {
    into(live);
  }, [live, into]);
  return null;
}

async function mount() {
  mockFetch({});
  let live: Live | undefined;
  renderApp(<Grab into={(l) => (live = l)} />);
  await waitFor(() => expect(live).toBeDefined());
  return live as Live;
}

const subscribes = (id: string) =>
  (FakeSocket.last?.sent ?? []).filter(
    (c) =>
      (c as { type: string }).type === 'conversation.subscribe' &&
      (c as { conversationId?: string }).conversationId === id,
  );

afterEach(() => {
  FakeSocket.holdOpen = false;
  vi.unstubAllGlobals();
});

describe('LiveProvider', () => {
  it('opens a chat watched while connecting once, not twice', async () => {
    FakeSocket.holdOpen = true;
    const live = await mount();
    // The socket hasn't opened yet: the open itself subscribes what's watched.
    act(() => void live.watch('c_early'));
    act(() => FakeSocket.last?.open());
    expect(subscribes('c_early')).toHaveLength(1);
  });

  it('a link to a chat with an id that can’t be one draws nothing there, without throwing', async () => {
    const live = await mount();
    await waitFor(() => expect(FakeSocket.last?.readyState).toBe(1));
    expect(() => act(() => void live.watch('notes.md'))).not.toThrow();
    expect(subscribes('notes.md')).toHaveLength(0);
    expect(useLiveStore.getState().views['notes.md']?.loaded).toBe(true);
  });
});
