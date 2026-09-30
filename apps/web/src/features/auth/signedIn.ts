import type { AuthStatus } from '@conch/protocol';
import type { QueryClient } from '@tanstack/react-query';

import { keys } from '../../api/queries';

/**
 * Start from a clean slate: nothing fetched while signed out may linger. A
 * "who am I?" still on its way was asked before this sign-in, so its answer
 * is out of date: it's dropped, never allowed to sign the page back out (a
 * phone opening its sign-in link asks both at once).
 */
export async function applySignedIn(client: QueryClient, status: AuthStatus): Promise<void> {
  await client.cancelQueries({ queryKey: keys.auth });
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.auth[0] });
  client.setQueryData(keys.auth, status);
}
