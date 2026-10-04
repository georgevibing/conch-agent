import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBrowserLive } from './useBrowserLive';

/** A socket that opens when told, and keeps what was sent. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: unknown[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe('the live view', () => {
  it('says the panel’s size as soon as it connects, even if it was measured first', () => {
    const { result } = renderHook(() => useBrowserLive('conv_1', true));
    // The panel measured itself before the socket opened: nothing could be sent…
    act(() => result.current.send({ type: 'fit', width: 600, height: 900 }));
    const socket = FakeSocket.all[0];
    expect(socket?.sent).toEqual([]);
    // …so it goes first on connect, before the watch that may open the tabs.
    act(() => socket?.open());
    expect(socket?.sent).toEqual([
      { type: 'fit', width: 600, height: 900 },
      { type: 'watch', visible: true },
    ]);
  });

  it('knows when the chat’s tabs are opening again', () => {
    const { result } = renderHook(() => useBrowserLive('conv_1', true));
    const socket = FakeSocket.all[0];
    act(() => socket?.open());
    expect(result.current.heard).toBe(false);
    act(() => socket?.receive({ type: 'tab', tab: null, restoring: true }));
    expect(result.current).toMatchObject({ heard: true, restoring: true, tab: null });
    act(() =>
      socket?.receive({
        type: 'tab',
        tab: {
          conversationId: 'conv_1',
          url: 'https://example.com/',
          title: 'Example',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          control: 'idle',
          viewport: { width: 960, height: 1440 },
          tabs: [],
        },
      }),
    );
    expect(result.current.restoring).toBe(false);
    expect(result.current.tab?.url).toBe('https://example.com/');
  });
});
