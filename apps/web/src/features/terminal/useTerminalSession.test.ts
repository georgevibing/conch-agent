import type { TerminalInfo } from '@conch/protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTerminalSession } from './useTerminalSession';

/** A terminal's live socket, played by the test. */
class Live {
  static last?: Live;
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = 'blob';
  sent: unknown[] = [];
  onmessage?: (m: { data: string | ArrayBuffer }) => void;
  onclose?: (e: { code: number }) => void;
  constructor(readonly url: string) {
    Live.last = this;
    queueMicrotask(() => (this.readyState = Live.OPEN));
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  ready(info: TerminalInfo) {
    this.onmessage?.({ data: JSON.stringify({ type: 'ready', terminal: info }) });
  }
  prints(text: string) {
    this.onmessage?.({ data: new TextEncoder().encode(text).buffer });
  }
}

const info: TerminalInfo = {
  id: 't1',
  title: 'workspace',
  shell: 'bash',
  cwd: '/tmp',
  createdAt: 1,
  status: 'running',
  safeMode: false,
  openedFrom: 'this-computer',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a terminal’s live connection', () => {
  it('keeps what you type until the new shell is ready for it, then sends it in order', async () => {
    vi.stubGlobal('WebSocket', Live);
    const view = { current: { write: vi.fn(), reset: vi.fn(), size: () => undefined } };
    const { result } = renderHook(() =>
      useTerminalSession('t1', view as never, {
        ticket: async () => ({ ticket: 'one-time', terminal: info }),
      }),
    );
    await waitFor(() => expect(Live.last?.readyState).toBe(Live.OPEN));
    const live = Live.last as Live;
    vi.useFakeTimers();
    act(() => live.ready(info));
    // The shell hasn't printed its prompt: typing now would be lost.
    act(() => result.current.input('ec'));
    act(() => result.current.input('ho hi\r'));
    expect(live.sent).toEqual([]);
    // Something before the prompt (a login message) isn't the prompt yet.
    act(() => live.prints('Welcome to Ubuntu\r\n'));
    act(() => vi.advanceTimersByTime(200));
    act(() => live.prints('$ '));
    act(() => vi.advanceTimersByTime(200));
    expect(live.sent).toEqual([]);
    // A pause after it: the prompt was the last thing, and the shell is reading.
    act(() => vi.advanceTimersByTime(50));
    expect(live.sent).toEqual([{ type: 'input', data: 'echo hi\r' }]);
    // From then on, straight through.
    act(() => result.current.input('ls\r'));
    expect(live.sent.at(-1)).toEqual({ type: 'input', data: 'ls\r' });
  });

  it('sends at once when the shell says it’s reading a line', async () => {
    vi.stubGlobal('WebSocket', Live);
    const view = { current: { write: vi.fn(), reset: vi.fn(), size: () => undefined } };
    const { result } = renderHook(() =>
      useTerminalSession('t1', view as never, {
        ticket: async () => ({ ticket: 'one-time', terminal: info }),
      }),
    );
    await waitFor(() => expect(Live.last?.readyState).toBe(Live.OPEN));
    const live = Live.last as Live;
    act(() => live.ready(info));
    act(() => result.current.input('pwd\r'));
    // Bash and zsh turn on bracketed paste as they start reading.
    act(() => live.prints('\x1b[?2004h$ '));
    expect(live.sent).toEqual([{ type: 'input', data: 'pwd\r' }]);
  });

  it('a shell that prints nothing still gets what was typed, a moment later', async () => {
    vi.stubGlobal('WebSocket', Live);
    const view = { current: { write: vi.fn(), reset: vi.fn(), size: () => undefined } };
    const { result } = renderHook(() =>
      useTerminalSession('t1', view as never, {
        ticket: async () => ({ ticket: 'one-time', terminal: info }),
      }),
    );
    await waitFor(() => expect(Live.last?.readyState).toBe(Live.OPEN));
    const live = Live.last as Live;
    vi.useFakeTimers();
    act(() => live.ready(info));
    act(() => result.current.input('pwd\r'));
    expect(live.sent).toEqual([]);
    act(() => vi.advanceTimersByTime(1_500));
    expect(live.sent).toEqual([{ type: 'input', data: 'pwd\r' }]);
  });
});
