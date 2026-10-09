import { BrowserLiveEvent, type BrowserLiveCommand, type BrowserTab } from '@conch/protocol';
import type { BrowserWindowAction } from '@conch/nacre';
import { useCallback, useEffect, useRef, useState } from 'react';

export type LiveState = 'connecting' | 'open' | 'closed';

function liveUrl(conversationId: string): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/browser/live?conversationId=${encodeURIComponent(conversationId)}`;
}

/**
 * The live view of a conversation's browser tab: its state, the assistant's
 * actions, and the picture — frames go straight into the `<img>` given to
 * `screenRef`, so a busy page never re-renders React. Frames only flow while
 * `visible` (the panel is on screen and the window is in front).
 */
export function useBrowserLive(conversationId: string | undefined, visible: boolean) {
  const [tab, setTab] = useState<BrowserTab | null>(null);
  const [action, setAction] = useState<BrowserWindowAction>();
  const [state, setState] = useState<LiveState>('connecting');
  const [restoring, setRestoring] = useState(false);
  /** The gateway has said what the tab is (until then, an empty panel isn't news). */
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string>();
  /** After your last click: whether the page's focus takes typing (`key` changes each time). */
  const [typing, setTyping] = useState<{ editable: boolean; key: number }>();
  /** The panel's last size: said again on every (re)connect, so the page always has its shape. */
  const fitted = useRef<Extract<BrowserLiveCommand, { type: 'fit' }> | undefined>(undefined);
  const socket = useRef<WebSocket | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const urls = useRef<string[]>([]);
  const actions = useRef(0);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );

  useEffect(() => {
    const onChange = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const watching = visible && pageVisible;
  const watchingRef = useRef(watching);
  useEffect(() => {
    watchingRef.current = watching;
  }, [watching]);

  const send = useCallback((command: BrowserLiveCommand) => {
    if (command.type === 'fit') fitted.current = command;
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(command));
  }, []);

  /** Take the wheel or hand it back: shown at once; the next tab update says the same. */
  const control = useCallback(
    (to: 'user' | 'agent') => {
      send({ type: 'control', to });
      setTab((t) => (t ? { ...t, control: to } : t));
    },
    [send],
  );

  useEffect(() => {
    if (!conversationId) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const draw = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      if (image.current) image.current.src = url;
      urls.current.push(url);
      // Keep the one on screen and the one before (it may still be decoding).
      while (urls.current.length > 2) URL.revokeObjectURL(urls.current.shift() ?? '');
    };

    const open = () => {
      setState('connecting');
      const ws = new WebSocket(liveUrl(conversationId));
      ws.binaryType = 'blob';
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setState('open');
        setError(undefined);
        // The size first: a tab that opens for this watch opens in the panel's shape.
        if (fitted.current) ws.send(JSON.stringify(fitted.current));
        ws.send(JSON.stringify({ type: 'watch', visible: watchingRef.current }));
      };
      ws.onmessage = (message: MessageEvent<string | Blob>) => {
        if (typeof message.data !== 'string') return draw(message.data);
        let json: unknown;
        try {
          json = JSON.parse(message.data);
        } catch {
          return;
        }
        const event = BrowserLiveEvent.safeParse(json);
        if (!event.success) return;
        if (event.data.type === 'tab') {
          setTab(event.data.tab);
          setHeard(true);
          setRestoring(Boolean(event.data.restoring) && !event.data.tab);
        } else if (event.data.type === 'typing') {
          const { editable } = event.data;
          setTyping((t) => ({ editable, key: (t?.key ?? 0) + 1 }));
        } else if (event.data.type === 'action') {
          actions.current += 1;
          setAction({ ...event.data, key: actions.current });
        } else setError(event.data.message);
      };
      ws.onclose = (event) => {
        if (socket.current === ws) socket.current = null;
        if (stopped) return;
        setState('closed');
        // 1008: this chat is gone; 4401: signed out. Neither comes back by retrying.
        if (event.code === 1008 || event.code === 4401) return;
        attempt += 1;
        retry = setTimeout(open, Math.min(8_000, 500 * 2 ** attempt));
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
      setTab(null);
      setRestoring(false);
      setHeard(false);
    };
  }, [conversationId]);

  useEffect(() => {
    send({ type: 'watch', visible: watching });
  }, [watching, send]);

  const screenRef = useCallback((el: HTMLImageElement | null) => {
    image.current = el;
    const latest = urls.current.at(-1);
    if (el && latest) el.src = latest;
  }, []);

  return {
    tab,
    action,
    state,
    /** No tab yet, but the chat's tabs from last time are opening. */
    restoring,
    heard,
    error,
    typing,
    send,
    control,
    screenRef,
    clearError: () => setError(undefined),
  };
}
