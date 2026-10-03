import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { SIGNED_OUT_EVENT, api } from '../../api/client';
import { keys } from '../../api/queries';

export function useAuth() {
  const client = useQueryClient();
  useEffect(() => {
    // Any 401 (or a socket closed with 4401) means: ask the gateway again.
    const recheck = () => void client.invalidateQueries({ queryKey: keys.auth });
    window.addEventListener(SIGNED_OUT_EVENT, recheck);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, recheck);
  }, [client]);
  return useQuery({ queryKey: keys.auth, queryFn: api.auth, staleTime: Infinity, retry: 1 });
}

/**
 * Read a one-time code from the address bar — `#here=…` from a launcher on
 * this computer (ADR 0063), `#pair=…` from a pairing link — or a legacy
 * `?token=`, and remove it at once so it never lingers in history, bookmarks
 * or screenshots. Fragments never reach the server's logs.
 */
export function takeLinkCredential():
  | { with: 'here'; code: string }
  | { with: 'pairing'; code: string }
  | { with: 'key'; key: string }
  | undefined {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const here = hash.get('here');
  const code = hash.get('pair');
  const token = url.searchParams.get('token');
  if (!here && !code && !token) return undefined;
  hash.delete('here');
  hash.delete('pair');
  url.searchParams.delete('token');
  url.hash = hash.toString();
  window.history.replaceState(window.history.state, '', url.toString().replace(/#$/, ''));
  if (here) return { with: 'here', code: here };
  return code ? { with: 'pairing', code } : token ? { with: 'key', key: token } : undefined;
}
