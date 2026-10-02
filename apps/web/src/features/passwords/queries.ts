import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { vaultApi } from './api';

export const vaultKeys = {
  all: ['vault'] as const,
  item: (id: string) => ['vault', 'item', id] as const,
};

export function useVault() {
  return useQuery({ queryKey: vaultKeys.all, queryFn: vaultApi.list, staleTime: 30_000 });
}

/** One item's fields. Shared, so getting it ready early and opening it are one request. */
export function vaultItemQuery(id: string) {
  return queryOptions({
    queryKey: vaultKeys.item(id),
    queryFn: ({ signal }) => vaultApi.item(id, signal),
    staleTime: 15_000,
  });
}

/** How long the arrow keys must rest on an item before its fields are asked for. */
const SETTLE_MS = 120;

/**
 * An item's fields. With `settle`, the request waits until the selection has
 * rested a moment: passing through a list with the arrow keys shouldn't start
 * another app's program for every item on the way. One that's already here
 * shows at once either way.
 */
export function useVaultItem(id: string | undefined, options: { settle?: boolean } = {}) {
  const client = useQueryClient();
  const [rested, setRested] = useState(
    () => !options.settle || !id || client.getQueryData(vaultKeys.item(id)) !== undefined,
  );
  useEffect(() => {
    if (rested) return;
    const timer = setTimeout(() => setRested(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [rested]);
  return useQuery({ ...vaultItemQuery(id ?? ''), enabled: Boolean(id) && rested });
}
