import type { Channel, ChannelCheck, CheckChannelBody } from '@conch/protocol';
import type { KeyFieldStatus } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { channelsApi } from './api';

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Checks a key with the app as soon as it's pasted or typed (after a short
 * pause), so there's no Save button to find: the field says whose it is, or
 * exactly what's wrong.
 */
export function useKeyCheck(
  body: CheckChannelBody | undefined,
  /** What's in the field now (to tell "still typing" from "checked"). */
  raw: string,
): { status: KeyFieldStatus; check?: ChannelCheck } {
  const settled = useDebounced(body);
  const key = JSON.stringify(settled ?? null);
  const query = useQuery({
    queryKey: ['channel-check', key],
    queryFn: ({ signal }) => channelsApi.check(settled as CheckChannelBody, signal),
    enabled: Boolean(settled),
    staleTime: Infinity,
    retry: false,
  });
  if (!raw.trim()) return { status: 'idle' };
  if (JSON.stringify(body ?? null) !== key || query.isFetching || !query.data)
    return { status: query.isError ? 'error' : 'checking' };
  return { status: query.data.ok ? 'ok' : 'error', check: query.data };
}

/**
 * A key pasted anywhere on the page (not just in the box) is picked up: people
 * come back from BotFather with it on the clipboard and press Ctrl+V.
 */
export function usePasteAnywhere(pattern: RegExp, onFound: (value: string) => void, active = true) {
  const found = useRef(onFound);
  useEffect(() => {
    found.current = onFound;
  });
  useEffect(() => {
    if (!active) return;
    const listen = (event: ClipboardEvent) => {
      // Pasting into a field is that field's business.
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]'))
        return;
      const text = event.clipboardData?.getData('text') ?? '';
      const match = pattern.exec(text)?.[1];
      if (match) {
        event.preventDefault();
        found.current(match);
      }
    };
    window.addEventListener('paste', listen);
    return () => window.removeEventListener('paste', listen);
  }, [pattern, active]);
}

/** Whether this looks like a computer (a QR code helps) rather than the phone itself. */
export function usePointerFine(): boolean {
  const [fine] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches !== false,
  );
  return fine;
}

/** Nobody has said hello yet: the step that finishes setting it up. */
export const awaitingHello = (channel: Channel | undefined) =>
  Boolean(channel && channel.people.length === 0);
