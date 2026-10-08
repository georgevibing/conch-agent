import { WorkPlacesStatus } from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';

import { request } from '../../api/client';

/** Where work runs (ADR 0106). The cloud's key goes in once and never comes back. */
export const workPlacesApi = {
  status: (look = false) => request(WorkPlacesStatus, `/api/workplaces${look ? '?look=1' : ''}`),
  setCloudKey: (key: string) =>
    request(WorkPlacesStatus, '/api/workplaces/cloud-key', { method: 'PUT', body: { key } }),
  forgetCloudKey: () =>
    request(WorkPlacesStatus, '/api/workplaces/cloud-key', { method: 'DELETE' }),
};

export const workPlacesKeys = { status: ['workplaces'] as const };

/**
 * Every place and how it stands. `look`: also reach each SSH machine, for a
 * list someone is looking at. Looked at again on focus, so a machine that
 * wakes or a Docker that starts shows by itself.
 */
export function useWorkPlaces({ look = false, enabled = true } = {}) {
  return useQuery({
    queryKey: [...workPlacesKeys.status, look],
    queryFn: () => workPlacesApi.status(look),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}
