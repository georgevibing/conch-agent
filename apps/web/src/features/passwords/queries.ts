import { useQuery } from '@tanstack/react-query';

import { vaultApi } from './api';

export const vaultKeys = {
  all: ['vault'] as const,
  item: (id: string) => ['vault', 'item', id] as const,
};

export function useVault() {
  return useQuery({ queryKey: vaultKeys.all, queryFn: vaultApi.list, staleTime: 30_000 });
}

export function useVaultItem(id: string | undefined) {
  return useQuery({
    queryKey: vaultKeys.item(id ?? ''),
    queryFn: () => vaultApi.item(id ?? ''),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}
