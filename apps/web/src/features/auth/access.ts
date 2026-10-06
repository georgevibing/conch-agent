import type { AccessSettings } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import type { useVerify } from './useVerify';

/** What Settings → Security and Settings → Devices share: who's in, and how to change it. */

export type Guard = ReturnType<typeof useVerify>['guard'];

export const isLocalPage = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export function useAccess() {
  return useQuery({ queryKey: keys.access, queryFn: api.access, staleTime: 10_000 });
}

export function useApply() {
  const client = useQueryClient();
  return (settings: AccessSettings) => {
    client.setQueryData(keys.access, settings);
    void client.invalidateQueries({ queryKey: keys.auth });
  };
}

export const fail = (error: unknown) => toast.error((error as Error).message);

/** A request to bring one part of a place into view; the part calls `done` once it has. */
export interface Focus<Place extends string = string> {
  place: Place;
  done: () => void;
}

/** Bring a section into view and put the keyboard where the fix happens. */
export function reveal(section: HTMLElement | null, target: HTMLElement | null | undefined) {
  if (!section) return;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  target?.focus({ preventScroll: true });
}
