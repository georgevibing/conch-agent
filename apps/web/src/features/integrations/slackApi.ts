import { SlackStatus, type SlackUpdateBody } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { request } from '../../api/client';
import { errorText } from './queries';

/** Slack, connected to Conch itself (ADR 0049): one sign-in, every model. */
export const slackApi = {
  status: () => request(SlackStatus, '/api/slack'),
  connect: (token: string) =>
    request(SlackStatus, '/api/slack/connect', { method: 'POST', body: { token } }),
  check: () => request(SlackStatus, '/api/slack/check', { method: 'POST', body: {} }),
  update: (body: SlackUpdateBody) => request(SlackStatus, '/api/slack', { method: 'PATCH', body }),
  disconnect: () => request(z.object({ ok: z.boolean() }), '/api/slack', { method: 'DELETE' }),
};

export const slackKeys = { status: ['slack'] as const };

export function useSlack(enabled = true) {
  return useQuery({
    queryKey: slackKeys.status,
    queryFn: slackApi.status,
    staleTime: 30_000,
    enabled,
  });
}

/** Working (or working with something worth knowing): the assistant can use it. */
export const slackWorks = (status: SlackStatus | undefined) =>
  Boolean(
    status?.connected &&
    status.enabled &&
    (status.health.state === 'ok' || status.health.state === 'warning'),
  );

export function useUpdateSlack() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: slackApi.update,
    onSuccess: (status) => client.setQueryData(slackKeys.status, status),
    onError: (error) => toast.error(errorText(error)),
  });
}
