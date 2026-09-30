import { TerminalLiveEvent, type TerminalInfo, type TerminalTicket } from '@conch/protocol';
import type { TerminalViewHandle } from '@conch/nacre';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { ApiError } from '../../api/client';
import { liveUrl } from './api';

export type SessionState =
  | { kind: 'connecting' }
  | { kind: 'running' }
  | { kind: 'exited'; code: number }
  /** The terminal is gone from the gateway (Conch restarted, or it was closed elsewhere). */
  | { kind: 'gone' }
  /** This device may not attach: off, other devices off, or you didn't confirm. */
  | { kind: 'denied'; code: string; message: string };

/** Input typed while reconnecting is kept (this much) and sent on reconnect. */
const QUEUE_LIMIT = 4_096;

/**
 * One terminal's live connection. Every connect asks for a fresh one-time
 * ticket (through "Confirm it's you" when this device needs it), the screen
 * is rebuilt from scrollback on each attach, and a dropped connection comes
 * back by itself — the shell kept running meanwhile.
 */
export function useTerminalSession(
  id: string,
  view: RefObject<TerminalViewHandle | null>,
  options: {
    /** Get a ticket; resolve undefined if the person declined to confirm. */
    ticket: (id: string) => Promise<TerminalTicket | undefined>;
    onInfo?: (info: TerminalInfo) => void;
    onTitle?: (title: string) => void;
    /** Output arrived (for the "new output" pearl on other tabs). */
    onOutput?: () => void;
    /** Written into the screen after the first attach (e.g. why this is a fresh shell). */
    note?: string;
  },
) {
  const [state, setState] = useState<SessionState>({ kind: 'connecting' });
  const socket = useRef<WebSocket | null>(null);
  const queue = useRef('');
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let noted = false;

    const connect = async () => {
      setState((s) => (s.kind === 'exited' ? s : { kind: 'connecting' }));
      let ticket: TerminalTicket | undefined;
      try {
        ticket = await opts.current.ticket(id);
      } catch (error) {
        if (stopped) return;
        if (error instanceof ApiError && error.status === 404) return setState({ kind: 'gone' });
        if (error instanceof ApiError && error.status === 403) {
          return setState({ kind: 'denied', code: error.code, message: error.message });
        }
        // Offline or the gateway is restarting: try again shortly.
        attempt += 1;
        retry = setTimeout(() => void connect(), Math.min(8_000, 500 * 2 ** attempt));
        return;
      }
      if (stopped) return;
      if (!ticket) {
        return setState({
          kind: 'denied',
          code: 'verify-required',
          message: 'Confirm it’s you to use this terminal from here.',
        });
      }
      opts.current.onInfo?.(ticket.terminal);
      const ws = new WebSocket(liveUrl(ticket.ticket));
      ws.binaryType = 'arraybuffer';
      socket.current = ws;
      ws.onmessage = (message: MessageEvent<string | ArrayBuffer>) => {
        if (typeof message.data !== 'string') {
          view.current?.write(new Uint8Array(message.data));
          opts.current.onOutput?.();
          return;
        }
        let json: unknown;
        try {
          json = JSON.parse(message.data);
        } catch {
          return;
        }
        const event = TerminalLiveEvent.safeParse(json);
        if (!event.success) return;
        switch (event.data.type) {
          case 'ready': {
            attempt = 0;
            // Scrollback follows: start from a clean screen so nothing doubles.
            view.current?.reset();
            opts.current.onInfo?.(event.data.terminal);
            setState(
              event.data.terminal.status === 'exited'
                ? { kind: 'exited', code: event.data.terminal.exitCode ?? 0 }
                : { kind: 'running' },
            );
            const size = view.current?.size();
            if (size) ws.send(JSON.stringify({ type: 'resize', ...size }));
            if (queue.current) {
              ws.send(JSON.stringify({ type: 'input', data: queue.current }));
              queue.current = '';
            }
            if (opts.current.note && !noted) {
              noted = true;
              view.current?.write(`\x1b[2m${opts.current.note}\x1b[0m\r\n`);
            }
            break;
          }
          case 'title':
            opts.current.onTitle?.(event.data.title);
            break;
          case 'exit':
            setState({ kind: 'exited', code: event.data.code });
            break;
          case 'error':
            break;
        }
      };
      ws.onclose = (event) => {
        if (socket.current === ws) socket.current = null;
        if (stopped) return;
        // 4401: signed out — nothing to retry. Anything else: reconnect with a new ticket.
        if (event.code === 4401) {
          return setState({ kind: 'denied', code: 'signed-out', message: 'You were signed out.' });
        }
        attempt += 1;
        retry = setTimeout(() => void connect(), Math.min(8_000, 400 * 2 ** attempt));
      };
    };

    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
    };
  }, [id, view]);

  const input = useCallback((data: string) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    else queue.current = (queue.current + data).slice(-QUEUE_LIMIT);
  }, []);

  const resize = useCallback((size: { cols: number; rows: number }) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', ...size }));
  }, []);

  return { state, input, resize };
}
