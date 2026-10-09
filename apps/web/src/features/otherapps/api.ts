import {
  McpClient,
  McpOverview,
  PairedMcpClient,
  type PairMcpClientBody,
  type UpdateMcpClientBody,
} from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

/** Settings → Access → Apps that use Conch (ADR 0073). */
export const otherAppsApi = {
  overview: () => request(McpOverview, '/api/mcp'),
  pair: (body: PairMcpClientBody) =>
    request(PairedMcpClient, '/api/mcp/clients', { method: 'POST', body }),
  update: (id: string, body: UpdateMcpClientBody) =>
    request(McpClient, `/api/mcp/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) =>
    request(Ok, `/api/mcp/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  remote: (on: boolean) => request(McpOverview, '/api/mcp/remote', { method: 'PUT', body: { on } }),
};

export const otherAppsKeys = { overview: ['mcp'] as const };

export function useOtherApps() {
  return useQuery({
    queryKey: otherAppsKeys.overview,
    queryFn: otherAppsApi.overview,
    // An app installed meanwhile, or one that just used Conch: look again on focus.
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}
