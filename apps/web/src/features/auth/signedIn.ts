import type { AuthStatus } from '@conch/protocol';
import type { QueryClient } from '@tanstack/react-query';

import { keys } from '../../api/queries';

/** Start from a clean slate: nothing fetched while signed out may linger. */
export function applySignedIn(client: QueryClient, status: AuthStatus) {
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.auth[0] });
  client.setQueryData(keys.auth, status);
}
