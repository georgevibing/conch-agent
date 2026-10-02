import { Integration, SlackSetup } from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';

import { request } from '../../api/client';

/**
 * Setting Slack up (ADR 0049). Once connected it's an app like any other,
 * opened, switched and removed through `/api/integrations/slack` (ADR 0052).
 */
export const slackApi = {
  setup: () => request(SlackSetup, '/api/slack/setup'),
  connect: (token: string) =>
    request(Integration, '/api/slack/connect', { method: 'POST', body: { token } }),
};

/** What the connect dialog can offer: the Slack app a channel already uses. */
export function useSlackSetup(enabled = true) {
  return useQuery({
    queryKey: ['slack', 'setup'],
    queryFn: slackApi.setup,
    staleTime: 30_000,
    enabled,
  });
}

/** Working (or working with something worth knowing): the assistant can use it. */
export const works = (integration: Integration | undefined) =>
  Boolean(
    integration?.enabled &&
    (integration.health.state === 'ok' || integration.health.state === 'warning'),
  );
