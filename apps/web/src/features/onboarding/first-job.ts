import { FirstJobState, Task, type FirstJobRequest } from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';

import { request } from '../../api/client';

export const firstJobKey = ['first-job'] as const;
export const firstJobApi = {
  state: () => request(FirstJobState, '/api/first-job'),
  start: (body: FirstJobRequest) => request(Task, '/api/first-job', { method: 'POST', body }),
};

export function useFirstJob() {
  return useQuery({
    queryKey: firstJobKey,
    queryFn: firstJobApi.state,
    refetchInterval: (query) => {
      const status = query.state.data?.task?.status;
      return status && ['queued', 'running', 'needs-you'].includes(status) ? 1500 : false;
    },
    refetchOnWindowFocus: true,
  });
}
