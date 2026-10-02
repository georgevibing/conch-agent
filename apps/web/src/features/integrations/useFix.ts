import { awaitsSignIn, type Integration } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useNavigate } from 'react-router';

import { integrationsApi } from './api';
import { useCheckIntegration, useUpdateIntegration } from './queries';
import { useSignIn } from './useSignIn';

/** The one action that fixes an integration, whatever is wrong with it. */
export function useFix() {
  const signIn = useSignIn();
  const check = useCheckIntegration();
  const update = useUpdateIntegration();
  const navigate = useNavigate();
  return {
    pending: check.isPending ? check.variables : undefined,
    fix(integration: Integration) {
      // Found and waiting: signing in is the fix, also when a sign-in was left
      // half-way (a window closed, a page that never came back) — start it again.
      if (awaitsSignIn(integration) && integration.auth === 'oauth')
        return void signIn((display) => integrationsApi.connect(integration.id, display)).then(
          (result) => {
            const health = result?.integration.health;
            if (health?.state === 'error' && health.message) toast.error(health.message);
          },
        );
      switch (integration.health.action) {
        case 'reconnect':
          // Gmail, Calendar, Drive, Slack: their page has the fix (a new app password,
          // Google's sign-in, Slack's dialog).
          if (integration.transport.type === 'host')
            return void navigate(`/apps/${integration.id}`, { state: { focus: 'token' } });
          if (integration.auth === 'oauth')
            return void signIn((display) => integrationsApi.connect(integration.id, display));
          return void navigate(`/apps/${integration.id}`, { state: { focus: 'token' } });
        case 'edit':
          return void navigate(`/apps/${integration.id}`, { state: { focus: 'token' } });
        case 'turn-on':
          return update.mutate({ id: integration.id, patch: { enabled: true } });
        case 'setup':
          // One you added yourself: its page offers to get the program it runs with.
          if (integration.health.need && !integration.catalogId)
            return void navigate(`/apps/${integration.id}`);
          // From the catalog: its connect dialog shows what's missing and offers to get it.
          return void navigate(`/apps?setup=${integration.id}`);
        default:
          return check.mutate(integration.id);
      }
    },
  };
}
